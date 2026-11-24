-- Relax operational prerequisites only through the confirmed tenant policy.
-- Every actual bypass has durable evidence; identity, concurrency and receipt
-- validity are retained. Existing signed/finalized rows are never rewritten.
begin;

create function app_private.workflow_handover_exception(p_handover uuid,p_tenant uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.vehicle_handover_records h
 join public.workflow_requirement_audit a on a.id::text=h.snapshot_json->>'workflowRequirementOverrideId'
 where h.id=p_handover and h.tenant_id=p_tenant and h.status='finalized'
 and a.tenant_id=h.tenant_id and a.entity_type='vehicle_handover'
 and a.entity_id=h.id and a.action='finalize_handover' and a.requirements_enabled=false)
$$;
revoke all on function app_private.workflow_handover_exception(uuid,uuid) from public,anon,authenticated,service_role;

alter table public.vehicle_entry_custody_receipts add column workflow_requirement_override_id uuid
 references public.workflow_requirement_audit(id);
do $receipt_check$
declare c record;
begin
 for c in select conname from pg_catalog.pg_constraint
 where conrelid='public.vehicle_entry_custody_receipts'::regclass and contype='c'
 and position('actual_recipient_name' in pg_get_constraintdef(oid))>0 loop
  execute format('alter table public.vehicle_entry_custody_receipts drop constraint %I',c.conname);
 end loop;
end $receipt_check$;
alter table public.vehicle_entry_custody_receipts add constraint vehicle_custody_used_evidence_check
 check(status<>'used' or (used_at is not null and used_by is not null
 and (nullif(trim(actual_recipient_name),'') is not null or workflow_requirement_override_id is not null)));

create or replace function app_private.custody_consume_at_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; c public.vehicle_entry_custody_receipts;
 r public.vehicle_entry_signed_revisions; reason text; reference text;
 enforced boolean; override_id uuid;
begin
 if NEW.status<>'finalized' or OLD.status='finalized' then return NEW; end if;
 if not app_private.custody_can('Deliver',NEW.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select * into e from public.vehicle_entries where id=NEW.vehicle_entry_id and tenant_id=NEW.tenant_id
 and deleted_at is null and status<>'Cancelled' for update;
 if not found then raise exception 'CUSTODY_ENTRY_REQUIRED'; end if;
 enforced:=app_private.workflow_requirements_enforced(e.tenant_id);
 if not enforced then
  select a.id into override_id from public.workflow_requirement_audit a
  where a.id::text=NEW.snapshot_json->>'workflowRequirementOverrideId'
   and a.tenant_id=e.tenant_id and a.entity_type='vehicle_handover' and a.entity_id=NEW.id
   and a.action='finalize_handover' and a.requirements_enabled=false and a.actor_id=auth.uid();
  if override_id is null then raise exception 'WORKFLOW_POLICY_OVERRIDE_REQUIRED'; end if;
 end if;
 reference:=nullif(trim(NEW.snapshot_json->>'custodyReceiptId'),'');
 -- Supplying a receipt always means validating and consuming that exact receipt.
 -- Neither the global switch nor a legacy reason can excuse a wrong/used receipt.
 if reference is not null then
  select * into c from public.vehicle_entry_custody_receipts
   where tenant_id=e.tenant_id and id::text=reference for update;
  if not found then raise exception 'CUSTODY_NOT_VALID'; end if;
  select * into r from public.vehicle_entry_signed_revisions where id=c.revision_id and tenant_id=e.tenant_id;
  if c.vehicle_entry_id<>e.id or c.vehicle_id<>e.vehicle_id or NEW.vehicle_id<>e.vehicle_id then raise exception 'CUSTODY_WRONG_VISIT'; end if;
  if r.id is null or c.status<>'issued' or r.revision<>e.intake_revision then raise exception 'CUSTODY_NOT_VALID'; end if;
  if enforced and nullif(trim(NEW.recipient_name),'') is null then raise exception 'CUSTODY_RECIPIENT_REQUIRED'; end if;
  update public.vehicle_entry_custody_receipts set status='used',used_at=clock_timestamp(),used_by=auth.uid(),handover_id=NEW.id,
   actual_recipient_name=nullif(trim(NEW.recipient_name),''),delivered_at=NEW.delivered_at,
   workflow_requirement_override_id=override_id where id=c.id;
  insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id,details)
   values(e.tenant_id,e.id,c.id,'used',auth.uid(),jsonb_build_object('handover_id',NEW.id,'recipient_name',NEW.recipient_name,
   'delivered_at',NEW.delivered_at,'workflow_requirement_override_id',override_id));
  return NEW;
 end if;
 if not enforced then
  insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,action,actor_id,details)
   values(e.tenant_id,e.id,'workflow_requirement_delivery_exception',auth.uid(),jsonb_build_object('handover_id',NEW.id,
    'workflow_requirement_override_id',override_id,'recipient_name',NEW.recipient_name,'delivered_at',NEW.delivered_at));
  return NEW;
 end if;
 reason:=trim(coalesce(NEW.snapshot_json->>'legacyReceiptReason',''));
 if reason<>'' then
  if e.custody_receipt_required or not app_private.custody_can('Legacy exception',e.tenant_id) then raise exception 'CUSTODY_LEGACY_FORBIDDEN'; end if;
  if length(reason)<5 then raise exception 'CUSTODY_REASON_REQUIRED'; end if;
  insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,action,actor_id,details)
   values(e.tenant_id,e.id,'legacy_delivery_exception',auth.uid(),jsonb_build_object('reason',reason,'handover_id',NEW.id,
    'recipient_name',NEW.recipient_name,'delivered_at',NEW.delivered_at));
  return NEW;
 end if;
 raise exception 'CUSTODY_RECEIPT_REQUIRED';
end $$;

do $finalize_patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('public.finalize_vehicle_handover(uuid)'::regprocedure),E'\r\n',E'\n');
 needle:='  v_receipt text;';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: finalizer declaration'; end if;
 definition:=replace(definition,needle,needle||E'\n  v_override_id uuid;');
 needle:=$needle$if nullif(trim(v_record.recipient_name), '') is null then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: recipient'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(v_tenant) and nullif(trim(v_record.recipient_name), '') is null then$replacement$);
 needle:=$needle$if nullif(trim(coalesce(v_record.signature_data_url, '')), '') is null and ($needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: handover signature'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(v_tenant) and nullif(trim(coalesce(v_record.signature_data_url, '')), '') is null and ($replacement$);
 needle:='if exists(select 1 from public.vehicle_review_returns where return_entry_id=v_record.vehicle_entry_id and tenant_id=v_tenant)';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: review readiness'; end if;
 -- Only the first readiness guard changes; the later review-specific return stays.
 definition:=replace(definition,needle||E'\n   and not exists',
  'if app_private.workflow_requirements_enforced(v_tenant) and exists(select 1 from public.vehicle_review_returns where return_entry_id=v_record.vehicle_entry_id and tenant_id=v_tenant)'||E'\n   and not exists');
 needle:='  v_year := extract(year from v_record.delivered_at at time zone ''Asia/Muscat'')::integer;';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: finalization audit'; end if;
 definition:=replace(definition,needle,$replacement$  v_override_id := app_private.record_workflow_requirement_override(v_tenant,'vehicle_handover',v_record.id,'finalize_handover',
    jsonb_build_object('vehicle_entry_id',v_record.vehicle_entry_id,'work_order_id',v_record.work_order_id,
      'recipient_recorded',nullif(trim(v_record.recipient_name),'') is not null,
      'signature_recorded',nullif(v_record.signature_data_url,'') is not null,
      'custody_receipt_id',v_record.snapshot_json->>'custodyReceiptId'));
$replacement$||needle);
 needle:='    status = ''finalized'', receipt_number = v_receipt,';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: finalization snapshot'; end if;
 definition:=replace(definition,needle,$replacement$    snapshot_json = coalesce(snapshot_json,'{}'::jsonb) || case when v_override_id is null then '{}'::jsonb
      else jsonb_build_object('workflowRequirementOverrideId',v_override_id) end,
$replacement$||needle);
 execute definition;
end $finalize_patch$;

do $advance_patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('public.advance_vehicle_visit(uuid,integer,text,timestamptz,text,text,uuid,jsonb)'::regprocedure),E'\r\n',E'\n');
 needle:='if public.vehicle_visit_stage_rank(p_target_stage) <> public.vehicle_visit_stage_rank(v_state.stage) + 1 then';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: stage sequencing'; end if;
 definition:=replace(definition,needle,'if app_private.workflow_requirements_enforced(v_tenant) and public.vehicle_visit_stage_rank(p_target_stage) <> public.vehicle_visit_stage_rank(v_state.stage) + 1 then');
 needle:='if v_claim.status::text not in (''approved'',''paid'') then';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: approval'; end if;
 definition:=replace(definition,needle,'if app_private.workflow_requirements_enforced(v_tenant) and v_claim.status::text not in (''approved'',''paid'') then');
 needle:=$needle$elsif v_role = 'insurance' or v_order.id is null
        or coalesce(p_requirements->>'customer_approved','false') <> 'true' then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: cash approval'; end if;
 definition:=replace(definition,needle,$replacement$elsif v_role = 'insurance' or v_order.id is null
        or (app_private.workflow_requirements_enforced(v_tenant) and coalesce(p_requirements->>'customer_approved','false') <> 'true') then$replacement$);
 needle:=$needle$if v_entry.vehicle_location is distinct from 'داخل الورشة'
        or v_order.vehicle_presence_status = 'with_customer'
        or v_claim.vehicle_presence_status = 'with_customer' then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: workshop presence'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(v_tenant) and (v_entry.vehicle_location is distinct from 'داخل الورشة'
        or v_order.vehicle_presence_status = 'with_customer'
        or v_claim.vehicle_presence_status = 'with_customer') then$replacement$);
 needle:='if v_claim.id is not null and v_claim.status::text not in (''approved'',''paid'') then';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: work approval'; end if;
 definition:=replace(definition,needle,'if app_private.workflow_requirements_enforced(v_tenant) and v_claim.id is not null and v_claim.status::text not in (''approved'',''paid'') then');
 needle:='if v_order.status::text not in (''received'',''inspection'',''waiting_parts'',''in_progress'') then';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: work status'; end if;
 definition:=replace(definition,needle,'if app_private.workflow_requirements_enforced(v_tenant) and v_order.status::text not in (''received'',''inspection'',''waiting_parts'',''in_progress'') then');
 needle:='if v_order.id is null or v_order.status::text <> ''completed'' then';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: completed order'; end if;
 definition:=replace(definition,needle,'if v_order.id is null or (app_private.workflow_requirements_enforced(v_tenant) and v_order.status::text <> ''completed'') then');
 needle:='  update public.vehicle_visit_workflows set stage = p_target_stage, revision = revision + 1,';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: transition audit'; end if;
 definition:=replace(definition,needle,$replacement$  p_requirements := coalesce(p_requirements,'{}'::jsonb) || jsonb_build_object('workflow_requirement_override_id',
    app_private.record_workflow_requirement_override(v_tenant,'vehicle_visit',p_entry_id,'advance_vehicle_visit',
    jsonb_build_object('from_stage',v_from_stage,'to_stage',p_target_stage,'workflow_revision',v_state.revision,
      'vehicle_id',v_entry.vehicle_id,'claim_id',v_claim.id,'work_order_id',v_order.id)));
$replacement$||needle);
 execute definition;
 definition:=replace(pg_get_functiondef('app_private.advance_review_visit(uuid,integer,text,timestamptz,text,text,uuid)'::regprocedure),E'\r\n',E'\n');
 needle:=$needle$if p_target<>'cancelled' and not exists(select 1 from public.vehicle_entry_signatures$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: review signature'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(tenant) and p_target<>'cancelled' and not exists(select 1 from public.vehicle_entry_signatures$replacement$);
 needle:=$needle$elsif not ((w.stage in ('arrived','approved') and p_target='in_progress') or (w.stage='in_progress' and p_target='ready')) then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: review sequence'; end if;
 definition:=replace(definition,needle,$replacement$elsif p_target not in ('in_progress','ready') or (app_private.workflow_requirements_enforced(tenant) and not ((w.stage in ('arrived','approved') and p_target='in_progress') or (w.stage='in_progress' and p_target='ready'))) then$replacement$);
 needle:=$needle$if p_target='ready' and (role_name not in ('admin','manager','supervisor') or length(trim(coalesce(p_notes,'')))<5) then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: review findings'; end if;
 definition:=replace(definition,needle,$replacement$if p_target='ready' and (role_name not in ('admin','manager','supervisor') or (app_private.workflow_requirements_enforced(tenant) and length(trim(coalesce(p_notes,'')))<5)) then$replacement$);
 needle:=$needle$if p_target<>'cancelled' and e.vehicle_location is distinct from 'داخل الورشة' then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: review presence'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(tenant) and p_target<>'cancelled' and e.vehicle_location is distinct from 'داخل الورشة' then$replacement$);
 needle:=' update public.vehicle_visit_workflows set stage=p_target';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: review audit'; end if;
 definition:=replace(definition,needle,$replacement$ perform app_private.record_workflow_requirement_override(tenant,'vehicle_visit',p_entry,'advance_review_visit',
  jsonb_build_object('from_stage',w.stage,'to_stage',p_target,'workflow_revision',w.revision));
$replacement$||needle);
 execute definition;
end $advance_patch$;

do $manager_patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('public.adjust_vehicle_visit_manager(uuid,integer,timestamptz,text,text,jsonb,timestamptz,text,uuid)'::regprocedure),E'\r\n',E'\n');
 needle:=$needle$if review and p_target_stage is distinct from old_context->>'stage' and p_target_stage in ('in_progress','ready')$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: manager review signature'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(tenant) and review and p_target_stage is distinct from old_context->>'stage' and p_target_stage in ('in_progress','ready')$replacement$);
 needle:=$needle$if not review and p_target_stage='approved' and w.stage is distinct from 'approved' then$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: manager approval'; end if;
 definition:=replace(definition,needle,$replacement$if app_private.workflow_requirements_enforced(tenant) and not review and p_target_stage='approved' and w.stage is distinct from 'approved' then$replacement$);
 needle:=' next_revision:=w.revision+1;';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: manager audit'; end if;
 definition:=replace(definition,needle,$replacement$ perform app_private.record_workflow_requirement_override(tenant,'vehicle_visit',e.id,'adjust_vehicle_visit_manager',
  jsonb_build_object('from_stage',w.stage,'to_stage',p_target_stage,'workflow_revision',w.revision,'request_id',p_request_id));
$replacement$||needle);
 execute definition;
end $manager_patch$;

-- An operational phase explicitly saved under an exception remains a valid
-- phase after normal requirements are restored. It never changes claim approval
-- or hides a cancellation, final delivery, broken vehicle/customer/visit link.
create function app_private.workflow_visit_stage_exception(e public.vehicle_entries,w public.vehicle_visit_workflows)
returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(w.stage in ('approved','in_progress','ready') and w.vehicle_id=e.vehicle_id
  and e.deleted_at is null and e.status<>'Cancelled'
  and (e.insurance_claim_id is null or e.converted_claim_id is null or e.insurance_claim_id=e.converted_claim_id)
  and (e.work_order_id is null or e.converted_work_order_id is null or e.work_order_id=e.converted_work_order_id)
  and (coalesce(e.insurance_claim_id,e.converted_claim_id) is null or exists(select 1 from public.insurance_claims c
    where c.id=coalesce(e.insurance_claim_id,e.converted_claim_id) and c.tenant_id=e.tenant_id and c.deleted_at is null
      and c.vehicle_id=e.vehicle_id and c.customer_id is not distinct from e.customer_id and c.status::text not in ('cancelled','rejected')))
  and (coalesce(e.work_order_id,e.converted_work_order_id) is null or exists(select 1 from public.job_orders j
    where j.id=coalesce(e.work_order_id,e.converted_work_order_id) and j.tenant_id=e.tenant_id and j.deleted_at is null
      and j.vehicle_id=e.vehicle_id and j.customer_id is not distinct from e.customer_id
      and j.claim_id is not distinct from coalesce(e.insurance_claim_id,e.converted_claim_id)))
  and exists(select 1 from public.vehicle_visit_transitions x join public.workflow_requirement_audit a
    on a.id::text=x.requirements->>'workflow_requirement_override_id'
    where x.tenant_id=e.tenant_id and x.entry_id=e.id and x.to_stage=w.stage and x.revision<=w.revision
     and x.from_stage is distinct from x.to_stage and a.tenant_id=e.tenant_id and a.entity_type='vehicle_visit'
     and a.entity_id=e.id and a.action='advance_vehicle_visit' and a.requirements_enabled=false
     and a.actor_id=x.recorded_by and a.details->>'to_stage'=x.to_stage
     and a.details->>'workflow_revision'=(x.revision-1)::text and a.details->>'vehicle_id'=e.vehicle_id::text
     and a.details->>'claim_id' is not distinct from coalesce(e.insurance_claim_id,e.converted_claim_id)::text
     and (a.details->>'work_order_id' is null or a.details->>'work_order_id'=coalesce(e.work_order_id,e.converted_work_order_id)::text)
     and not exists(select 1 from public.vehicle_visit_transitions later where later.entry_id=e.id and later.tenant_id=e.tenant_id
       and later.revision>x.revision and later.from_stage is distinct from later.to_stage)),false)
$$;
revoke all on function app_private.workflow_visit_stage_exception(public.vehicle_entries,public.vehicle_visit_workflows) from public,anon,authenticated,service_role;
do $sync_patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('public.sync_vehicle_visit_from_source(uuid,text)'::regprocedure),E'\r\n',E'\n');
 needle:='and app_private.vehicle_visit_manager_stage_active(v_entry,v_state) then';
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: operational exception projection'; end if;
 definition:=replace(definition,needle,'and (app_private.vehicle_visit_manager_stage_active(v_entry,v_state) or app_private.workflow_visit_stage_exception(v_entry,v_state)) then');
 execute definition;
end $sync_patch$;

create or replace function public.deliver_vehicle_review_visit(p_entry_id uuid,p_request_id uuid,p_receipt_id uuid,p_recipient text,p_signature text,p_notes text,p_occurred_at timestamptz)
returns public.vehicle_handover_records language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; h public.vehicle_handover_records; source_h public.vehicle_handover_records;
 actor uuid:=auth.uid(); t uuid:=public.get_user_tenant_id(); staff text; enforced boolean;
 recipient text:=trim(coalesce(p_recipient,'')); signature text:=nullif(p_signature,''); notes text:=trim(coalesce(p_notes,''));
begin
 if actor is null or not app_private.custody_can('Deliver',t) or not exists(select 1 from public.profiles where user_id=actor and tenant_id=t and account_status='active' and disabled_at is null and role::text in ('admin','manager','supervisor')) then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end if;
 if p_request_id is null or length(recipient)>200 or length(notes)>2000 or (signature is not null and (signature !~ '^data:image/png;base64,' or length(signature)>1500000)) then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':review-delivery:'||p_request_id::text,0));
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=t and deleted_at is null for update;
 if not found or e.status='Cancelled' then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into h from public.vehicle_handover_records where tenant_id=t and snapshot_json->>'reviewDeliveryRequest'=p_request_id::text;
 if found then
  if h.vehicle_entry_id is distinct from e.id or h.snapshot_json->>'custodyReceiptId' is distinct from p_receipt_id::text
   or h.delivered_at is distinct from p_occurred_at or h.recipient_name is distinct from recipient
   or h.signature_data_url is distinct from signature or h.work_summary is distinct from notes then raise exception 'REVIEW_RETURN_REQUEST_CONFLICT'; end if;
  return public.finalize_vehicle_handover(h.id);
 end if;
 enforced:=app_private.workflow_requirements_enforced(t);
 if enforced and (p_receipt_id is null or length(recipient)<2 or signature is null or length(notes)<5) then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED'; end if;
 if enforced and not exists(select 1 from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=t and stage='ready') then raise exception 'REVIEW_RETURN_NOT_READY'; end if;
 select sh.* into source_h from public.vehicle_review_returns r join public.vehicle_handover_records sh on sh.id=r.source_handover_id and sh.tenant_id=r.tenant_id where r.return_entry_id=e.id and r.tenant_id=t and sh.status='finalized' and sh.vehicle_id=e.vehicle_id;
 if not found then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 if p_receipt_id is not null and not exists(select 1 from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=t and vehicle_entry_id=e.id and vehicle_id=e.vehicle_id and status='issued' and exists(select 1 from public.vehicle_entry_signed_revisions sr where sr.id=vehicle_entry_custody_receipts.revision_id and sr.revision=e.intake_revision)) then raise exception 'CUSTODY_NOT_VALID'; end if;
 if p_occurred_at<greatest((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat',source_h.delivered_at,
   (app_private.vehicle_visit_manager_stage_dates(e,(select w from public.vehicle_visit_workflows w where w.entry_id=e.id and w.tenant_id=t))->>'arrived')::timestamptz,
   (app_private.vehicle_visit_manager_stage_dates(e,(select w from public.vehicle_visit_workflows w where w.entry_id=e.id and w.tenant_id=t))->>'ready')::timestamptz,
   (select case when app_private.vehicle_visit_manager_presence(e,w) is not null then (w.manager_adjustment->>'presence_occurred_at')::timestamptz else null end from public.vehicle_visit_workflows w where w.entry_id=e.id and w.tenant_id=t),
   (select x.occurred_at from public.vehicle_visit_transitions x where x.entry_id=e.id and x.tenant_id=t order by x.revision desc limit 1)) then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
 select full_name into staff from public.profiles where user_id=actor and tenant_id=t;
 insert into public.vehicle_handover_records(tenant_id,vehicle_entry_id,work_order_id,claim_id,vehicle_id,customer_id,recipient_name,signature_data_url,workshop_representative,delivered_at,work_summary,snapshot_json)
 values(t,e.id,source_h.work_order_id,source_h.claim_id,e.vehicle_id,e.customer_id,recipient,signature,staff,p_occurred_at,notes,
 jsonb_build_object('custodyReceiptId',p_receipt_id,'reviewDeliveryRequest',p_request_id,'reviewDeliveryOccurredAt',p_occurred_at,'reviewSource',app_private.review_visit_context(e.id),'signatureMethod','electronic')) returning * into h;
 return public.finalize_vehicle_handover(h.id);
end $$;
create or replace function public.deliver_vehicle_review_visit(p_entry_id uuid,p_request_id uuid,p_receipt_id uuid,p_recipient text,p_signature text,p_notes text)
returns public.vehicle_handover_records language plpgsql security definer set search_path='' as $$
declare at_time timestamptz;
begin
 select delivered_at into at_time from public.vehicle_handover_records where tenant_id=public.get_user_tenant_id()
  and snapshot_json->>'reviewDeliveryRequest'=p_request_id::text;
 return public.deliver_vehicle_review_visit(p_entry_id,p_request_id,p_receipt_id,p_recipient,p_signature,p_notes,coalesce(at_time,clock_timestamp()));
end $$;

do $exit_patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('app_private.custody_guard_exit_projection()'::regprocedure),E'\r\n',E'\n');
 needle:=$needle$or exists(select 1 from public.vehicle_entry_custody_audit a where a.tenant_id=h.tenant_id and a.vehicle_entry_id=e_id and a.action='legacy_delivery_exception' and a.details->>'handover_id'=h.id::text)))$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: custody exit proof'; end if;
 definition:=replace(definition,needle,$replacement$or exists(select 1 from public.vehicle_entry_custody_audit a where a.tenant_id=h.tenant_id and a.vehicle_entry_id=e_id and a.action='legacy_delivery_exception' and a.details->>'handover_id'=h.id::text)
    or app_private.workflow_handover_exception(h.id,h.tenant_id)))$replacement$);
 execute definition;
end $exit_patch$;

-- A genuinely consumed receipt must keep showing its saved delivery, including
-- a documented exception, after the administrator restores normal requirements.
do $receipt_document_patch$
declare definition text; needle text;
begin
 definition:=replace(pg_get_functiondef('public.vehicle_intake_receipt_document(uuid)'::regprocedure),E'\r\n',E'\n');
 needle:=$needle$and (nullif(h.signature_data_url,'') is not null or coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false));$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: receipt delivery proof'; end if;
 definition:=replace(definition,needle,$replacement$and (nullif(h.signature_data_url,'') is not null or coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false)
    or app_private.workflow_handover_exception(h.id,h.tenant_id));$replacement$);
 needle:=$needle$'review_notes',h.work_summary,'signature_data_url',h.signature_data_url,$needle$;
 if position(needle in definition)=0 then raise exception 'WORKFLOW_LIFECYCLE_SOURCE_DRIFT: receipt exception label'; end if;
 definition:=replace(definition,needle,$replacement$'workflow_requirement_override_id',case when app_private.workflow_handover_exception(h.id,h.tenant_id) then h.snapshot_json->>'workflowRequirementOverrideId' else null end,
   'review_notes',h.work_summary,'signature_data_url',h.signature_data_url,$replacement$);
 execute definition;
end $receipt_document_patch$;

create or replace function public.vehicle_visit_delivery_guard() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.stage='delivered' and old.stage is distinct from 'delivered' and not exists(
 select 1 from public.vehicle_handover_records h join public.vehicle_entries e on e.id=h.vehicle_entry_id and e.tenant_id=h.tenant_id
 where h.tenant_id=new.tenant_id and h.vehicle_entry_id=new.entry_id and h.status='finalized' and h.vehicle_id=e.vehicle_id
 and (h.work_order_id in(e.work_order_id,e.converted_work_order_id) or exists(
  select 1 from public.vehicle_review_returns r where r.return_entry_id=e.id and r.tenant_id=e.tenant_id and r.id=h.review_return_id
   and (exists(select 1 from public.vehicle_entry_custody_receipts c where c.vehicle_entry_id=r.return_entry_id and c.tenant_id=r.tenant_id
    and c.status='used' and c.handover_id=h.id and c.vehicle_id=e.vehicle_id)
    or app_private.workflow_handover_exception(h.id,h.tenant_id))))) then
 raise exception 'VEHICLE_VISIT_SIGNED_HANDOVER_REQUIRED'; end if;
 return new;
end $$;

commit;
