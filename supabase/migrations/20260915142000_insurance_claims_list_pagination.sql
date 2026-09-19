-- Paginated insurance claims registry with tenant-bound server filters and sorting.
-- Read-only; claim detail, mutations, accounting and historical data remain unchanged.

create or replace function public.insurance_claims_list_rpc(
  p_tenant_id uuid,
  p_page integer default 1,
  p_page_size integer default 20,
  p_search text default '',
  p_status text default 'all',
  p_company text default 'all',
  p_employee_id uuid default null,
  p_date_range text default 'all',
  p_delivery text default 'all',
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc'
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
    c.*,
    cu.name as list_customer_name,
    cu.phone as list_customer_phone,
    v.brand as list_vehicle_brand,
    v.model as list_vehicle_model,
    v.plate_number as list_vehicle_plate_number,
    v.plate_letters as list_vehicle_plate_letters,
    v.plate_country as list_vehicle_plate_country,
    v.year as list_vehicle_year,
    v.vin_number as list_vehicle_vin,
    v.vehicle_cover_image_url as list_vehicle_cover_image_url,
    v.vehicle_thumbnail_url as list_vehicle_thumbnail_url,
    jo.order_number as list_order_number,
    jo.status::text as list_order_status,
    case
      when c.status::text = 'paid' then 'paid_archive'
      when c.status::text in ('cancelled', 'rejected') then 'cancelled'
      when c.delivered_at is not null then 'delivered'
      when c.workshop_arrival_date is not null then 'in_workshop'
      else 'with_customer'
    end as list_vehicle_location,
    greatest(
      0,
      floor(extract(epoch from (coalesce(c.delivered_at, now()) - coalesce(c.workshop_arrival_date, c.created_at))) / 86400)
    )::integer as list_duration_days
  from public.insurance_claims c
  join authorized a on a.tenant_id = c.tenant_id
  left join public.customers cu on cu.id = c.customer_id and cu.tenant_id = c.tenant_id
  left join public.vehicles v on v.id = c.vehicle_id and v.tenant_id = c.tenant_id
  left join public.job_orders jo on jo.id = c.job_order_id and jo.tenant_id = c.tenant_id
  where c.deleted_at is null
),
filtered as materialized (
  select * from base b
  where (coalesce(nullif(p_status, ''), 'all') = 'all' or b.status::text = p_status)
    and (coalesce(nullif(p_company, ''), 'all') = 'all' or b.insurance_company = p_company)
    and (p_employee_id is null or b.insurance_employee_id = p_employee_id)
    and (
      coalesce(nullif(p_delivery, ''), 'all') = 'all'
      or (p_delivery = 'active' and b.list_vehicle_location not in ('paid_archive', 'cancelled'))
      or b.list_vehicle_location = p_delivery
    )
    and (
      coalesce(nullif(p_date_range, ''), 'all') = 'all'
      or (p_date_range = '7d' and b.created_at >= now() - interval '7 days')
      or (p_date_range = '30d' and b.created_at >= now() - interval '30 days')
      or (p_date_range = '90d' and b.created_at >= now() - interval '90 days')
    )
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or concat_ws(' ', b.claim_number, b.insurance_company, b.list_customer_name,
        b.vehicle_plate, b.vehicle_make, b.vehicle_model,
        b.list_vehicle_plate_number, b.list_vehicle_plate_letters,
        b.list_vehicle_brand, b.list_vehicle_model)
        ilike '%' || trim(p_search) || '%'
    )
),
paged as materialized (
  select * from filtered
  order by
    case when p_sort_by = 'number' and p_sort_dir = 'asc' then claim_number end asc,
    case when p_sort_by = 'number' and p_sort_dir <> 'asc' then claim_number end desc,
    case when p_sort_by = 'customer' and p_sort_dir = 'asc' then list_customer_name end asc nulls last,
    case when p_sort_by = 'customer' and p_sort_dir <> 'asc' then list_customer_name end desc nulls last,
    case when p_sort_by = 'estimate_date' and p_sort_dir = 'asc' then coalesce(estimate_date, created_at) end asc,
    case when p_sort_by = 'estimate_date' and p_sort_dir <> 'asc' then coalesce(estimate_date, created_at) end desc,
    case when p_sort_by = 'payment_status' and p_sort_dir = 'asc' then (status::text = 'paid')::integer end asc,
    case when p_sort_by = 'payment_status' and p_sort_dir <> 'asc' then (status::text = 'paid')::integer end desc,
    case when p_sort_by = 'duration' and p_sort_dir = 'asc' then list_duration_days end asc,
    case when p_sort_by = 'duration' and p_sort_dir <> 'asc' then list_duration_days end desc,
    case when coalesce(nullif(p_sort_by, ''), 'created_at') = 'created_at' and p_sort_dir = 'asc' then created_at end asc,
    case when coalesce(nullif(p_sort_by, ''), 'created_at') = 'created_at' and p_sort_dir <> 'asc' then created_at end desc,
    created_at desc,
    id desc
  offset greatest(coalesce(p_page, 1) - 1, 0) * least(greatest(coalesce(p_page_size, 20), 1), 100)
  limit least(greatest(coalesce(p_page_size, 20), 1), 100)
),
page_rows as (
  select
    to_jsonb(p)
      - 'list_customer_name'
      - 'list_customer_phone'
      - 'list_vehicle_brand'
      - 'list_vehicle_model'
      - 'list_vehicle_plate_number'
      - 'list_vehicle_plate_letters'
      - 'list_vehicle_plate_country'
      - 'list_vehicle_year'
      - 'list_vehicle_vin'
      - 'list_vehicle_cover_image_url'
      - 'list_vehicle_thumbnail_url'
      - 'list_order_number'
      - 'list_order_status'
      - 'list_vehicle_location'
      - 'list_duration_days'
      || jsonb_build_object(
        'customer', jsonb_build_object('name', p.list_customer_name, 'phone', p.list_customer_phone),
        'vehicle', jsonb_build_object(
          'brand', p.list_vehicle_brand,
          'model', p.list_vehicle_model,
          'plate_number', p.list_vehicle_plate_number,
          'plate_letters', p.list_vehicle_plate_letters,
          'plate_country', p.list_vehicle_plate_country,
          'year', p.list_vehicle_year,
          'vin_number', p.list_vehicle_vin,
          'vehicle_cover_image_url', p.list_vehicle_cover_image_url,
          'vehicle_thumbnail_url', p.list_vehicle_thumbnail_url
        ),
        'job_order', jsonb_build_object('order_number', p.list_order_number, 'status', p.list_order_status)
      ) as row_json
  from paged p
),
summary as (
  select count(*)::bigint as total, coalesce(sum(estimated_amount), 0)::numeric as estimated_total
  from filtered
),
companies as (
  select coalesce(jsonb_agg(insurance_company order by insurance_company), '[]'::jsonb) as items
  from (select distinct insurance_company from base where nullif(trim(insurance_company), '') is not null) names
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(row_json) from page_rows), '[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', greatest(coalesce(p_page, 1), 1),
    'pageSize', least(greatest(coalesce(p_page_size, 20), 1), 100),
    'totalRows', (select count(*) from filtered),
    'totalPages', case when (select count(*) from filtered) = 0 then 0 else ceil((select count(*) from filtered)::numeric / least(greatest(coalesce(p_page_size, 20), 1), 100))::integer end
  ),
  'summary', (select to_jsonb(summary) from summary),
  'filterOptions', jsonb_build_object('companies', (select items from companies))
);
$$;

revoke all on function public.insurance_claims_list_rpc(uuid, integer, integer, text, text, text, uuid, text, text, text, text)
  from public, anon;
grant execute on function public.insurance_claims_list_rpc(uuid, integer, integer, text, text, text, uuid, text, text, text, text)
  to authenticated;
