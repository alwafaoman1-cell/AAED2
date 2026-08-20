-- Atomic payment-voucher numbering for expenses.
-- Existing expense rows and voucher numbers are intentionally left unchanged.

create table if not exists public.expense_voucher_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  voucher_year integer not null check (voucher_year between 2000 and 2200),
  prefix text not null check (prefix ~ '^[A-Z0-9_-]{1,20}$'),
  last_number bigint not null check (last_number > 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, voucher_year, prefix)
);

alter table public.expense_voucher_sequences enable row level security;
revoke all on public.expense_voucher_sequences from anon, authenticated;

create or replace function public.next_expense_voucher_number(
  p_prefix text default 'PAY',
  p_year integer default extract(year from current_date)::integer,
  p_padding integer default 4
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
set row_security = off
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_prefix text;
  v_year integer := coalesce(p_year, extract(year from current_date)::integer);
  v_padding integer := greatest(1, least(coalesce(p_padding, 4), 12));
  v_existing_max bigint := 0;
  v_next bigint;
begin
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'EXPENSE_VOUCHER_TENANT_REQUIRED' using errcode = '42501';
  end if;

  if v_year not between 2000 and 2200 then
    raise exception 'EXPENSE_VOUCHER_YEAR_INVALID' using errcode = '22023';
  end if;

  v_prefix := upper(regexp_replace(coalesce(nullif(trim(p_prefix), ''), 'PAY'), '[^A-Za-z0-9_-]', '', 'g'));
  if v_prefix = '' or length(v_prefix) > 20 then
    raise exception 'EXPENSE_VOUCHER_PREFIX_INVALID' using errcode = '22023';
  end if;

  -- Seed a new series above the highest existing legacy number. This reads
  -- historical rows but never changes or reclassifies them.
  select coalesce(max(substring(
    e.voucher_number from '^' || v_prefix || '-' || v_year::text || '-([0-9]+)$'
  )::bigint), 0)
  into v_existing_max
  from public.expenses e
  where e.tenant_id = v_tenant_id
    and e.voucher_number ~* ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$');

  insert into public.expense_voucher_sequences(tenant_id, voucher_year, prefix, last_number, updated_at)
  values (v_tenant_id, v_year, v_prefix, v_existing_max + 1, now())
  on conflict (tenant_id, voucher_year, prefix) do update
    set last_number = greatest(
          public.expense_voucher_sequences.last_number,
          excluded.last_number - 1
        ) + 1,
        updated_at = now()
  returning last_number into v_next;

  return v_prefix || '-' || v_year::text || '-' || lpad(v_next::text, v_padding, '0');
end;
$$;

revoke all on function public.next_expense_voucher_number(text, integer, integer) from public, anon;
grant execute on function public.next_expense_voucher_number(text, integer, integer) to authenticated;

comment on table public.expense_voucher_sequences is
  'Atomic per-tenant/year/prefix counters for payment voucher numbers.';
comment on function public.next_expense_voucher_number(text, integer, integer) is
  'Atomically reserves the next expense voucher number; never reuse a client-side counter for persisted expenses.';
