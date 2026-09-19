-- Paginated customer registry with server-side search, filters and summary.
-- Read-only; customer detail and mutation paths remain unchanged.

create or replace function public.customers_list_rpc(
  p_tenant_id uuid,
  p_page integer default 1,
  p_page_size integer default 25,
  p_search text default '',
  p_type text default 'all',
  p_tag text default 'all'
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
order_stats as materialized (
  select
    jo.customer_id,
    count(*)::integer as visits,
    coalesce(sum(coalesce(jo.final_total, jo.subtotal, 0)), 0)::numeric as total_spent,
    count(*) filter (where jo.status::text not in ('completed', 'delivered'))::integer as pending_invoices,
    max(coalesce(jo.entry_date, jo.created_at::date)) as last_visit
  from public.job_orders jo
  join authorized a on a.tenant_id = jo.tenant_id
  where jo.deleted_at is null
  group by jo.customer_id
),
vehicle_stats as materialized (
  select v.customer_id, count(*)::integer as vehicles_count
  from public.vehicles v
  join authorized a on a.tenant_id = v.tenant_id
  where v.deleted_at is null
  group by v.customer_id
),
base as materialized (
  select
    c.*,
    coalesce(os.visits, 0)::integer as list_visits,
    coalesce(os.total_spent, 0)::numeric as list_total_spent,
    coalesce(os.pending_invoices, 0)::integer as list_pending_invoices,
    os.last_visit as list_last_visit,
    coalesce(vs.vehicles_count, 0)::integer as list_vehicles_count,
    case
      when coalesce(os.total_spent, 0) >= 5000 or coalesce(os.visits, 0) >= 5 then 'vip'
      when coalesce(os.visits, 0) = 0 then 'new'
      else 'regular'
    end as list_tag
  from public.customers c
  join authorized a on a.tenant_id = c.tenant_id
  left join order_stats os on os.customer_id = c.id
  left join vehicle_stats vs on vs.customer_id = c.id
  where c.deleted_at is null
    and coalesce(c.archived, false) = false
),
filtered as materialized (
  select * from base b
  where (coalesce(nullif(p_type, ''), 'all') = 'all' or coalesce(b.type, 'individual') = p_type)
    and (coalesce(nullif(p_tag, ''), 'all') = 'all' or b.list_tag = p_tag)
    and (
      nullif(trim(coalesce(p_search, '')), '') is null
      or concat_ws(' ', b.name, b.customer_code, b.phone, b.email,
        b.commercial_registration, b.contact_person, b.legal_name)
        ilike '%' || trim(p_search) || '%'
    )
),
paged as materialized (
  select * from filtered
  order by created_at desc, id desc
  offset greatest(coalesce(p_page, 1) - 1, 0) * least(greatest(coalesce(p_page_size, 25), 1), 100)
  limit least(greatest(coalesce(p_page_size, 25), 1), 100)
),
page_rows as (
  select
    to_jsonb(p)
      - 'list_visits'
      - 'list_total_spent'
      - 'list_pending_invoices'
      - 'list_last_visit'
      - 'list_vehicles_count'
      - 'list_tag'
      || jsonb_build_object(
        '_stats', jsonb_build_object(
          'visits', p.list_visits,
          'totalSpent', p.list_total_spent,
          'pendingInvoices', p.list_pending_invoices,
          'lastVisit', p.list_last_visit,
          'vehiclesCount', p.list_vehicles_count
        ),
        '_tag', p.list_tag
      ) as row_json
  from paged p
),
summary as (
  select
    count(*)::bigint as total,
    count(*) filter (where coalesce(type, 'individual') = 'company')::bigint as companies,
    count(*) filter (where list_visits > 0)::bigint as active,
    count(*) filter (where list_tag = 'vip')::bigint as vip,
    coalesce(sum(list_total_spent), 0)::numeric as total_revenue
  from base
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(row_json) from page_rows), '[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', greatest(coalesce(p_page, 1), 1),
    'pageSize', least(greatest(coalesce(p_page_size, 25), 1), 100),
    'totalRows', (select count(*) from filtered),
    'totalPages', case when (select count(*) from filtered) = 0 then 0 else ceil((select count(*) from filtered)::numeric / least(greatest(coalesce(p_page_size, 25), 1), 100))::integer end
  ),
  'summary', (select to_jsonb(summary) from summary)
);
$$;

revoke all on function public.customers_list_rpc(uuid, integer, integer, text, text, text)
  from public, anon;
grant execute on function public.customers_list_rpc(uuid, integer, integer, text, text, text)
  to authenticated;
