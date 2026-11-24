-- A disabled requirement never manufactures a running state, inspection result,
-- signature, visit or delivery. Missing observations stay missing with proof.
begin;

-- Owner execution is limited to the private policy/audit APIs. Their actor
-- predicate still requires an active, authenticated user in NEW.tenant_id.
create or replace function app_private.guard_new_intake_running_status()
returns trigger language plpgsql security definer set search_path='' as $$
declare missing_fields jsonb := '[]'::jsonb; enforce_requirements boolean;
begin
 if NEW.status in ('Received','Issued','Converted to Claim','Converted to Work Order') and (TG_OP='INSERT' or OLD.status='Draft')
  and coalesce(NEW.vehicle_condition->>'running_status','unknown') not in ('running','not_running') then
  missing_fields := missing_fields || jsonb_build_array('running_status');
 end if;
 if nullif(btrim(coalesce(NEW.delivered_by->>'full_name','')),'') is null
  and (TG_OP='INSERT' or NEW.delivered_by is distinct from OLD.delivered_by
   or (OLD.status='Draft' and NEW.status in ('Received','Issued','Converted to Claim','Converted to Work Order'))) then
  missing_fields := missing_fields || jsonb_build_array('delivered_by');
 end if;
 if jsonb_array_length(missing_fields)>0 then
  enforce_requirements := app_private.workflow_requirements_enforced(NEW.tenant_id);
  if enforce_requirements then
   if missing_fields ? 'running_status' then raise exception 'VEHICLE_INTAKE_RUNNING_STATUS_REQUIRED'; end if;
   raise exception 'VEHICLE_INTAKE_INVALID_FORM';
  end if;
  if app_private.record_workflow_requirement_override(NEW.tenant_id,'vehicle_entry',NEW.id,
   'save_vehicle_entry',jsonb_build_object('missing_fields',missing_fields,'target_status',NEW.status,
    'intake_revision',NEW.intake_revision)) is null then raise exception 'WORKFLOW_OVERRIDE_NOT_CONFIRMED'; end if;
 end if;
 return NEW;
end $$;
revoke all on function app_private.guard_new_intake_running_status() from public,anon,authenticated,service_role;
drop trigger new_intake_running_status on public.vehicle_entries;
create trigger new_intake_running_status before insert or update of status,delivered_by
 on public.vehicle_entries for each row execute function app_private.guard_new_intake_running_status();

-- Old review rows retain the same constraints. Only an immutable audit event
-- bound to this exact review identity permits missing operational descriptions.
alter table public.vehicle_review_returns add column requirements_exception_id uuid
 references public.workflow_requirement_audit(id);
alter table public.vehicle_review_returns drop constraint vehicle_review_returns_reason_check;
alter table public.vehicle_review_returns drop constraint vehicle_review_returns_arrival_condition_check;
alter table public.vehicle_review_returns add constraint vehicle_review_returns_reason_check
 check(length(trim(reason))<=2000 and (length(trim(reason))>=5 or requirements_exception_id is not null));
alter table public.vehicle_review_returns add constraint vehicle_review_returns_arrival_condition_check
 check(length(trim(arrival_condition))<=2000 and (length(trim(arrival_condition))>=3 or requirements_exception_id is not null));

create function app_private.guard_review_requirement_exception()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if NEW.requirements_exception_id is not null and not exists(
  select 1 from public.workflow_requirement_audit a where a.id=NEW.requirements_exception_id
   and a.tenant_id=NEW.tenant_id and a.entity_type='vehicle_review_return'
   and a.entity_id=NEW.id and a.action='create_review_return'
   and a.actor_id=NEW.recorded_by and a.requirements_enabled=false
 ) then raise exception 'REVIEW_RETURN_EXCEPTION_PROOF_INVALID'; end if;
 return NEW;
end $$;
revoke all on function app_private.guard_review_requirement_exception() from public,anon,authenticated,service_role;
create trigger review_requirement_exception_guard before insert on public.vehicle_review_returns
 for each row execute function app_private.guard_review_requirement_exception();

create or replace function public.create_vehicle_review_return(
 p_source_entry_id uuid,p_request_id uuid,p_reason text,p_condition text,p_notes text,p_delivered_by text,
 p_confirm_arrival boolean,p_mileage numeric,p_running_status text,p_new_damage boolean,p_new_damage_notes text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare t uuid:=public.get_user_tenant_id(); actor uuid:=auth.uid(); old public.vehicle_entries;
 h public.vehicle_handover_records; existing public.vehicle_review_returns;
 customer_data jsonb; vehicle_data jsonb; meta jsonb; form jsonb; saved jsonb; new_id uuid;
 arrival timestamptz; receiver text; previous_guard text; review_id uuid:=gen_random_uuid(); exception_id uuid;
 enforce_requirements boolean; missing_fields jsonb:='[]'::jsonb; recorded_running text:=coalesce(p_running_status,'unknown');
begin
 if actor is null or t is null or not exists(select 1 from public.profiles p
  where p.user_id=actor and p.tenant_id=t and p.account_status='active' and p.disabled_at is null
   and p.role::text in ('admin','manager','supervisor','insurance')) then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 -- Format, event identity and upper bounds remain valid in either policy mode.
 if p_request_id is null or p_confirm_arrival is distinct from true
  or (p_mileage is not null and (p_mileage<0 or p_mileage>99999999))
  or recorded_running not in ('running','not_running','unknown')
  or length(coalesce(p_reason,''))>2000 or length(coalesce(p_condition,''))>2000
  or length(coalesce(p_notes,''))>4000 or length(coalesce(p_delivered_by,''))>200
  or length(coalesce(p_new_damage_notes,''))>2000 then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED'; end if;
 if p_mileage is null then missing_fields:=missing_fields||jsonb_build_array('mileage'); end if;
 if recorded_running='unknown' then missing_fields:=missing_fields||jsonb_build_array('running_status'); end if;
 if p_new_damage is null then missing_fields:=missing_fields||jsonb_build_array('new_damage'); end if;
 if p_new_damage and length(trim(coalesce(p_new_damage_notes,'')))<3 then missing_fields:=missing_fields||jsonb_build_array('new_damage_notes'); end if;
 if length(trim(coalesce(p_reason,'')))<5 then missing_fields:=missing_fields||jsonb_build_array('reason'); end if;
 if length(trim(coalesce(p_condition,'')))<3 then missing_fields:=missing_fields||jsonb_build_array('arrival_condition'); end if;
 if length(trim(coalesce(p_delivered_by,'')))<2 then missing_fields:=missing_fields||jsonb_build_array('delivered_by'); end if;
 enforce_requirements:=app_private.workflow_requirements_enforced(t);
 perform pg_advisory_xact_lock(hashtextextended(t::text||':review-return:'||p_request_id::text,0));
 select * into old from public.vehicle_entries where id=p_source_entry_id and tenant_id=t and deleted_at is null for update;
 if not found or old.status='Cancelled' then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into existing from public.vehicle_review_returns where tenant_id=t and request_id=p_request_id;
 if found then
  if existing.source_entry_id<>old.id then raise exception 'REVIEW_RETURN_REQUEST_CONFLICT'; end if;
  return jsonb_build_object('entry_id',existing.return_entry_id,'existing',true,'requirements_exception_id',existing.requirements_exception_id);
 end if;
 select r.* into existing from public.vehicle_review_returns r join public.vehicle_entries e on e.id=r.return_entry_id
  left join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=t
  where r.tenant_id=t and r.source_entry_id=old.id and e.deleted_at is null and e.status<>'Cancelled'
   and coalesce(w.stage,'arrived') not in ('delivered','cancelled') order by r.recorded_at desc limit 1;
 if found then return jsonb_build_object('entry_id',existing.return_entry_id,'existing',true,'requirements_exception_id',existing.requirements_exception_id); end if;
 if enforce_requirements and jsonb_array_length(missing_fields)>0 then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED'; end if;
 select * into h from public.vehicle_handover_records where tenant_id=t and vehicle_entry_id=old.id
  and vehicle_id=old.vehicle_id and status='finalized' order by delivered_at desc,finalized_at desc limit 1;
 if not found or h.finalized_at is null or (nullif(h.signature_data_url,'') is null
   and coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false) is not true
   and not exists(select 1 from public.workflow_requirement_audit a where a.tenant_id=h.tenant_id
    and a.entity_type='vehicle_handover' and a.entity_id=h.id and a.action='finalize_handover'
    and a.requirements_enabled=false))
  or not exists(select 1 from public.vehicle_visit_workflows w where w.entry_id=old.id and w.tenant_id=t and w.stage='delivered')
  or exists(select 1 from public.vehicle_handover_records newer where newer.tenant_id=t and newer.vehicle_id=old.vehicle_id
   and newer.status='finalized' and newer.delivered_at>h.delivered_at) then raise exception 'REVIEW_RETURN_DELIVERY_REQUIRED'; end if;
 arrival:=clock_timestamp();
 if arrival<h.delivered_at then raise exception 'REVIEW_RETURN_DELIVERY_REQUIRED'; end if;
 select to_jsonb(c) into customer_data from public.customers c where c.id=old.customer_id and c.tenant_id=t and c.deleted_at is null;
 select jsonb_build_object('plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,
  'make',v.brand,'model',v.model,'year',v.year,'color',v.color,'vin',coalesce(v.vin,v.vin_number))
  into vehicle_data from public.vehicles v where v.id=old.vehicle_id and v.tenant_id=t and v.deleted_at is null;
 if customer_data is null or vehicle_data is null then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 if jsonb_array_length(missing_fields)>0 then
  exception_id:=app_private.record_workflow_requirement_override(t,'vehicle_review_return',review_id,
   'create_review_return',jsonb_build_object('missing_fields',missing_fields,'source_entry_id',old.id,'source_handover_id',h.id));
  if exception_id is null then raise exception 'WORKFLOW_OVERRIDE_NOT_CONFIRMED'; end if;
 end if;
 select full_name into receiver from public.profiles where user_id=actor and tenant_id=t;
 meta:=jsonb_build_object('request_id',p_request_id,'source_entry_id',old.id,'source_entry_number',old.entry_number,
  'source_handover_id',h.id,'source_handover_number',h.receipt_number,'previous_delivered_at',h.delivered_at,
  'mileage',p_mileage,'running_status',recorded_running,'new_damage',p_new_damage,'new_damage_notes',trim(coalesce(p_new_damage_notes,'')),
  'reason',trim(coalesce(p_reason,'')),'arrival_condition',trim(coalesce(p_condition,'')),'notes',trim(coalesce(p_notes,'')),
  'arrived_at',arrival,'requirements_exception_id',exception_id);
 form:=jsonb_build_object('status','Issued','customer_id',old.customer_id,'vehicle_id',old.vehicle_id,
  'customer',customer_data,'vehicle',vehicle_data||jsonb_build_object('mileage',p_mileage),'arrival_date',(arrival at time zone 'Asia/Muscat')::date,
  'arrival_time',(arrival at time zone 'Asia/Muscat')::time,'vehicle_location','داخل الورشة',
  'received_by_name',receiver,'delivered_by',jsonb_build_object('full_name',trim(coalesce(p_delivered_by,''))),
  'condition',jsonb_build_object('running_status',recorded_running,'new_damage',p_new_damage,'new_damage_notes',trim(coalesce(p_new_damage_notes,'')),
   'visit_purpose','workshop','condition_description',trim(coalesce(p_condition,'')),
   'additional_notes',trim(coalesce(p_notes,'')),'review_return',meta),
  'contents','{}'::jsonb,'damage_marks','[]'::jsonb,
  'insurance',jsonb_build_object('is_insurance_related',coalesce(old.insurance_claim_id,old.converted_claim_id) is not null
   or coalesce((old.insurance_snapshot->>'is_insurance_related')::boolean,false)),
  'declaration_ar',old.declaration_ar,'declaration_en',old.declaration_en);
 previous_guard:=current_setting('app.vehicle_review_return',true);
 perform set_config('app.vehicle_review_return',p_request_id::text,true);
 saved:=public.save_vehicle_entry_intake(null,null,form,null,null);
 perform set_config('app.vehicle_review_return',coalesce(previous_guard,''),true);
 new_id:=(saved->'entry'->>'id')::uuid;
 if new_id is null then raise exception 'REVIEW_RETURN_SAVE_NOT_CONFIRMED'; end if;
 insert into public.vehicle_review_returns(id,tenant_id,request_id,source_entry_id,source_handover_id,return_entry_id,
  reason,arrival_condition,notes,arrived_at,recorded_by,requirements_exception_id)
 values(review_id,t,p_request_id,old.id,h.id,new_id,trim(coalesce(p_reason,'')),trim(coalesce(p_condition,'')),
  trim(coalesce(p_notes,'')),arrival,actor,exception_id);
 insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
 values(t,new_id,actor,'vehicle_entry.review_return_created',meta);
 return jsonb_build_object('entry_id',new_id,'existing',false,'requirements_exception_id',exception_id);
end $$;
revoke all on function public.create_vehicle_review_return(uuid,uuid,text,text,text,text,boolean,numeric,text,boolean,text) from public,anon,service_role;
grant execute on function public.create_vehicle_review_return(uuid,uuid,text,text,text,text,boolean,numeric,text,boolean,text) to authenticated;

commit;
