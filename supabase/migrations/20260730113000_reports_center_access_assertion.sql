-- Reports Center follow-up hardening. Additive and non-destructive.
-- Enforces explicit access denial for the optimized Work Orders RPC and
-- applies the granular saved-views permission to existing tenant RLS policies.

create or replace function public.reports_assert_access(
  p_tenant_id uuid,
  p_permission text
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if p_tenant_id is null or p_tenant_id <> public.get_user_tenant_id() then
    raise exception 'reports_tenant_access_denied' using errcode = '42501';
  end if;
  if not public.reports_has_permission(p_permission) then
    raise exception 'reports_permission_denied' using errcode = '42501';
  end if;
  return true;
end;
$$;

revoke all on function public.reports_assert_access(uuid, text)
  from public, anon, authenticated;

create or replace function public.reports_work_orders_rpc(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_business_type text default 'all',
  p_filters jsonb default '{}'::jsonb,
  p_search text default '',
  p_sort text default 'report_date',
  p_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
with access_check as materialized (
  select public.reports_assert_access(p_tenant_id, 'reports.operations') as allowed
),
authorized as (
  select p_tenant_id as tenant_id
  from access_check
  where allowed and p_business_type in ('all', 'insurance', 'cash')
),
scoped as materialized (
  select
    'work_orders'::text as report_key,
    w.tenant_id,
    w.id as record_id,
    w.created_at::date as report_date,
    w.order_number as reference,
    w.claim_number as secondary_reference,
    w.business_type,
    w.customer_name as party_name,
    w.vehicle_name,
    w.plate,
    w.status,
    0::numeric as estimate_amount,
    0::numeric as approved_amount,
    w.workshop_days,
    w.insurance_company_id,
    w.customer_id,
    w.vehicle_id,
    w.claim_id,
    w.id as work_order_id,
    w.received_at,
    w.delivered_at,
    w.vin,
    jo.technician_id,
    coalesce(
      to_jsonb(jo)->>'vehicle_location_section',
      to_jsonb(jo)->>'vehicle_location_bay'
    ) as workshop_location
  from public.reports_work_order_facts_v1 w
  join authorized a on a.tenant_id = w.tenant_id
  join public.job_orders jo
    on jo.tenant_id = w.tenant_id and jo.id = w.id
  where w.deleted_at is null
    and (p_from_date is null or w.created_at::date >= p_from_date)
    and (p_to_date is null or w.created_at::date <= p_to_date)
    and (p_business_type = 'all' or w.business_type = p_business_type)
    and (nullif(p_filters->>'insuranceCompanyId', '') is null or w.insurance_company_id::text = p_filters->>'insuranceCompanyId')
    and (nullif(p_filters->>'customerId', '') is null or w.customer_id::text = p_filters->>'customerId')
    and (nullif(p_filters->>'vehicleId', '') is null or w.vehicle_id::text = p_filters->>'vehicleId')
    and (nullif(p_filters->>'status', '') is null or lower(w.status) = lower(p_filters->>'status'))
    and (nullif(p_filters->>'plate', '') is null or coalesce(w.plate, '') ilike '%' || (p_filters->>'plate') || '%')
    and (nullif(p_filters->>'vin', '') is null or coalesce(w.vin, '') ilike '%' || (p_filters->>'vin') || '%')
    and (nullif(p_filters->>'claimNumber', '') is null or coalesce(w.claim_number, '') ilike '%' || (p_filters->>'claimNumber') || '%')
    and (
      nullif(p_filters->>'workOrderNumber', '') is null
      or w.order_number ilike '%' || (p_filters->>'workOrderNumber') || '%'
      or w.id::text = p_filters->>'workOrderNumber'
    )
    and (nullif(p_filters->>'employeeId', '') is null or jo.technician_id::text = p_filters->>'employeeId')
    and (
      nullif(p_filters->>'workshopLocation', '') is null
      or coalesce(to_jsonb(jo)->>'vehicle_location_section', to_jsonb(jo)->>'vehicle_location_bay', '')
        ilike '%' || (p_filters->>'workshopLocation') || '%'
    )
    and (
      nullif(p_search, '') is null
      or concat_ws(' ', w.order_number, w.claim_number, w.customer_name, w.vehicle_name, w.plate, w.status)
        ilike '%' || p_search || '%'
    )
),
invoice_totals as materialized (
  select
    i.work_order_id,
    coalesce(sum(i.subtotal), 0)::numeric as invoice_subtotal,
    coalesce(sum(i.vat), 0)::numeric as vat,
    coalesce(sum(i.total), 0)::numeric as invoice_total,
    coalesce(sum(i.paid), 0)::numeric as paid,
    coalesce(sum(i.outstanding), 0)::numeric as outstanding,
    min(i.due_date) as due_date
  from public.reports_invoice_facts_v1 i
  join scoped s on s.work_order_id = i.work_order_id
  where i.tenant_id = p_tenant_id
  group by i.work_order_id
),
expense_totals as materialized (
  select e.work_order_id, coalesce(sum(e.subtotal), 0)::numeric as actual_cost
  from public.reports_expense_facts_v1 e
  join scoped s on s.work_order_id = e.work_order_id
  where e.tenant_id = p_tenant_id
    and e.deleted_at is null
    and e.archived_at is null
  group by e.work_order_id
),
filtered as (
  select
    s.report_key, s.tenant_id, s.record_id, s.report_date, s.reference,
    s.secondary_reference, s.business_type, s.party_name, s.vehicle_name,
    s.plate, s.status, s.estimate_amount, s.approved_amount,
    coalesce(i.invoice_subtotal, 0)::numeric as invoice_subtotal,
    coalesce(i.vat, 0)::numeric as vat,
    coalesce(i.invoice_total, 0)::numeric as invoice_total,
    coalesce(i.paid, 0)::numeric as paid,
    coalesce(i.outstanding, 0)::numeric as outstanding,
    coalesce(e.actual_cost, 0)::numeric as actual_cost,
    (coalesce(i.invoice_subtotal, 0) - coalesce(e.actual_cost, 0))::numeric as gross_profit,
    s.workshop_days, i.due_date, s.insurance_company_id, s.customer_id,
    s.vehicle_id, s.claim_id, s.work_order_id,
    jsonb_build_object(
      'receivedAt', s.received_at,
      'deliveredAt', s.delivered_at,
      'vin', s.vin,
      'technicianId', s.technician_id,
      'workshopLocation', s.workshop_location
    ) as extra
  from scoped s
  left join invoice_totals i on i.work_order_id = s.work_order_id
  left join expense_totals e on e.work_order_id = s.work_order_id
),
ordered as (
  select f.*,
    row_number() over (
      order by
        case when p_direction = 'asc' and p_sort = 'reference' then reference end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'reference' then reference end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'party_name' then party_name end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'party_name' then party_name end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'invoice_total' then invoice_total end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'invoice_total' then invoice_total end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'outstanding' then outstanding end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'outstanding' then outstanding end desc nulls last,
        case when p_direction = 'asc' then report_date end asc nulls last,
        case when p_direction <> 'asc' then report_date end desc nulls last,
        record_id
    ) as sort_order
  from filtered f
),
paged as (
  select *
  from ordered
  order by sort_order
  offset greatest(p_page - 1, 0) * least(greatest(p_page_size, 1), 100)
  limit least(greatest(p_page_size, 1), 100)
),
totals as (
  select
    count(*)::bigint as total_rows,
    coalesce(sum(invoice_subtotal), 0)::numeric as invoice_subtotal,
    coalesce(sum(vat), 0)::numeric as vat,
    coalesce(sum(invoice_total), 0)::numeric as invoice_total,
    coalesce(sum(paid), 0)::numeric as paid,
    coalesce(sum(outstanding), 0)::numeric as outstanding,
    coalesce(sum(actual_cost), 0)::numeric as actual_cost,
    coalesce(sum(gross_profit), 0)::numeric as gross_profit,
    coalesce(avg(workshop_days) filter (where workshop_days is not null), 0)::numeric as average_workshop_days
  from filtered
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(to_jsonb(p) - 'tenant_id' - 'report_key' - 'sort_order' order by p.sort_order)
    from paged p
  ), '[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', greatest(p_page, 1),
    'pageSize', least(greatest(p_page_size, 1), 100),
    'totalRows', (select total_rows from totals),
    'totalPages', case
      when (select total_rows from totals) = 0 then 0
      else ceil((select total_rows from totals)::numeric / least(greatest(p_page_size, 1), 100))::integer
    end
  ),
  'aggregates', jsonb_build_object(
    'rowCount', (select total_rows from totals),
    'estimateAmount', 0.000,
    'approvedAmount', 0.000,
    'invoiceSubtotal', round((select invoice_subtotal from totals), 3),
    'vat', round((select vat from totals), 3),
    'invoiceTotal', round((select invoice_total from totals), 3),
    'paid', round((select paid from totals), 3),
    'outstanding', round((select outstanding from totals), 3),
    'actualCost', round((select actual_cost from totals), 3),
    'grossProfit', round((select gross_profit from totals), 3),
    'averageWorkshopDays', round((select average_workshop_days from totals), 1)
  ),
  'dataQuality', jsonb_build_object(
    'unknownBusinessType', (select count(*) filter (where business_type = 'unknown') from scoped)
  )
);
$$;

revoke all on function public.reports_work_orders_rpc(uuid,date,date,text,jsonb,text,text,text,integer,integer)
  from public, anon;
grant execute on function public.reports_work_orders_rpc(uuid,date,date,text,jsonb,text,text,text,integer,integer)
  to authenticated;

drop policy if exists "Tenant users read report saved views" on public.report_saved_views;
create policy "Tenant users read report saved views"
on public.report_saved_views for select to authenticated
using (
  public.reports_has_permission('reports.saved_views')
  and tenant_id = public.get_user_tenant_id()
  and (user_id = auth.uid() or is_shared)
);

drop policy if exists "Users create own report saved views" on public.report_saved_views;
create policy "Users create own report saved views"
on public.report_saved_views for insert to authenticated
with check (
  public.reports_has_permission('reports.saved_views')
  and tenant_id = public.get_user_tenant_id()
  and user_id = auth.uid()
);

drop policy if exists "Users update own report saved views" on public.report_saved_views;
create policy "Users update own report saved views"
on public.report_saved_views for update to authenticated
using (
  public.reports_has_permission('reports.saved_views')
  and tenant_id = public.get_user_tenant_id()
  and user_id = auth.uid()
)
with check (
  public.reports_has_permission('reports.saved_views')
  and tenant_id = public.get_user_tenant_id()
  and user_id = auth.uid()
);

drop policy if exists "Users delete own report saved views" on public.report_saved_views;
create policy "Users delete own report saved views"
on public.report_saved_views for delete to authenticated
using (
  public.reports_has_permission('reports.saved_views')
  and tenant_id = public.get_user_tenant_id()
  and user_id = auth.uid()
);
