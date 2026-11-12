-- Preserve the existing authenticated return guards and idempotent response.
-- Append a custody event only when the user actually records a new return.
do $migration$
declare body text; anchor text;
begin
  select pg_get_functiondef('public.mark_vehicle_inspection_return(uuid)'::regprocedure) into body;
  if md5(body)<>'de34a486b09e3235e6f3ac3b2c3ad60f' then raise exception 'INSPECTION_RETURN_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,'v_now timestamptz := now();','v_now timestamptz;');
  anchor:='  update public.vehicle_inspection_releases set returned_at = v_now,';
  if strpos(body,anchor)=0 then raise exception 'INSPECTION_RETURN_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,anchor,$clock$  v_now:=clock_timestamp();
  if v_now<v_release.released_at then raise exception 'VEHICLE_VISIT_TIME_INVALID'; end if;
  update public.vehicle_inspection_releases set returned_at = v_now,$clock$);
  anchor:='  insert into public.vehicle_entry_audit_logs';
  if strpos(body,anchor)=0 then raise exception 'INSPECTION_RETURN_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,anchor,$event$  perform public.sync_vehicle_visit_from_source(v_entry.id,'entry');
  with changed as (
    update public.vehicle_visit_workflows set revision=revision+1,changed_at=v_now,changed_by=auth.uid()
      where entry_id=v_entry.id and tenant_id=v_tenant returning *
  ) insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source,requirements)
    select v_tenant,v_entry.id,w.revision,w.stage,w.stage,v_now,auth.uid(),auth.uid(),'manual',
      jsonb_build_object('action','temporary_return','release_id',v_release.id)
    from changed w;
  insert into public.vehicle_entry_audit_logs$event$);
  execute body;
end;
$migration$;
