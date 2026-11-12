-- Development first. No data backfill or historical custody/financial repair.
-- Keep the existing atomic intake identity, RLS, marks and declaration logic.
do $migration$
declare body text; before_body text; old_text text; new_text text; fname text;
begin
  select pg_get_functiondef('public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer)'::regprocedure) into body;
  before_body:=body;
  old_text:=$old$v_condition := p_form->'condition'; v_contents := p_form->'contents';$old$;
  new_text:=$new$v_condition := (p_form->'condition') - 'arrival_confirmation' - 'arrival_confirmation_at' - 'arrival_request_revision';
  if p_entry_id is null then
    v_condition := v_condition || jsonb_build_object('arrival_confirmation',case when v_condition->>'visit_purpose'='inspection' then 'pending' else 'confirmed' end);
  else
    select v_condition || coalesce((select jsonb_object_agg(k,v) from jsonb_each(e.vehicle_condition) p(k,v)
      where k in ('arrival_confirmation','arrival_confirmation_at','arrival_request_revision')),'{}'::jsonb)
      into v_condition from public.vehicle_entries e where e.id=p_entry_id and e.tenant_id=v_tenant;
  end if;
  v_contents := p_form->'contents';$new$;
  if strpos(body,old_text)=0 then raise exception 'INTAKE_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,old_text,new_text);
  old_text:=$old$(p_form->>'arrival_date')::date,(p_form->>'arrival_time')::time,'داخل الورشة',nullif(p_form->>'vehicle_location_bay',''),$old$;
  new_text:=$new$(p_form->>'arrival_date')::date,(p_form->>'arrival_time')::time,
      case when v_condition->>'arrival_confirmation'='pending' then 'مع العميل' else 'داخل الورشة' end,nullif(p_form->>'vehicle_location_bay',''),$new$;
  if strpos(body,old_text)=0 or body=before_body then raise exception 'INTAKE_DEFINITION_REVIEW_REQUIRED'; end if;
  execute replace(body,old_text,new_text);

  select pg_get_functiondef('public.vehicle_visit_center_resolve_v1(jsonb,jsonb,boolean,boolean,text)'::regprocedure) into body;
  old_text:=$old$when c->>'status' in ('cancelled','rejected') then case when o<>'{}'::jsonb then 'needs_review' else 'cancelled' end$old$;
  if strpos(body,old_text)=0 then raise exception 'CENTER_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,old_text,$new$when c->>'status' in ('cancelled','rejected') then 'cancelled'$new$);
  body:=replace(body,$old$'centerTab','needs_review','presence',presence$old$,$new$'centerTab',case when stage in ('cancelled','delivered') then stage else 'needs_review' end,'presence',presence$new$);
  old_text:=$old$if linked_claim is null and (e->>'insurance_company_id' is not null or nullif(trim(e->'insurance_snapshot'->>'claim_number'),'') is not null
    or nullif(trim(e->'insurance_snapshot'->>'company_name'),'') is not null or o->>'work_order_type'='insurance') then reason := coalesce(reason,'insurance_claim_required'); end if;$old$;
  if strpos(body,old_text)=0 then raise exception 'CENTER_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,old_text,'-- Claim creation is a later explicit step; approval/start guards still enforce it.');
  old_text:=$old$and c->>'cancelled_handover_signed_at' is null then$old$;
  if strpos(body,old_text)=0 then raise exception 'CENTER_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,old_text,$new$and c->>'cancelled_handover_signed_at' is null
    and not (coalesce(e#>>'{vehicle_condition,arrival_confirmation}','')='pending'
      and coalesce(e#>>'{vehicle_condition,visit_purpose}','')='inspection' and e->>'vehicle_location'='مع العميل') then$new$);
  old_text:=$old$when presence='with_customer' and temporary_release then 'with_customer'$old$;
  if strpos(body,old_text)=0 then raise exception 'CENTER_DEFINITION_REVIEW_REQUIRED'; end if;
  body:=replace(body,old_text,$new$when presence='with_customer' and (temporary_release or
    (e#>>'{vehicle_condition,arrival_confirmation}'='pending' and e#>>'{vehicle_condition,visit_purpose}'='inspection')) then 'with_customer'$new$);
  execute body;
  -- A cancelled claim remains in Cancelled even when its old links require
  -- review. Classification is read-only; the warning is not erased.
  foreach fname in array array['vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)','vehicle_visit_center_rows_v1(uuid)'] loop
    select pg_get_functiondef(('public.'||fname)::regprocedure) into body;
    old_text:='duplicate_order or (entry->>''vehicle_id'' is not null';
    if strpos(body,old_text)=0 then raise exception 'CENTER_DUPLICATE_DEFINITION_REVIEW_REQUIRED'; end if;
    execute replace(body,old_text,'(duplicate_order and projection->>''operationalStage'' not in (''delivered'',''cancelled'')) or (entry->>''vehicle_id'' is not null');
  end loop;
end;
$migration$;

-- Explicit first physical arrival for prepared inspection forms. Existing
-- temporary-release return remains its separate, unchanged signed-paper RPC.
create function public.register_vehicle_visit_arrival(
  p_entry_id uuid,p_expected_updated_at timestamptz,p_occurred_at timestamptz
) returns jsonb language plpgsql security definer set search_path='' as $arrival$
declare
  tenant uuid:=public.get_user_tenant_id(); actor uuid:=auth.uid();
  e public.vehicle_entries%rowtype; w public.vehicle_visit_workflows%rowtype;
  c public.insurance_claims%rowtype; j public.job_orders%rowtype;
  previous_setting text:=current_setting('app.vehicle_visit_manual_transition',true);
begin
  if actor is null or tenant is null or coalesce(public.get_user_role()::text,'') not in ('admin','manager','insurance','supervisor')
    or not exists(select 1 from public.profiles p where p.user_id=actor and p.tenant_id=tenant and p.account_status='active' and p.disabled_at is null) then
    raise exception 'VEHICLE_VISIT_PERMISSION_DENIED' using errcode='42501';
  end if;
  select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=tenant and deleted_at is null for update;
  if not found then raise exception 'VEHICLE_VISIT_NOT_FOUND'; end if;
  -- Same acknowledged request may be read again after a lost network response.
  if e.vehicle_location='داخل الورشة' and e.vehicle_condition->>'arrival_confirmation'='confirmed'
    and e.vehicle_condition->>'arrival_request_revision'=p_expected_updated_at::text then return to_jsonb(e); end if;
  if p_expected_updated_at is null or e.updated_at is distinct from p_expected_updated_at then raise exception 'VEHICLE_INTAKE_STALE' using errcode='40001'; end if;
  if p_occurred_at is null or p_occurred_at>now()+interval '5 minutes'
    or p_occurred_at<((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat') then raise exception 'VEHICLE_VISIT_TIME_INVALID'; end if;
  select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=tenant for update;
  if not found or w.review_reason is not null or w.stage in ('cancelled','delivered') or e.status='Cancelled'
    or e.vehicle_location is distinct from 'مع العميل'
    or coalesce(e.vehicle_condition->>'arrival_confirmation','')<>'pending'
    or e.vehicle_condition->>'visit_purpose' is distinct from 'inspection'
    or public.vehicle_visit_has_conflicting_entry(e.id) then raise exception 'VEHICLE_VISIT_REVIEW_REQUIRED'; end if;
  if (e.insurance_claim_id is not null and e.converted_claim_id is not null and e.insurance_claim_id<>e.converted_claim_id)
    or (e.work_order_id is not null and e.converted_work_order_id is not null and e.work_order_id<>e.converted_work_order_id) then raise exception 'VEHICLE_VISIT_LINK_REVIEW_REQUIRED'; end if;
  if coalesce(e.insurance_claim_id,e.converted_claim_id) is not null then
    select * into c from public.insurance_claims where id=coalesce(e.insurance_claim_id,e.converted_claim_id) and tenant_id=tenant and deleted_at is null for update;
    if not found or c.vehicle_id is distinct from e.vehicle_id or c.status::text in ('cancelled','rejected')
      or c.delivered_at is not null or c.vehicle_delivered_at is not null then raise exception 'VEHICLE_VISIT_LINK_REVIEW_REQUIRED'; end if;
  end if;
  if coalesce(e.work_order_id,e.converted_work_order_id) is not null then
    select * into j from public.job_orders where id=coalesce(e.work_order_id,e.converted_work_order_id) and tenant_id=tenant and deleted_at is null for update;
    if not found or j.vehicle_id is distinct from e.vehicle_id or j.claim_id is distinct from c.id
      or j.status::text='delivered' or j.vehicle_delivered_at is not null
      or (c.id is not null and j.work_order_type is distinct from 'insurance')
      or (c.id is null and j.work_order_type='insurance') then raise exception 'VEHICLE_VISIT_LINK_REVIEW_REQUIRED'; end if;
  end if;
  perform set_config('app.vehicle_visit_manual_transition','on',true);
  update public.vehicle_entries set vehicle_location='داخل الورشة',updated_at=now(),updated_by=actor,
    vehicle_condition=vehicle_condition||jsonb_build_object('arrival_confirmation','confirmed','arrival_confirmation_at',p_occurred_at,'arrival_request_revision',p_expected_updated_at::text)
    where id=e.id and tenant_id=tenant returning * into e;
  update public.insurance_claims set vehicle_presence_status='in_workshop',updated_at=now() where id=c.id and tenant_id=tenant;
  update public.job_orders set vehicle_presence_status='in_workshop',updated_at=now() where id=j.id and tenant_id=tenant;
  update public.claim_work_order_operations set vehicle_presence_status='in_workshop',updated_at=now(),last_changed_from='system',last_changed_by=actor
    where tenant_id=tenant and (claim_id=c.id or work_order_id=j.id);
  update public.vehicle_visit_workflows set revision=revision+1,changed_at=now(),changed_by=actor where entry_id=e.id and tenant_id=tenant returning * into w;
  insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source,requirements)
    values(tenant,e.id,w.revision,w.stage,w.stage,p_occurred_at,actor,actor,'manual',jsonb_build_object('action','actual_arrival','previous_location','with_customer'));
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(tenant,e.id,actor,'vehicle_entry.actual_arrival',jsonb_build_object('occurred_at',p_occurred_at,'vehicle_location','داخل الورشة'));
  perform set_config('app.vehicle_visit_manual_transition',coalesce(previous_setting,''),true);
  return to_jsonb(e);
end;
$arrival$;
revoke all on function public.register_vehicle_visit_arrival(uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.register_vehicle_visit_arrival(uuid,timestamptz,timestamptz) to authenticated;
