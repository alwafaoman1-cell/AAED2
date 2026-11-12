-- Replace per-card re-reading of the same entry/claim/order with one set-based
-- stage-only bridge. Same active-role/tenant boundary as the existing bridge;
-- no PII or hidden source rows are returned, and all page joins remain invoker/RLS.
create function public.vehicle_visit_center_projection_batch_v1(p_tenant_id uuid,p_rows jsonb)
returns table(item_key text,projection jsonb)
language plpgsql stable security definer set search_path='' as $batch$
begin
  if auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or coalesce(public.get_user_role()::text,'') not in ('admin','manager','supervisor','technician','insurance')
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=p_tenant_id
      and p.account_status='active' and p.disabled_at is null) then
    raise exception 'VEHICLE_CENTER_TENANT_MISMATCH' using errcode='42501';
  end if;
  if jsonb_typeof(p_rows) is distinct from 'array' then raise exception 'VEHICLE_CENTER_INVALID_REQUEST';end if;
  if exists(select 1 from jsonb_array_elements(p_rows) r where r->'entry'->>'tenant_id' is distinct from p_tenant_id::text
    or (not coalesce((r->'entry'->>'_claimOnly')::boolean,false) and not exists(select 1 from public.vehicle_entries e
      where e.id=(r->'entry'->>'id')::uuid and e.tenant_id=p_tenant_id and e.deleted_at is null))) then
    raise exception 'VEHICLE_CENTER_ENTRY_NOT_VISIBLE' using errcode='42501';
  end if;
  return query
  with requested as materialized(select value as payload,value->'entry'->>'id' id from jsonb_array_elements(p_rows)),
  stages as (
  select e.id,case
    when e.status='Cancelled' or c.status::text in ('cancelled','rejected') then 'cancelled'
    when j.status::text='delivered' and exists(select 1 from public.vehicle_handover_records h
      where h.tenant_id=p_tenant_id and h.vehicle_entry_id=e.id and h.work_order_id=j.id and h.status='finalized') then 'delivered'
    when j.status::text in ('completed','delivered') or j.work_completed_at is not null or c.work_completed_at is not null
      or c.repair_stage in ('ready','quality_check','delivered') then 'ready'
    when j.status::text in ('in_progress','waiting_parts') or j.work_started_at is not null or c.work_started_at is not null
      or c.repair_stage in ('repairing','in_progress') then 'in_progress'
    when c.status::text in ('approved','paid') or c.approved_at is not null or c.insurance_approved_at is not null then 'approved'
    else 'arrived' end as evidence_stage
  from public.vehicle_entries e
  left join public.insurance_claims c on c.id=coalesce(e.insurance_claim_id,e.converted_claim_id) and c.tenant_id=p_tenant_id and c.deleted_at is null
  left join public.job_orders j on j.id=coalesce(e.work_order_id,e.converted_work_order_id) and j.tenant_id=p_tenant_id and j.deleted_at is null
  where e.tenant_id=p_tenant_id and e.deleted_at is null
    and e.id in(select (id)::uuid from requested where not coalesce((payload->'entry'->>'_claimOnly')::boolean,false))
  )
  select q.id,public.vehicle_visit_center_resolve_v1(q.payload->'entry',nullif(q.payload->'workflow','null'::jsonb),
    (q.payload->>'final_handover')::boolean,(q.payload->>'temporary_release')::boolean,coalesce(s.evidence_stage,'arrived'))
  from requested q left join stages s on s.id::text=q.id;
end;
$batch$;
revoke all on function public.vehicle_visit_center_projection_batch_v1(uuid,jsonb) from public,anon;
grant execute on function public.vehicle_visit_center_projection_batch_v1(uuid,jsonb) to authenticated;

do $migration$
declare body text;old_text text;new_text text;source_name text;prefix text := '';
begin
  select pg_get_functiondef('public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure)into body;
  old_text:=$old$), resolved as materialized (
  select r.*, public.vehicle_visit_center_evidence_v1(p_tenant_id,entry,workflow,final_handover,temporary_release) projection from raw_rows r
), duplicates as ($old$;
  new_text:=$new$), projection_batch as materialized (
    select * from public.vehicle_visit_center_projection_batch_v1(p_tenant_id,coalesce((select jsonb_agg(jsonb_build_object(
      'entry',entry,'workflow',workflow,'final_handover',final_handover,'temporary_release',temporary_release))from raw_rows),'[]'::jsonb))
), resolved as materialized (
  select r.*, p.projection from raw_rows r join projection_batch p on p.item_key=r.item_key
), duplicates as ($new$;
  if strpos(body,old_text)=0 then raise exception 'CENTER_EVIDENCE_DEFINITION_REVIEW_REQUIRED';end if;
  body:=replace(body,old_text,new_text);
  body:=replace(body,'p_tenant_id=public.get_user_tenant_id()','p_tenant_id=(select public.get_user_tenant_id())');
  body:=replace(body,'auth.uid() is not null','(select auth.uid()) is not null');
  -- EXPLAIN on 120 isolated Development visits showed repeated tenant-index
  -- scans of vehicles/workflows, re-evaluating RLS for every outer entry.
  -- Materialize each caller-visible tenant source once. This keeps the page
  -- SECURITY INVOKER and the exact policies, instead of weakening those policies.
  if strpos(body,'with entries as materialized (')=0 then raise exception 'CENTER_SOURCE_DEFINITION_REVIEW_REQUIRED';end if;
  foreach source_name in array array['vehicles','customers','insurance_companies','vehicle_visit_workflows','vehicle_handover_records','vehicle_inspection_releases'] loop
    body:=replace(body,'public.'||source_name||' ', 'center_'||source_name||' ');
    prefix:=prefix||'center_'||source_name||' as materialized (select * from public.'||source_name||' where tenant_id=p_tenant_id), ';
  end loop;
  body:=replace(body,'with entries as materialized (','with '||prefix||'entries as materialized (');
  execute body;
end;
$migration$;
