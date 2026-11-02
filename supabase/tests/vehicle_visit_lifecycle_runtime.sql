-- Development-only transactional integration test. Every new row is rolled back.
begin;
select set_config('request.jwt.claim.sub', '0fda5cff-3124-49d6-a160-4c83000b461a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  v_tenant uuid := '00000000-0000-4000-8000-000000005741';
  v_vehicle uuid := gen_random_uuid();
  v_customer uuid := '5745ba89-1102-4900-bada-310965c79afa';
  v_entry uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_cancel_vehicle uuid := gen_random_uuid();
  v_cancel_entry uuid := gen_random_uuid();
  v_handover uuid := gen_random_uuid();
  v_state public.vehicle_visit_workflows;
  v_cancel_state public.vehicle_visit_workflows;
  v_count integer;
begin
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model)
  values(v_vehicle,v_tenant,v_customer,'TEST-'||substr(v_vehicle::text,1,8),'DV','Test','Lifecycle');
  insert into public.vehicle_entries(id,tenant_id,entry_number,customer_id,vehicle_id,status,
    arrival_date,arrival_time,vehicle_location)
  values(v_entry,v_tenant,'TEST-LIFECYCLE-'||substr(v_entry::text,1,8),v_customer,v_vehicle,
    'Received',current_date-1,'08:00','داخل الورشة');
  select * into v_state from public.vehicle_visit_workflows where entry_id=v_entry;
  if v_state.stage <> 'arrived' or v_state.revision <> 0 then raise exception 'initial stage failed'; end if;
  select count(*) into v_count from public.vehicle_visit_transitions where entry_id=v_entry;
  if v_count <> 1 then raise exception 'initial audit event failed'; end if;

  begin
    insert into public.vehicle_entries(tenant_id,entry_number,customer_id,vehicle_id,status,vehicle_location)
    values(v_tenant,'TEST-DUP-'||substr(gen_random_uuid()::text,1,8),v_customer,v_vehicle,'Received','داخل الورشة');
    raise exception 'duplicate visit was allowed';
  exception when others then
    if sqlerrm = 'duplicate visit was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_ALREADY_OPEN%' then raise; end if;
  end;

  insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number,status,
    vehicle_entry_id,vehicle_presence_status)
  values(v_order,v_tenant,v_vehicle,v_customer,'TEST-WO-'||substr(v_order::text,1,8),
    'received',v_entry,'in_workshop');
  update public.vehicle_entries set work_order_id=v_order where id=v_entry;
  begin
    insert into public.job_orders(tenant_id,vehicle_id,customer_id,order_number,status,vehicle_entry_id)
    values(v_tenant,v_vehicle,v_customer,'TEST-WO-DUP-'||substr(gen_random_uuid()::text,1,8),'received',v_entry);
    raise exception 'duplicate work order was allowed';
  exception when others then
    if sqlerrm = 'duplicate work order was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_WORK_ORDER_ALREADY_EXISTS%' then raise; end if;
  end;
  -- Legacy order points from the entry only; its reverse FK is still NULL.
  update public.job_orders set vehicle_entry_id=null where id=v_order;
  begin
    insert into public.job_orders(tenant_id,vehicle_id,customer_id,order_number,status,vehicle_entry_id,
      work_order_type)
    values(v_tenant,v_vehicle,v_customer,'TEST-WO-LEGACY-DUP-'||substr(gen_random_uuid()::text,1,8),
      'received',v_entry,'general_customer');
    raise exception 'reverse-linked legacy order duplicate was allowed';
  exception when others then
    if sqlerrm = 'reverse-linked legacy order duplicate was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_WORK_ORDER_ALREADY_EXISTS%' then raise; end if;
  end;
  update public.job_orders set vehicle_entry_id=v_entry where id=v_order;

  v_state := public.advance_vehicle_visit(v_entry,0,'approved',now(),null,null,
    '0fda5cff-3124-49d6-a160-4c83000b461a','{"customer_approved":true}'::jsonb);
  if v_state.revision <> 1 or v_state.stage <> 'approved' then raise exception 'approval failed'; end if;
  begin
    perform public.advance_vehicle_visit(v_entry,0,'in_progress',now(),null,null,
      '0fda5cff-3124-49d6-a160-4c83000b461a');
    raise exception 'stale revision was allowed';
  exception when others then
    if sqlerrm = 'stale revision was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_STALE_REVISION%' then raise; end if;
  end;
  v_state := public.advance_vehicle_visit(v_entry,1,'in_progress',now(),null,null,
    '0fda5cff-3124-49d6-a160-4c83000b461a');
  if v_state.stage <> 'in_progress' then raise exception 'work start failed'; end if;
  -- Separate requests use separate transactions; clear the RPC's local guard
  -- before simulating the next independent work-order update in this test.
  perform set_config('app.vehicle_visit_manual_transition','off',true);
  update public.job_orders set status='completed',work_completed_at=now() where id=v_order;
  select * into v_state from public.vehicle_visit_workflows where entry_id=v_entry;
  if v_state.stage <> 'ready' then raise exception 'work complete did not sync'; end if;
  begin
    perform public.advance_vehicle_visit(v_entry,v_state.revision,'delivered',now());
    raise exception 'delivery without signed handover was allowed';
  exception when others then
    if sqlerrm = 'delivery without signed handover was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_SIGNED_HANDOVER_REQUIRED%' then raise; end if;
  end;

  insert into public.vehicle_handover_records(id,tenant_id,work_order_id,vehicle_id,customer_id,
    vehicle_entry_id,status,recipient_name,signature_data_url)
  values(v_handover,v_tenant,v_order,v_vehicle,v_customer,v_entry,'draft','Test Recipient','test-signature');
  perform public.finalize_vehicle_handover(v_handover);
  select * into v_state from public.vehicle_visit_workflows where entry_id=v_entry;
  if v_state.stage <> 'delivered' then raise exception 'finalized handover did not sync'; end if;
  if (select vehicle_location from public.vehicle_entries where id=v_entry) <> 'مع العميل' then
    raise exception 'finalized handover did not update custody';
  end if;
  if (select count(*) from public.vehicle_visit_transitions where entry_id=v_entry) <> v_state.revision+1 then
    raise exception 'transition history is incomplete';
  end if;
  begin
    perform public.advance_vehicle_visit(v_entry,v_state.revision,'ready',now(),null,null,
      '0fda5cff-3124-49d6-a160-4c83000b461a');
    raise exception 'unreasoned reversal was allowed';
  exception when others then
    if sqlerrm = 'unreasoned reversal was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_REVERSAL_PERMISSION_OR_REASON_REQUIRED%' then raise; end if;
  end;
  perform public.cancel_vehicle_handover(v_handover,'Test correction');
  if (select vehicle_location from public.vehicle_entries where id=v_entry) <> 'داخل الورشة' then
    raise exception 'cancelled handover did not restore custody';
  end if;
  select * into v_state from public.vehicle_visit_workflows where entry_id=v_entry;
  if v_state.review_reason is null then raise exception 'cancelled delivery not flagged for review'; end if;
  v_state := public.advance_vehicle_visit(v_entry,v_state.revision,'ready',now(),null,'Test correction',
    '0fda5cff-3124-49d6-a160-4c83000b461a');
  if v_state.stage <> 'ready' or v_state.review_reason is not null then
    raise exception 'authorized reversal failed';
  end if;
  perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
  begin
    perform public.advance_vehicle_visit(v_entry,v_state.revision,'delivered',now());
    raise exception 'wrong tenant actor was allowed';
  exception when others then
    if sqlerrm = 'wrong tenant actor was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_PERMISSION_DENIED%' then raise; end if;
  end;
  perform set_config('request.jwt.claim.sub','0fda5cff-3124-49d6-a160-4c83000b461a',true);
  insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,insurance_company,vehicle_entry_id)
  values(v_claim,v_tenant,v_customer,v_vehicle,'TEST-CLAIM-'||substr(gen_random_uuid()::text,1,8),'Test Insurance',v_entry);
  begin
    insert into public.insurance_claims(tenant_id,customer_id,vehicle_id,claim_number,insurance_company,vehicle_entry_id)
    values(v_tenant,v_customer,v_vehicle,'TEST-CLAIM-'||substr(gen_random_uuid()::text,1,8),'Test Insurance',v_entry);
    raise exception 'duplicate claim was allowed';
  exception when others then
    if sqlerrm = 'duplicate claim was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_CLAIM_ALREADY_EXISTS%' then raise; end if;
  end;
  update public.vehicle_entries set insurance_claim_id=v_claim where id=v_entry;
  update public.insurance_claims set vehicle_entry_id=null where id=v_claim;
  begin
    insert into public.insurance_claims(tenant_id,customer_id,vehicle_id,claim_number,insurance_company,vehicle_entry_id)
    values(v_tenant,v_customer,v_vehicle,'TEST-CLAIM-LEGACY-DUP-'||substr(gen_random_uuid()::text,1,8),
      'Test Insurance',v_entry);
    raise exception 'reverse-linked legacy claim duplicate was allowed';
  exception when others then
    if sqlerrm = 'reverse-linked legacy claim duplicate was allowed' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_CLAIM_ALREADY_EXISTS%' then raise; end if;
  end;
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model)
  values(v_cancel_vehicle,v_tenant,v_customer,'TEST-'||substr(v_cancel_vehicle::text,1,8),
    'DV','Test','Cancellation');
  insert into public.vehicle_entries(id,tenant_id,entry_number,customer_id,vehicle_id,status,
    arrival_date,arrival_time,vehicle_location)
  values(v_cancel_entry,v_tenant,'TEST-CANCEL-'||substr(v_cancel_entry::text,1,8),v_customer,
    v_cancel_vehicle,'Received',current_date-1,'08:00','داخل الورشة');
  v_cancel_state := public.advance_vehicle_visit(v_cancel_entry,0,'cancelled',now(),null,
    'Test cancellation','0fda5cff-3124-49d6-a160-4c83000b461a');
  if v_cancel_state.stage <> 'cancelled' then raise exception 'manual cancellation failed'; end if;
  v_cancel_state := public.advance_vehicle_visit(v_cancel_entry,v_cancel_state.revision,'arrived',now(),
    null,'Test restore','0fda5cff-3124-49d6-a160-4c83000b461a');
  if v_cancel_state.stage <> 'arrived' then raise exception 'cancelled visit reversal failed'; end if;
end;
$$;
rollback;
