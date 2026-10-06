-- Future receipt numbers only. Historical numbers and payment rows are untouched.
create table if not exists public.receipt_number_sequences (
  tenant_id uuid not null references public.tenants(id),
  receipt_year integer not null,
  prefix text not null,
  next_number bigint not null check (next_number > 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, receipt_year, prefix)
);

alter table public.receipt_number_sequences enable row level security;
revoke all on public.receipt_number_sequences from public, anon, authenticated;
grant all on public.receipt_number_sequences to service_role;

create or replace function public.reserve_receipt_number_rpc(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_user_id uuid := auth.uid();
  v_year integer := extract(year from current_timestamp at time zone 'Asia/Muscat')::integer;
  v_prefix text;
  v_padding integer;
  v_settings jsonb;
  v_next_from_settings bigint;
  v_highest_receipt bigint;
  v_highest_deposit bigint;
  v_floor bigint;
  v_allocated bigint;
begin
  if v_user_id is null or p_tenant_id is null
     or p_tenant_id <> public.get_user_tenant_id() then
    raise exception 'RECEIPT_TENANT_DENIED' using errcode = '42501';
  end if;

  select value into v_settings from public.tenant_settings
   where tenant_id = p_tenant_id and key = 'alwafa_voucher_settings_v1';
  v_prefix := upper(coalesce(nullif(trim(v_settings->>'receiptPrefix'), ''), 'RCV'));
  if v_prefix !~ '^[A-Z0-9]{1,10}$' then
    raise exception 'INVALID_RECEIPT_PREFIX' using errcode = '22023';
  end if;
  v_padding := greatest(3, least(10, coalesce((v_settings->>'numberPadding')::integer, 4)));
  v_next_from_settings := greatest(1, coalesce((v_settings->>'receiptNextNumber')::bigint, 1));

  select coalesce(max(split_part(receipt_number, '-', 3)::bigint), 0)
    into v_highest_receipt
    from public.accounting_receipts
   where tenant_id = p_tenant_id
     and receipt_number ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$');

  select coalesce(max(split_part(entry->>'receiptNumber', '-', 3)::bigint), 0)
    into v_highest_deposit
    from public.tenant_settings settings,
         jsonb_array_elements(
           case when jsonb_typeof(settings.value) = 'array' then settings.value else '[]'::jsonb end
         ) entry
   where settings.tenant_id = p_tenant_id
     and settings.key = 'alwafa_deposits_v1'
     and entry->>'receiptNumber' ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$');

  v_floor := greatest(v_next_from_settings, v_highest_receipt + 1, v_highest_deposit + 1);
  insert into public.receipt_number_sequences (tenant_id, receipt_year, prefix, next_number)
  values (p_tenant_id, v_year, v_prefix, v_floor + 1)
  on conflict (tenant_id, receipt_year, prefix) do update
     set next_number = greatest(public.receipt_number_sequences.next_number, v_floor) + 1,
         updated_at = now()
  returning next_number - 1 into v_allocated;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_allocated::text, v_padding, '0');
end;
$$;

revoke all on function public.reserve_receipt_number_rpc(uuid) from public, anon;
grant execute on function public.reserve_receipt_number_rpc(uuid) to authenticated;
