-- Renumber work orders for the current year to WO-YYYY-0001 format per tenant.
-- Non-destructive: keeps a permanent old->new mapping for audit and recovery.
-- This changes display order_number only; UUID primary keys and relations remain unchanged.

begin;

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

create temporary table tmp_work_order_renumber on commit drop as
with scoped as (
  select
    jo.tenant_id,
    jo.id as job_order_id,
    jo.order_number as old_order_number,
    to_char(now(), 'YYYY') as renumber_year,
    row_number() over (
      partition by jo.tenant_id
      order by
        coalesce(jo.entry_date::timestamptz, jo.created_at, jo.updated_at, now()),
        jo.created_at nulls last,
        jo.id
    ) as rn
  from public.job_orders jo
  where jo.tenant_id is not null
    and jo.order_number is not null
    and jo.order_number ~ ('^WO-' || to_char(now(), 'YYYY') || '-[0-9]+$')
)
select
  tenant_id,
  job_order_id,
  old_order_number,
  'WO-' || renumber_year || '-' || lpad(rn::text, 4, '0') as new_order_number,
  renumber_year
from scoped
where old_order_number is distinct from ('WO-' || renumber_year || '-' || lpad(rn::text, 4, '0'));

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
  renumber_year
from tmp_work_order_renumber
on conflict (tenant_id, job_order_id, renumber_year) do update
set
  old_order_number = excluded.old_order_number,
  new_order_number = excluded.new_order_number,
  renumbered_at = now();

-- Avoid temporary unique conflicts on (tenant_id, lower(trim(order_number))).
update public.job_orders jo
set order_number = 'WO-' || m.renumber_year || '-TMP-' || replace(jo.id::text, '-', '')
from tmp_work_order_renumber m
where jo.id = m.job_order_id
  and jo.tenant_id = m.tenant_id;

-- Update known text references that may store the visible work-order number.
do $$
begin
  if to_regclass('public.expenses') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'linked_work_order_id'
    ) then
      update public.expenses e
      set linked_work_order_id = m.new_order_number
      from tmp_work_order_renumber m
      where e.tenant_id = m.tenant_id
        and e.linked_work_order_id = m.old_order_number;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'expenses' and column_name = 'source_work_order_id'
    ) then
      update public.expenses e
      set source_work_order_id = m.new_order_number
      from tmp_work_order_renumber m
      where e.tenant_id = m.tenant_id
        and e.source_work_order_id = m.old_order_number;
    end if;
  end if;

  if to_regclass('public.sales_documents') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'sales_documents' and column_name = 'from_doc_id'
    ) then
      update public.sales_documents sd
      set from_doc_id = m.new_order_number
      from tmp_work_order_renumber m
      where sd.tenant_id = m.tenant_id
        and sd.from_doc_id = m.old_order_number;
    end if;

    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'sales_documents' and column_name = 'work_order_number'
    ) then
      update public.sales_documents sd
      set work_order_number = m.new_order_number
      from tmp_work_order_renumber m
      where sd.tenant_id = m.tenant_id
        and sd.work_order_number = m.old_order_number;
    end if;
  end if;

  if to_regclass('public.vehicle_stay_notifications') is not null then
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = 'vehicle_stay_notifications' and column_name = 'work_order_number'
    ) then
      update public.vehicle_stay_notifications n
      set work_order_number = m.new_order_number
      from tmp_work_order_renumber m
      where n.tenant_id = m.tenant_id
        and n.work_order_number = m.old_order_number;
    end if;
  end if;
end $$;

update public.job_orders jo
set order_number = m.new_order_number
from tmp_work_order_renumber m
where jo.id = m.job_order_id
  and jo.tenant_id = m.tenant_id;

-- Keep the legacy database sequence aligned for inserts that rely on the trigger.
do $$
declare
  v_max integer;
begin
  if to_regclass('public.job_order_seq') is not null then
    select coalesce(max((regexp_match(order_number, '^WO-' || to_char(now(), 'YYYY') || '-([0-9]+)$'))[1]::integer), 0) + 1
      into v_max
    from public.job_orders
    where order_number ~ ('^WO-' || to_char(now(), 'YYYY') || '-[0-9]+$');

    perform setval('public.job_order_seq', greatest(v_max, 1), false);
  end if;
end $$;

commit;
