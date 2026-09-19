-- Paginated operational work-order list.
-- This is intentionally read-only and keeps the existing detail/write paths unchanged.

create or replace function public.work_orders_list_rpc(
  p_tenant_id uuid,
  p_page integer default 1,
  p_page_size integer default 20,
  p_search text default '',
  p_filters jsonb default '{}'::jsonb
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
    cu.name as list_customer_name,
    cu.phone as list_customer_phone,
    v.plate_number as list_plate_number,
    v.plate_letters as list_plate_letters,
    v.brand as list_vehicle_brand,
    v.model as list_vehicle_model,
    v.year as list_vehicle_year,
    coalesce(v.vin_number, v.vin) as list_vehicle_vin,
    v.color as list_vehicle_color,
    v.vehicle_cover_image_url as list_vehicle_image_url,
    v.vehicle_thumbnail_url as list_vehicle_thumbnail_url,
    c.approved_amount as list_claim_approved_amount,
    c.estimated_amount as list_claim_estimated_amount,
    c.estimation_type as list_claim_estimation_type,
    coalesce(nullif(jo.insurance_company, ''), nullif(c.insurance_company, ''), '') as list_insurance_company,
    coalesce(nullif(jo.insurance_claim_number, ''), nullif(c.claim_number, ''), '') as list_claim_number,
    exists (
      select 1
      from jsonb_array_elements(coalesce(jo.parts_needed, '[]'::jsonb)) part
      where lower(coalesce(part->>'status', 'pending')) not in ('received', 'secured')
        and lower(coalesce(part->>'fulfilled', 'false')) <> 'true'
    ) as list_has_needed_parts,
    greatest(0, current_date - coalesce(jo.entry_date, jo.created_at::date))::integer as list_workshop_days
  from public.job_orders jo
  join authorized a on a.tenant_id = jo.tenant_id
  left join public.customers cu on cu.tenant_id = jo.tenant_id and cu.id = jo.customer_id
  left join public.vehicles v on v.tenant_id = jo.tenant_id and v.id = jo.vehicle_id
  left join public.insurance_claims c on c.tenant_id = jo.tenant_id and c.id = jo.claim_id
  where jo.deleted_at is null
),
filtered as materialized (
  select b.*
  from base b
  where (
      coalesce(nullif(p_filters->>'archive', ''), 'all') = 'all'
      or (p_filters->>'archive' = 'active' and b.archived_at is null)
      or (p_filters->>'archive' = 'archived' and b.archived_at is not null)
    )
    and (
      coalesce(nullif(p_filters->>'ownership', ''), 'all') = 'all'
      or (p_filters->>'ownership' = 'insurance' and b.claim_id is not null)
      or (p_filters->>'ownership' = 'cash' and b.claim_id is null)
    )
    and (
      coalesce(nullif(p_filters->>'parts', ''), 'all') = 'all'
      or (p_filters->>'parts' = 'needed' and b.list_has_needed_parts)
      or (p_filters->>'parts' = 'none' and not b.list_has_needed_parts)
    )
    and (
      coalesce(nullif(p_filters->>'age', ''), 'all') = 'all'
      or (b.status::text <> 'delivered' and p_filters->>'age' = 'under_7' and b.list_workshop_days < 7)
      or (b.status::text <> 'delivered' and p_filters->>'age' = '7_29' and b.list_workshop_days between 7 and 29)
      or (b.status::text <> 'delivered' and p_filters->>'age' = '30_plus' and b.list_workshop_days >= 30)
      or (b.status::text <> 'delivered' and p_filters->>'age' = '11_plus' and b.list_workshop_days >= 11)
    )
    and (
      coalesce(jsonb_array_length(coalesce(p_filters->'statuses', '[]'::jsonb)), 0) = 0
      or b.status::text in (select jsonb_array_elements_text(p_filters->'statuses'))
    )
    and (
      nullif(p_filters->>'technician', '') is null
      or (p_filters->>'technician' = 'unassigned' and nullif(trim(coalesce(b.technician_name, '')), '') is null)
      or b.technician_name = p_filters->>'technician'
    )
    and (nullif(p_filters->>'service', '') is null or b.service_type = p_filters->>'service')
    and (nullif(p_filters->>'insurance', '') is null or b.list_insurance_company = p_filters->>'insurance')
    and (nullif(p_filters->>'entryFrom', '') is null or b.entry_date >= (p_filters->>'entryFrom')::date)
    and (nullif(p_filters->>'entryTo', '') is null or b.entry_date <= (p_filters->>'entryTo')::date)
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or concat_ws(' ', b.order_number, b.list_customer_name, b.list_customer_phone,
        b.list_plate_letters, b.list_plate_number, b.list_vehicle_brand, b.list_vehicle_model,
        b.list_vehicle_vin, b.list_claim_number, b.list_insurance_company, b.technician_name,
        b.service_type, b.status::text) ilike '%' || trim(p_search) || '%'
    )
),
ordered as (
  select f.*,
    row_number() over (
      order by
        coalesce(substring(coalesce(f.order_number, '') from '([0-9]+)$')::bigint, 0) desc,
        f.created_at desc,
        f.id desc
    ) as list_sort_order
  from filtered f
),
paged as materialized (
  select *
  from ordered
  order by list_sort_order
  offset greatest(coalesce(p_page, 1) - 1, 0) * least(greatest(coalesce(p_page_size, 20), 1), 100)
  limit least(greatest(coalesce(p_page_size, 20), 1), 100)
),
page_rows as (
  select
    p.list_sort_order,
    to_jsonb(p)
      - 'list_sort_order'
      - 'list_customer_name'
      - 'list_customer_phone'
      - 'list_plate_number'
      - 'list_plate_letters'
      - 'list_vehicle_brand'
      - 'list_vehicle_model'
      - 'list_vehicle_year'
      - 'list_vehicle_vin'
      - 'list_vehicle_color'
      - 'list_vehicle_image_url'
      - 'list_vehicle_thumbnail_url'
      - 'list_claim_approved_amount'
      - 'list_claim_estimated_amount'
      - 'list_claim_estimation_type'
      - 'list_insurance_company'
      - 'list_claim_number'
      - 'list_has_needed_parts'
      - 'list_workshop_days'
      || jsonb_build_object(
        '_customer', jsonb_build_object('name', p.list_customer_name, 'phone', p.list_customer_phone),
        '_vehicle', jsonb_build_object(
          'plateNumber', p.list_plate_number,
          'plateLetters', p.list_plate_letters,
          'brand', p.list_vehicle_brand,
          'model', p.list_vehicle_model,
          'year', p.list_vehicle_year,
          'vin', p.list_vehicle_vin,
          'color', p.list_vehicle_color,
          'imageUrl', p.list_vehicle_image_url,
          'thumbnailUrl', p.list_vehicle_thumbnail_url
        ),
        '_claim', jsonb_build_object(
          'approvedAmount', p.list_claim_approved_amount,
          'estimatedAmount', p.list_claim_estimated_amount,
          'estimationType', p.list_claim_estimation_type
        ),
        '_list', jsonb_build_object(
          'hasNeededParts', p.list_has_needed_parts,
          'workshopDays', p.list_workshop_days
        ),
        'insurance_company', p.list_insurance_company,
        'insurance_claim_number', p.list_claim_number,
        'actual_expense_cost', coalesce(cost.actual_expense_cost, 0)
      ) as row_json
  from paged p
  left join lateral (
    select coalesce(sum(coalesce(e.amount, 0)), 0)::numeric as actual_expense_cost
    from public.expenses e
    where e.tenant_id = p.tenant_id
      and e.deleted_at is null
      and e.archived_at is null
      and lower(coalesce(e.status::text, 'active')) not in ('cancelled', 'canceled', 'void', 'invalid', 'deleted')
      and (
        e.work_order_id = p.id
        or e.linked_work_order_id in (p.id::text, 'WO-' || p.id::text, p.order_number)
      )
  ) cost on true
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where status::text in ('received', 'inspection', 'in_progress'))::bigint as in_progress,
    count(*) filter (where status::text = 'completed')::bigint as ready,
    count(*) filter (where status::text = 'delivered')::bigint as delivered,
    count(*) filter (where claim_id is not null)::bigint as insurance,
    count(*) filter (where claim_id is null)::bigint as cash,
    count(*) filter (where list_has_needed_parts)::bigint as needing_parts,
    count(*) filter (
      where status::text not in ('completed', 'delivered') and list_workshop_days >= 11
    )::bigint as overdue
  from base
),
filter_options as (
  select jsonb_build_object(
    'technicians', coalesce((select jsonb_agg(value order by value) from (select distinct technician_name as value from base where nullif(trim(technician_name), '') is not null) q), '[]'::jsonb),
    'services', coalesce((select jsonb_agg(value order by value) from (select distinct service_type as value from base where nullif(trim(service_type), '') is not null) q), '[]'::jsonb),
    'insuranceCompanies', coalesce((select jsonb_agg(value order by value) from (select distinct list_insurance_company as value from base where nullif(trim(list_insurance_company), '') is not null) q), '[]'::jsonb)
  ) as value
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(row_json order by list_sort_order) from page_rows), '[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', greatest(coalesce(p_page, 1), 1),
    'pageSize', least(greatest(coalesce(p_page_size, 20), 1), 100),
    'totalRows', (select count(*) from filtered),
    'totalPages', case when (select count(*) from filtered) = 0 then 0 else ceil((select count(*) from filtered)::numeric / least(greatest(coalesce(p_page_size, 20), 1), 100))::integer end
  ),
  'summary', (select to_jsonb(summary) from summary),
  'filterOptions', (select value from filter_options)
);
$$;

revoke all on function public.work_orders_list_rpc(uuid, integer, integer, text, jsonb)
  from public, anon;
grant execute on function public.work_orders_list_rpc(uuid, integer, integer, text, jsonb)
  to authenticated;
