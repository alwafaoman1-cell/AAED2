-- Reports Center tenant null-guard hardening.
-- PostgreSQL "<> NULL" is unknown, so use IS DISTINCT FROM to fail closed
-- when an authenticated identity has no tenant profile.

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
  if p_tenant_id is null
    or p_tenant_id is distinct from public.get_user_tenant_id()
  then
    raise exception 'reports_tenant_access_denied' using errcode = '42501';
  end if;
  if not public.reports_has_permission(p_permission) then
    raise exception 'reports_permission_denied' using errcode = '42501';
  end if;
  return true;
end;
$$;

create or replace function public.reports_secure_query_rpc(
  p_tenant_id uuid,
  p_report_key text,
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
  perform public.reports_assert_access(
    p_tenant_id,
    public.reports_permission_for_key(p_report_key)
  );
  return public.reports_center_query_rpc(
    p_tenant_id, p_report_key, p_from_date, p_to_date, p_business_type,
    p_filters, p_search, p_sort, p_direction, p_page, p_page_size
  );
end;
$$;

create or replace function public.reports_center_secure_summary_rpc(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_business_type text default 'all',
  p_insurance_company_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public.reports_assert_access(p_tenant_id, 'reports.accounting');
  return public.reports_center_summary_rpc(
    p_tenant_id, p_from_date, p_to_date, p_business_type, p_insurance_company_id
  );
end;
$$;

revoke all on function public.reports_assert_access(uuid, text)
  from public, anon, authenticated;
revoke all on function public.reports_secure_query_rpc(uuid, text, date, date, text, jsonb, text, text, text, integer, integer)
  from public, anon, authenticated;
revoke all on function public.reports_center_secure_summary_rpc(uuid, date, date, text, uuid)
  from public, anon;
grant execute on function public.reports_center_secure_summary_rpc(uuid, date, date, text, uuid)
  to authenticated;
