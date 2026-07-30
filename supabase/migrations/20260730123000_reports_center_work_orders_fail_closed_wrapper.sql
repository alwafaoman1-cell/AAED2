-- Force the optimized Work Orders endpoint to evaluate tenant/permission checks
-- before its SQL plan. The query implementation remains unchanged.

do $$
begin
  if to_regprocedure(
    'public.reports_work_orders_query_v1(uuid,date,date,text,jsonb,text,text,text,integer,integer)'
  ) is null then
    alter function public.reports_work_orders_rpc(
      uuid,date,date,text,jsonb,text,text,text,integer,integer
    ) rename to reports_work_orders_query_v1;
  end if;
end;
$$;

revoke all on function public.reports_work_orders_query_v1(
  uuid,date,date,text,jsonb,text,text,text,integer,integer
) from public, anon, authenticated;

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
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.reports_assert_access(p_tenant_id, 'reports.operations');
  return public.reports_work_orders_query_v1(
    p_tenant_id, p_from_date, p_to_date, p_business_type, p_filters,
    p_search, p_sort, p_direction, p_page, p_page_size
  );
end;
$$;

revoke all on function public.reports_work_orders_rpc(
  uuid,date,date,text,jsonb,text,text,text,integer,integer
) from public, anon;
grant execute on function public.reports_work_orders_rpc(
  uuid,date,date,text,jsonb,text,text,text,integer,integer
) to authenticated;
