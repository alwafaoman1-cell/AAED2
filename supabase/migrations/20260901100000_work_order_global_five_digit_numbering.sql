-- Canonical work-order numbering: WO-00001, WO-00002, ... per tenant.
--
-- Safety rules:
--   * only rows with deleted_at IS NULL are renumbered;
--   * archived (but not deleted) rows remain part of the official sequence;
--   * UUID primary/foreign keys never change;
--   * old visible numbers remain in an immutable tenant-scoped audit table;
--   * future allocation is atomic in PostgreSQL (never calculated by the UI).

begin;

select pg_advisory_xact_lock(hashtext('work-order-global-five-digit-numbering-v1'));

do $$
begin
  if exists (select 1 from public.job_orders where tenant_id is null) then
    raise exception 'WORK_ORDER_NUMBERING_BLOCKED: job_orders with null tenant_id exist';
  end if;

  if exists (
    select 1
    from public.job_orders
    where deleted_at is null
    group by tenant_id
    having count(*) > 99999
  ) then
    raise exception 'WORK_ORDER_NUMBERING_BLOCKED: tenant has more than 99999 non-deleted work orders';
  end if;
end
$$;

create table if not exists public.work_order_number_renumber_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  job_order_id uuid not null,
  old_order_number text not null,
  new_order_number text not null,
  renumber_year text not null,
  renumbered_at timestamptz not null default now(),
  unique (tenant_id, job_order_id, renumber_year)
);

create index if not exists idx_work_order_renumber_audit_old_number
  on public.work_order_number_renumber_audit (tenant_id, lower(trim(old_order_number)));
create index if not exists idx_work_order_renumber_audit_new_number
  on public.work_order_number_renumber_audit (tenant_id, lower(trim(new_order_number)));

alter table public.work_order_number_renumber_audit enable row level security;
drop policy if exists "tenant read work order renumber audit" on public.work_order_number_renumber_audit;
create policy "tenant read work order renumber audit"
  on public.work_order_number_renumber_audit
  for select to authenticated
  using (tenant_id = public.get_user_tenant_id());

revoke all on table public.work_order_number_renumber_audit from anon;
grant select on table public.work_order_number_renumber_audit to authenticated;

create table if not exists public.work_order_number_counters (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  next_value bigint not null default 1 check (next_value between 1 and 100000),
  updated_at timestamptz not null default now()
);

alter table public.work_order_number_counters enable row level security;
revoke all on table public.work_order_number_counters from public, anon, authenticated;

create temporary table tmp_work_order_renumber on commit drop as
with scoped as (
  select
    jo.tenant_id,
    jo.id as job_order_id,
    jo.order_number as old_order_number,
    row_number() over (
      partition by jo.tenant_id
      order by
        coalesce(jo.entry_date::timestamptz, jo.received_at, jo.created_at, jo.updated_at),
        jo.created_at nulls last,
        jo.id
    ) as sequence_number
  from public.job_orders jo
  where jo.deleted_at is null
)
select
  tenant_id,
  job_order_id,
  old_order_number,
  'WO-' || lpad(sequence_number::text, 5, '0') as new_order_number,
  sequence_number
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
  'GLOBAL-5-V1'
from tmp_work_order_renumber
where old_order_number is distinct from new_order_number
on conflict (tenant_id, job_order_id, renumber_year) do nothing;

-- Move changed rows through collision-free temporary values first.
update public.job_orders jo
set order_number = 'WO-TMP-' || replace(jo.id::text, '-', '')
from tmp_work_order_renumber m
where jo.id = m.job_order_id
  and jo.tenant_id = m.tenant_id
  and m.old_order_number is distinct from m.new_order_number;

-- Update only legacy text references. UUID foreign keys remain untouched.
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
       )
       and exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = r.table_name
           and c.column_name = 'tenant_id'
       ) then
      execute format(
        'update public.%I t set %I = m.new_order_number '
        'from tmp_work_order_renumber m '
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
from tmp_work_order_renumber m
where jo.id = m.job_order_id
  and jo.tenant_id = m.tenant_id
  and m.old_order_number is distinct from m.new_order_number;

-- Initialize the next atomic value from canonical, non-deleted numbering.
insert into public.work_order_number_counters (tenant_id, next_value, updated_at)
select tenant_id, max(sequence_number) + 1, now()
from tmp_work_order_renumber
group by tenant_id
on conflict (tenant_id) do update
set next_value = excluded.next_value,
    updated_at = now();

create or replace function public.allocate_work_order_number(p_tenant_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sequence bigint;
begin
  if p_tenant_id is null then
    raise exception 'WORK_ORDER_TENANT_REQUIRED';
  end if;

  insert into public.work_order_number_counters (tenant_id, next_value, updated_at)
  values (p_tenant_id, 2, now())
  on conflict (tenant_id) do update
  set next_value = public.work_order_number_counters.next_value + 1,
      updated_at = now()
  returning next_value - 1 into v_sequence;

  if v_sequence > 99999 then
    raise exception 'WORK_ORDER_NUMBER_LIMIT_REACHED';
  end if;

  return 'WO-' || lpad(v_sequence::text, 5, '0');
end
$$;

revoke all on function public.allocate_work_order_number(uuid) from public, anon, authenticated;

create or replace function public.generate_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.order_number := public.allocate_work_order_number(new.tenant_id);
  return new;
end
$$;

revoke all on function public.generate_order_number() from public, anon, authenticated;

drop trigger if exists trg_generate_order_number on public.job_orders;
create trigger trg_generate_order_number
before insert on public.job_orders
for each row execute function public.generate_order_number();

-- Keep the unused legacy sequence aligned for rollback diagnostics only.
do $$
declare
  v_max bigint;
begin
  if to_regclass('public.job_order_seq') is not null then
    select coalesce(max((regexp_match(order_number, '^WO-([0-9]{5})$'))[1]::bigint), 0)
      into v_max
    from public.job_orders;
    perform setval('public.job_order_seq', greatest(v_max, 1), true);
  end if;
end
$$;

comment on table public.work_order_number_counters is
  'Atomic per-tenant allocator for immutable WO-NNNNN work-order numbers.';
comment on table public.work_order_number_renumber_audit is
  'Immutable old-to-current visible work-order number aliases; job_order UUID never changes.';

commit;
