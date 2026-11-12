-- Read-only versioned presentation. Old v1 clients remain compatible during
-- rollout; no identity, custody, financial data or historical document changes.
do $migration$
declare body text;
begin
  select pg_get_functiondef('public.vehicle_visit_center_resolve_v1(jsonb,jsonb,boolean,boolean,text)'::regprocedure) into body;
  if md5(body)<>'8835d1675e980baa0deb4cdc26370b03' then raise exception 'CENTER_CANCELLED_PROJECTION_REVIEW_REQUIRED'; end if;
  if strpos(body,$old$  if coalesce((e->>'_claimOnly')::boolean,false) then
$old$)=0 then raise exception 'CENTER_CANCELLED_SOURCE_REVIEW_REQUIRED'; end if;
  execute replace(body,$old$  if coalesce((e->>'_claimOnly')::boolean,false) then
$old$,$new$  if coalesce((e->>'_claimOnly')::boolean,false) then
    -- v2 presentation contract only; v1 clients keep their original projection.
    if current_setting('app.vehicle_center_projection_version',true)='2'
      and c->>'status' in ('cancelled','rejected') then
      return jsonb_build_object('stage','cancelled','operationalStage','cancelled',
        'reviewReason','claim_without_entry','centerTab','cancelled','presence',presence);
    end if;
$new$);
end;
$migration$;

create function public.vehicle_visit_center_page_v2(
 p_tenant_id uuid,p_tab text default 'in_workshop',p_filters jsonb default '{}',
 p_page integer default 1,p_page_size integer default 30
) returns jsonb language plpgsql security invoker set search_path='' as $page$
declare result jsonb; previous text:=current_setting('app.vehicle_center_projection_version',true);
begin
  -- Query semantics only. This flag is not used by writes, RLS or permissions.
  perform set_config('app.vehicle_center_projection_version','2',true);
  result:=public.vehicle_visit_center_page_v1(p_tenant_id,p_tab,p_filters,p_page,p_page_size);
  perform set_config('app.vehicle_center_projection_version',coalesce(previous,''),true);
  return result;
exception when others then
  perform set_config('app.vehicle_center_projection_version',coalesce(previous,''),true);
  raise;
end;
$page$;
revoke all on function public.vehicle_visit_center_page_v2(uuid,text,jsonb,integer,integer) from public,anon;
grant execute on function public.vehicle_visit_center_page_v2(uuid,text,jsonb,integer,integer) to authenticated;
