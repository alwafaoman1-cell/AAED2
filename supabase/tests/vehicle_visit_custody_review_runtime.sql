-- Development-only runtime test. New rows and audit events are rolled back.
begin;
select set_config('request.jwt.claim.sub', '0fda5cff-3124-49d6-a160-4c83000b461a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  v_tenant uuid := '00000000-0000-4000-8000-000000005741';
  v_customer uuid := '5745ba89-1102-4900-bada-310965c79afa';
  v_actor uuid := '0fda5cff-3124-49d6-a160-4c83000b461a';
  v_vehicle uuid := gen_random_uuid();
  v_entry uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_primary_order uuid;
  v_state public.vehicle_visit_workflows%rowtype;
begin
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model)
  values(v_vehicle,v_tenant,v_customer,'TEST-'||substr(v_vehicle::text,1,8),'DV','Test','Insurance');
  insert into public.vehicle_entries(id,tenant_id,entry_number,customer_id,vehicle_id,status,
    arrival_date,arrival_time,vehicle_location,insurance_snapshot)
  values(v_entry,v_tenant,'TEST-CUSTODY-'||substr(v_entry::text,1,8),v_customer,v_vehicle,
    'Received',current_date-1,'08:00','داخل الورشة','{"claim_number":"TEST-INSURANCE"}'::jsonb);
  insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number,status,
    vehicle_entry_id,vehicle_presence_status,work_order_type)
  values(v_order,v_tenant,v_vehicle,v_customer,'TEST-WO-'||substr(v_order::text,1,8),
    'received',v_entry,'in_workshop','insurance');
  update public.vehicle_entries set work_order_id=v_order where id=v_entry;
  begin
    perform public.advance_vehicle_visit(v_entry,0,'approved',now(),null,null,v_actor,
      '{"customer_approved":true}'::jsonb);
    raise exception 'insurance entry was approved as cash';
  exception when others then
    if sqlerrm = 'insurance entry was approved as cash' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_CLAIM_REQUIRED_FOR_INSURANCE%' then raise; end if;
  end;

  insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,
    insurance_company,vehicle_entry_id,status,vehicle_presence_status)
  values(v_claim,v_tenant,v_customer,v_vehicle,'TEST-CLAIM-'||substr(v_claim::text,1,8),
    'Test Insurance',v_entry,'pending','with_customer');
  update public.vehicle_entries set insurance_claim_id=v_claim where id=v_entry;
  begin
    perform public.reconcile_vehicle_visit_custody(v_entry,'');
    raise exception 'empty reason was accepted';
  exception when others then
    if sqlerrm = 'empty reason was accepted' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_REASON_REQUIRED%' then raise; end if;
  end;
  perform public.reconcile_vehicle_visit_custody(v_entry,'Physical vehicle check at workshop');
  if (select vehicle_presence_status from public.insurance_claims where id=v_claim) <> 'in_workshop' then
    raise exception 'claim custody was not corrected';
  end if;
  if (select count(*) from public.vehicle_entry_audit_logs
      where vehicle_entry_id=v_entry and action='vehicle_visit.custody_reconciled') <> 1 then
    raise exception 'custody correction was not audited';
  end if;
  begin
    perform public.advance_vehicle_visit(v_entry,0,'approved',now(),null,null,v_actor);
    raise exception 'pending insurance claim was approved';
  exception when others then
    if sqlerrm = 'pending insurance claim was approved' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED%' then raise; end if;
  end;
  update public.insurance_claims set status='approved' where id=v_claim;
  select * into v_state from public.vehicle_visit_workflows where entry_id=v_entry;
  if v_state.stage <> 'approved' then raise exception 'insurance approval did not sync'; end if;
  begin
    perform public.advance_vehicle_visit(v_entry,v_state.revision,'in_progress',now(),null,null,v_actor);
    raise exception 'unlinked insurance order advanced';
  exception when others then
    if sqlerrm = 'unlinked insurance order advanced' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_ORDER_CHANNEL_MISMATCH%' then raise; end if;
  end;
  select auto_job_order_id into v_primary_order from public.insurance_claims where id=v_claim;
  if v_primary_order is null then raise exception 'approved insurance claim has no primary work order'; end if;
  update public.vehicle_entries set work_order_id=v_primary_order where id=v_entry;
  update public.job_orders set vehicle_presence_status='in_workshop' where id=v_primary_order;
  v_state := public.advance_vehicle_visit(v_entry,v_state.revision,'in_progress',now(),null,null,v_actor);
  if v_state.stage <> 'in_progress' then raise exception 'insurance repair did not start'; end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.reconcile_vehicle_visit_custody(v_entry,'Wrong tenant must not correct');
    raise exception 'wrong tenant corrected custody';
  exception when others then
    if sqlerrm = 'wrong tenant corrected custody' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_PERMISSION_DENIED%' then raise; end if;
  end;
end;
$$;
rollback;
