-- Canonical typed/yearly work-order numbering:
--   WO-C-26-0001 (cash/general customer)
--   WO-I-26-0001 (insurance)
--
-- Existing non-deleted work orders are ordered deterministically by their
-- operational date, independently per tenant/year/channel. Archived rows are
-- retained in the historical sequence. UUID relations never change and every
-- previous visible number remains resolvable through the renumber audit table.

begin;

select pg_advisory_xact_lock(hashtext('work-order-cash-insurance-yearly-numbering-v1'));

do $$
begin
  if exists (select 1 from public.job_orders where tenant_id is null) then
    raise exception 'WORK_ORDER_NUMBERING_BLOCKED: job_orders with null tenant_id exist';
  end if;

  if exists (
    select 1
    from (
      select
        tenant_id,
        extract(year from coalesce(entry_date::timestamptz, received_at, created_at, updated_at))::integer as order_year,
        case when claim_id is not null or work_order_type = 'insurance' then 'I' else 'C' end as channel,
        count(*) as row_count
      from public.job_orders
      where deleted_at is null
      group by 1, 2, 3
    ) counts
    where row_count > 9999
  ) then
    raise exception 'WORK_ORDER_NUMBERING_BLOCKED: tenant/year/channel has more than 9999 non-deleted work orders';
  end if;
end
$$;

create table if not exists public.work_order_number_series (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  order_year integer not null check (order_year between 2000 and 2099),
  channel text not null check (channel in ('C', 'I')),
  next_value integer not null default 1 check (next_value between 1 and 10000),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, order_year, channel)
);

alter table public.work_order_number_series enable row level security;
revoke all on table public.work_order_number_series from public, anon, authenticated;

create temporary table tmp_typed_work_order_renumber on commit drop as
with scoped as (
  select
    jo.tenant_id,
    jo.id as job_order_id,
    jo.order_number as old_order_number,
    extract(year from coalesce(jo.entry_date::timestamptz, jo.received_at, jo.created_at, jo.updated_at))::integer as order_year,
    case when jo.claim_id is not null or jo.work_order_type = 'insurance' then 'I' else 'C' end as channel,
    row_number() over (
      partition by
        jo.tenant_id,
        extract(year from coalesce(jo.entry_date::timestamptz, jo.received_at, jo.created_at, jo.updated_at))::integer,
        case when jo.claim_id is not null or jo.work_order_type = 'insurance' then 'I' else 'C' end
      order by
        coalesce(jo.entry_date::timestamptz, jo.received_at, jo.created_at, jo.updated_at),
        jo.created_at nulls last,
        jo.id
    )::integer as sequence_number
  from public.job_orders jo
  where jo.deleted_at is null
)
select
  tenant_id,
  job_order_id,
  old_order_number,
  order_year,
  channel,
  sequence_number,
  'WO-' || channel || '-' || right(order_year::text, 2) || '-' || lpad(sequence_number::text, 4, '0') as new_order_number
from scoped;

insert into public.work_order_number_renumber_audit (
  tenant_id,
  job_order_id,
  old_order_number,
  new_order_number,
  renumber_year
)
select
  tenant_id,
  job_order_id,
  old_order_number,
  new_order_number,
  'TYPED-' || order_year::text || '-' || channel || '-V1'
from tmp_typed_work_order_renumber
where old_order_number is distinct from new_order_number
on conflict (tenant_id, job_order_id, renumber_year) do nothing;

-- Temporary UUID-based values avoid collisions with the tenant number index.
update public.job_orders jo
set order_number = 'WO-TMP-' || replace(jo.id::text, '-', '')
from tmp_typed_work_order_renumber m
where jo.id = m.job_order_id
  and jo.tenant_id = m.tenant_id
  and m.old_order_number is distinct from m.new_order_number;

-- Only legacy text references are rewritten. Real UUID foreign keys are left
-- untouched. Unknown/optional tables and non-text columns are skipped safely.
do $$
declare
  r record;
begin
  for r in
    select * from (values
      ('expenses', 'linked_work_order_id'),
      ('expenses', 'source_work_order_id'),
      ('message_logs', 'work_order_id'),
      ('sales_documents', 'work_order_id'),
      ('sales_documents', 'from_doc_id'),
      ('sales_documents', 'work_order_number'),
      ('technician_notes', 'work_order_id'),
      ('technician_time_logs', 'work_order_id'),
      ('vehicle_stay_notifications', 'work_order_number'),
      ('whatsapp_conversations', 'work_order_id'),
      ('work_order_closing_audit', 'work_order_id')
    ) as refs(table_name, column_name)
  loop
    if to_regclass(format('public.%I', r.table_name)) is not null
       and exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = r.table_name
           and c.column_name = r.column_name
           and c.data_type in ('text', 'character varying', 'character')
       )
       and exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = r.table_name
           and c.column_name = 'tenant_id'
       ) then
      execute format(
        'update public.%I t set %I = m.new_order_number '
        'from tmp_typed_work_order_renumber m '
        'where t.tenant_id = m.tenant_id and t.%I = m.old_order_number '
        'and m.old_order_number is distinct from m.new_order_number',
        r.table_name,
        r.column_name,
        r.column_name
      );
    end if;
  end loop;
end
$$;

update public.job_orders jo
set order_number = m.new_order_number
from tmp_typed_work_order_renumber m
where jo.id = m.job_order_id
  and jo.tenant_id = m.tenant_id
  and m.old_order_number is distinct from m.new_order_number;

insert into public.work_order_number_series (tenant_id, order_year, channel, next_value, updated_at)
select tenant_id, order_year, channel, max(sequence_number) + 1, now()
from tmp_typed_work_order_renumber
group by tenant_id, order_year, channel
on conflict (tenant_id, order_year, channel) do update
set next_value = greatest(public.work_order_number_series.next_value, excluded.next_value),
    updated_at = now();

create or replace function public.allocate_typed_work_order_number(
  p_tenant_id uuid,
  p_work_order_type text,
  p_entry_date date default current_date
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(p_entry_date, current_date))::integer;
  v_channel text := case when p_work_order_type = 'insurance' then 'I' else 'C' end;
  v_sequence integer;
begin
  if p_tenant_id is null then
    raise exception 'WORK_ORDER_TENANT_REQUIRED';
  end if;
  if v_year < 2000 or v_year > 2099 then
    raise exception 'WORK_ORDER_YEAR_OUT_OF_RANGE';
  end if;

  insert into public.work_order_number_series (tenant_id, order_year, channel, next_value, updated_at)
  values (p_tenant_id, v_year, v_channel, 2, now())
  on conflict (tenant_id, order_year, channel) do update
  set next_value = public.work_order_number_series.next_value + 1,
      updated_at = now()
  returning next_value - 1 into v_sequence;

  if v_sequence > 9999 then
    raise exception 'WORK_ORDER_NUMBER_LIMIT_REACHED';
  end if;

  return 'WO-' || v_channel || '-' || right(v_year::text, 2) || '-' || lpad(v_sequence::text, 4, '0');
end
$$;

revoke all on function public.allocate_typed_work_order_number(uuid, text, date) from public, anon, authenticated;

create or replace function public.generate_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.order_number := public.allocate_typed_work_order_number(
    new.tenant_id,
    case when new.claim_id is not null or new.work_order_type = 'insurance' then 'insurance' else 'general_customer' end,
    coalesce(new.entry_date::date, new.created_at::date, current_date)
  );
  return new;
end
$$;

revoke all on function public.generate_order_number() from public, anon, authenticated;

drop trigger if exists trg_generate_order_number on public.job_orders;
create trigger trg_generate_order_number
before insert on public.job_orders
for each row execute function public.generate_order_number();

comment on table public.work_order_number_series is
  'Atomic per-tenant, per-year, per-channel allocator for WO-C/I-YY-NNNN work-order numbers.';

commit;
