-- Development first. Read-only projection only: keep existing RLS, sources,
-- pagination, counts and scope token. No backfill and no business-row writes.
do $migration$
declare
  definition text;
  anchor text := '    and (coalesce(p_filters->>''status'',''all'')=''all'' or r->''entry''->>''status''=p_filters->>''status'')';
  insertion text := $filter$
    -- supervisor_channel_filter_v1: same contract as getVehicleVisitBillingKind.
    and (coalesce(p_filters->>'channel','all')='all' or p_filters->>'channel' = case when
      nullif(r->'entry'->>'insurance_claim_id','') is not null
      or nullif(r->'entry'->>'converted_claim_id','') is not null
      or nullif(r->'entry'->>'insurance_company_id','') is not null
      or r->'entry'->'insurance_snapshot'->'is_insurance_related'='true'::jsonb
      or nullif(btrim(r->'entry'->'insurance_snapshot'->>'claim_number'),'') is not null
      or nullif(btrim(r->'entry'->'insurance_snapshot'->>'company_name'),'') is not null
      or coalesce(nullif(r->'entry'->'work_order','null'::jsonb),nullif(r->'entry'->'converted_work_order','null'::jsonb))->>'work_order_type'='insurance'
      then 'insurance' else 'cash' end)
$filter$;
begin
  if not exists(select 1 from pg_proc where oid='public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure
    and not prosecdef and provolatile='s') then raise exception 'SUPERVISOR_CENTER_SECURITY_CONTRACT_CHANGED'; end if;
  select pg_get_functiondef('public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure) into definition;
  if position('supervisor_channel_filter_v1' in definition)>0 then
    if position(insertion in definition)=0 then raise exception 'SUPERVISOR_CENTER_FILTER_DRIFT'; end if;
    return;
  end if;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1
    or position('  with center_rows as materialized (' in definition)=0 then
    raise exception 'SUPERVISOR_CENTER_PROJECTION_DRIFT';
  end if;
  definition := replace(definition,anchor,insertion || anchor);
  definition := replace(definition,'  with center_rows as materialized (',
    '  if coalesce(p_filters->>''channel'',''all'') not in (''all'',''cash'',''insurance'') then raise exception ''VEHICLE_CENTER_INVALID_REQUEST''; end if;' || chr(10) || '  with center_rows as materialized (');
  execute definition;
end;
$migration$;
