-- One bounded, tenant-isolated read for home shortcuts. No client-side full
-- table load and no dependency on local caches or obsolete table names.
create or replace function public.home_shortcut_counts_rpc(p_tenant_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with authorized as materialized (
  select p_tenant_id as tenant_id
  where auth.uid() is not null
    and p_tenant_id = public.get_user_tenant_id()
    and public.get_user_role()::text <> 'customer'
)
select case when exists (select 1 from authorized) then jsonb_build_object(
  'openWorkOrders', (
    select count(*) from public.job_orders j join authorized a on a.tenant_id = j.tenant_id
    where j.deleted_at is null and j.archived_at is null and j.status::text <> 'delivered'
  ),
  'todayWorkOrders', (
    select count(*) from public.job_orders j join authorized a on a.tenant_id = j.tenant_id
    where j.deleted_at is null and j.archived_at is null
      and coalesce(j.entry_date, (j.created_at at time zone 'Asia/Muscat')::date)
        = (now() at time zone 'Asia/Muscat')::date
  ),
  'vehicles', (
    select count(*) from public.vehicles v join authorized a on a.tenant_id = v.tenant_id
    where v.deleted_at is null and v.archived_at is null and coalesce(v.archived, false) = false
  ),
  'pendingClaims', (
    select count(*) from public.insurance_claims c join authorized a on a.tenant_id = c.tenant_id
    where c.deleted_at is null and c.status::text = 'pending'
  ),
  'lowStock', (
    select count(*) from public.inventory i join authorized a on a.tenant_id = i.tenant_id
    where i.quantity <= i.min_quantity
  ),
  'unpaidInvoices', (
    select count(*) from public.sales_documents d join authorized a on a.tenant_id = d.tenant_id
    where d.doc_type = 'invoice' and d.deleted_at is null
      and coalesce(d.metadata->>'isDeleted', 'false') <> 'true'
      and d.status not in ('draft', 'cancelled') and d.balance_due > 0.001
  ),
  'pendingInspections', (
    select count(*) from public.job_orders j join authorized a on a.tenant_id = j.tenant_id
    where j.deleted_at is null and j.archived_at is null and j.status::text = 'inspection'
  )
) else '{}'::jsonb end;
$$;

revoke all on function public.home_shortcut_counts_rpc(uuid) from public, anon;
grant execute on function public.home_shortcut_counts_rpc(uuid) to authenticated;
