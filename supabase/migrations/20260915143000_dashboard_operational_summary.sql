-- Bounded operational dashboard payload and lazy global search.
-- Replaces full-table customer, vehicle, work-order and claim reads on dashboard open.

create or replace function public.dashboard_operational_summary_rpc(
  p_tenant_id uuid,
  p_period text default 'month',
  p_technician text default 'all',
  p_service text default 'all'
)
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
),
base as materialized (
  select
    jo.*,
    cu.name as customer_name,
    cu.phone as customer_phone,
    v.plate_number,
    v.plate_letters,
    v.brand as vehicle_brand,
    v.model as vehicle_model,
    v.year as vehicle_year,
    coalesce(v.vin_number, v.vin) as vehicle_vin,
    ic.status::text as claim_status
  from public.job_orders jo
  join authorized a on a.tenant_id = jo.tenant_id
  left join public.customers cu on cu.id = jo.customer_id and cu.tenant_id = jo.tenant_id
  left join public.vehicles v on v.id = jo.vehicle_id and v.tenant_id = jo.tenant_id
  left join public.insurance_claims ic on ic.id = jo.claim_id and ic.tenant_id = jo.tenant_id and ic.deleted_at is null
  where jo.deleted_at is null and jo.archived_at is null
),
filtered as materialized (
  select * from base b
  where (
      coalesce(nullif(p_period, ''), 'month') = 'all'
      or (p_period = 'today' and coalesce(b.entry_date, b.created_at::date) >= current_date)
      or (p_period = 'week' and coalesce(b.entry_date, b.created_at::date) >= current_date - 6)
      or (p_period = 'month' and coalesce(b.entry_date, b.created_at::date) >= date_trunc('month', current_date)::date)
    )
    and (coalesce(nullif(p_technician, ''), 'all') = 'all' or b.technician_name = p_technician)
    and (coalesce(nullif(p_service, ''), 'all') = 'all' or b.service_type = p_service)
),
recent_orders as (
  select jsonb_build_object(
    'id', coalesce(order_number, id::text),
    'cloudId', id,
    'displayNumber', order_number,
    'customer', coalesce(customer_name, ''),
    'phone', coalesce(customer_phone, ''),
    'plate', concat_ws(' ', plate_letters, plate_number),
    'vehicleType', coalesce(vehicle_brand, ''),
    'model', coalesce(vehicle_model, ''),
    'year', coalesce(vehicle_year::text, ''),
    'vin', coalesce(vehicle_vin, ''),
    'insurance', coalesce(insurance_company, '-'),
    'claimNumber', coalesce(insurance_claim_number, '-'),
    'entryDate', coalesce(entry_date, created_at::date),
    'technician', coalesce(technician_name, ''),
    'serviceType', coalesce(service_type, 'صيانة'),
    'status', case status::text
      when 'received' then 'تحت الفحص'
      when 'inspection' then 'تحت الفحص'
      when 'waiting_parts' then 'بانتظار قطع الغيار'
      when 'in_progress' then 'تحت الإصلاح'
      when 'completed' then 'جاهز للتسليم'
      when 'delivered' then 'تم التسليم'
      else status::text end,
    'totalCost', coalesce(final_total, subtotal, 0)
  ) as row_json
  from filtered
  order by created_at desc, id desc
  limit 30
),
overdue_orders as (
  select jsonb_build_object(
    'id', coalesce(order_number, id::text),
    'customer', coalesce(customer_name, ''),
    'entryDate', coalesce(entry_date, created_at::date)
  ) as row_json
  from base
  where status::text not in ('completed', 'delivered')
    and current_date - coalesce(entry_date, created_at::date) >= 3
  order by coalesce(entry_date, created_at::date), created_at
  limit 3
),
recent_customers as (
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'phone', coalesce(c.phone, ''),
    'createdAt', c.created_at
  ) as row_json
  from public.customers c
  join authorized a on a.tenant_id = c.tenant_id
  where c.deleted_at is null and coalesce(c.archived, false) = false
  order by c.created_at desc, c.id desc
  limit 10
),
stats as (
  select
    count(*) filter (where status::text <> 'delivered')::bigint as in_workshop,
    count(*) filter (where status::text in ('received', 'inspection'))::bigint as under_inspection,
    count(*) filter (where claim_id is not null and claim_status = 'pending')::bigint as waiting_insurance,
    count(*) filter (where status::text = 'in_progress')::bigint as under_repair,
    count(*) filter (where status::text = 'completed')::bigint as ready_delivery,
    count(*) filter (where status::text <> 'delivered')::bigint as open_orders,
    count(*) filter (where status::text = 'delivered' and coalesce(entry_date, created_at::date) = current_date)::bigint as closed_today,
    count(*)::bigint as total_orders,
    count(*) filter (where status::text = 'delivered')::bigint as completed_orders,
    count(distinct customer_id) filter (where customer_id is not null)::bigint as active_customers,
    coalesce(avg(greatest(0, current_date - coalesce(entry_date, created_at::date))) filter (where status::text = 'delivered'), 0)::numeric as average_days
  from filtered
),
services as (
  select coalesce(jsonb_agg(jsonb_build_object('name', name, 'value', value) order by value desc, name), '[]'::jsonb) as items
  from (
    select coalesce(nullif(trim(service_type), ''), 'أخرى') as name, count(*)::bigint as value
    from filtered group by 1 order by 2 desc, 1 limit 6
  ) grouped
),
filter_options as (
  select jsonb_build_object(
    'technicians', coalesce((select jsonb_agg(value order by value) from (select distinct technician_name as value from base where nullif(trim(technician_name), '') is not null) q), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(value order by value) from (select distinct service_type as value from base where nullif(trim(service_type), '') is not null) q), '[]'::jsonb)
  ) as value
)
select jsonb_build_object(
  'stats', (select to_jsonb(stats) from stats),
  'recentOrders', coalesce((select jsonb_agg(row_json) from recent_orders), '[]'::jsonb),
  'overdueOrders', coalesce((select jsonb_agg(row_json) from overdue_orders), '[]'::jsonb),
  'recentCustomers', coalesce((select jsonb_agg(row_json) from recent_customers), '[]'::jsonb),
  'serviceDistribution', (select items from services),
  'filterOptions', (select value from filter_options)
);
$$;

create or replace function public.dashboard_global_search_rpc(
  p_tenant_id uuid,
  p_search text,
  p_limit integer default 20
)
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
    and length(trim(coalesce(p_search, ''))) >= 2
),
matches as (
  select 1 as priority, jo.created_at as sort_at,
    jsonb_build_object('kind', 'work_order', 'label', jo.order_number, 'sub', concat_ws(' — ', cu.name, concat_ws(' ', v.plate_letters, v.plate_number)), 'to', '/work-orders/' || jo.order_number) as item
  from public.job_orders jo join authorized a on a.tenant_id = jo.tenant_id
  left join public.customers cu on cu.id = jo.customer_id and cu.tenant_id = jo.tenant_id
  left join public.vehicles v on v.id = jo.vehicle_id and v.tenant_id = jo.tenant_id
  where jo.deleted_at is null and concat_ws(' ', jo.order_number, cu.name, cu.phone, v.plate_letters, v.plate_number, v.brand, v.model, coalesce(v.vin_number, v.vin)) ilike '%' || trim(p_search) || '%'
  union all
  select 2, c.created_at, jsonb_build_object('kind', 'customer', 'label', c.name, 'sub', coalesce(c.phone, ''), 'to', '/customers/' || c.id::text)
  from public.customers c join authorized a on a.tenant_id = c.tenant_id
  where c.deleted_at is null and coalesce(c.archived, false) = false and concat_ws(' ', c.name, c.phone, c.customer_code) ilike '%' || trim(p_search) || '%'
  union all
  select 3, v.created_at, jsonb_build_object('kind', 'vehicle', 'label', concat_ws(' ', v.plate_letters, v.plate_number), 'sub', concat_ws(' ', v.brand, v.model, coalesce(v.vin_number, v.vin)), 'to', '/vehicles/' || v.id::text)
  from public.vehicles v join authorized a on a.tenant_id = v.tenant_id
  where v.deleted_at is null and coalesce(v.archived, false) = false and concat_ws(' ', v.plate_letters, v.plate_number, v.brand, v.model, coalesce(v.vin_number, v.vin)) ilike '%' || trim(p_search) || '%'
  union all
  select 4, ic.created_at, jsonb_build_object('kind', 'claim', 'label', ic.claim_number, 'sub', concat_ws(' — ', ic.insurance_company, coalesce(ic.vehicle_plate, concat_ws(' ', v.plate_letters, v.plate_number))), 'to', '/insurance/' || ic.id::text)
  from public.insurance_claims ic join authorized a on a.tenant_id = ic.tenant_id
  left join public.vehicles v on v.id = ic.vehicle_id and v.tenant_id = ic.tenant_id
  left join public.customers cu on cu.id = ic.customer_id and cu.tenant_id = ic.tenant_id
  where ic.deleted_at is null and concat_ws(' ', ic.claim_number, ic.insurance_company, ic.vehicle_plate, ic.vehicle_make, ic.vehicle_model, cu.name, v.plate_letters, v.plate_number) ilike '%' || trim(p_search) || '%'
), limited as (
  select item from matches order by priority, sort_at desc limit least(greatest(coalesce(p_limit, 20), 1), 30)
)
select coalesce(jsonb_agg(item), '[]'::jsonb) from limited;
$$;

revoke all on function public.dashboard_operational_summary_rpc(uuid, text, text, text) from public, anon;
grant execute on function public.dashboard_operational_summary_rpc(uuid, text, text, text) to authenticated;
revoke all on function public.dashboard_global_search_rpc(uuid, text, integer) from public, anon;
grant execute on function public.dashboard_global_search_rpc(uuid, text, integer) to authenticated;
