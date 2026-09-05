-- Canonicalize the legacy work-order relation used by historical expenses.
-- Financial values, classification and supplier fields are intentionally untouched.

create or replace function public.sync_expense_legacy_work_order_link()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_work_order_id uuid;
begin
  if new.work_order_id is null
     and nullif(btrim(coalesce(new.linked_work_order_id, '')), '') is not null then
    select j.id
      into v_work_order_id
    from public.job_orders j
    where j.tenant_id = new.tenant_id
      and j.deleted_at is null
      and (
        j.id::text = btrim(new.linked_work_order_id)
        or j.order_number = btrim(new.linked_work_order_id)
      )
    order by (j.id::text = btrim(new.linked_work_order_id)) desc
    limit 1;

    if v_work_order_id is not null then
      new.work_order_id := v_work_order_id;
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.sync_expense_legacy_work_order_link() from public, anon, authenticated;

drop trigger if exists a_sync_expense_legacy_work_order_link on public.expenses;
create trigger a_sync_expense_legacy_work_order_link
before insert or update of linked_work_order_id, work_order_id
on public.expenses
for each row
execute function public.sync_expense_legacy_work_order_link();

-- Exact tenant-scoped linkage only. This does not infer or alter financial data.
update public.expenses e
set work_order_id = j.id
from public.job_orders j
where e.work_order_id is null
  and e.deleted_at is null
  and j.tenant_id = e.tenant_id
  and j.deleted_at is null
  and nullif(btrim(coalesce(e.linked_work_order_id, '')), '') is not null
  and (
    j.id::text = btrim(e.linked_work_order_id)
    or j.order_number = btrim(e.linked_work_order_id)
  );

create index if not exists expenses_tenant_work_order_active_idx
  on public.expenses (tenant_id, work_order_id, date desc)
  where deleted_at is null;
