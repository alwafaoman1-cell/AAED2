-- Development only. Real trigger/RPC integration; all fixtures are rolled back.
begin;
select set_config('request.jwt.claim.sub', '0fda5cff-3124-49d6-a160-4c83000b461a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  v_tenant uuid := '00000000-0000-4000-8000-000000005741';
  v_customer uuid := '5745ba89-1102-4900-bada-310965c79afa';
  v_vehicle uuid := gen_random_uuid();
  v_entry uuid := gen_random_uuid();
  v_claim uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
  v_handover uuid := gen_random_uuid();
  v_late_vehicle uuid := gen_random_uuid();
  v_late_claim uuid := gen_random_uuid();
  v_late_order uuid := gen_random_uuid();
  v_late_entry uuid := gen_random_uuid();
  v_record public.vehicle_handover_records;
  v_list jsonb;
begin
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model)
    values(v_vehicle,v_tenant,v_customer,'TEST-'||substr(v_vehicle::text,1,8),'DV','Test','Paper');
  insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,insurance_company,vehicle_presence_status)
    values(v_claim,v_tenant,v_customer,v_vehicle,'TEST-CLAIM-'||substr(v_claim::text,1,8),'Test Insurance','with_customer');
  insert into public.vehicle_entries(id,tenant_id,entry_number,customer_id,vehicle_id,status,
    arrival_date,arrival_time,vehicle_location,insurance_claim_id)
    values(v_entry,v_tenant,'TEST-ENTRY-'||substr(v_entry::text,1,8),v_customer,v_vehicle,
      'Received',current_date-1,'08:00','داخل الورشة',v_claim);
  if (select vehicle_presence_status from public.insurance_claims where id=v_claim) <> 'in_workshop' then
    raise exception 'new arrival did not synchronize claim custody';
  end if;
  v_list := public.insurance_claims_list_rpc(v_tenant, p_search => 'TEST-CLAIM-'||substr(v_claim::text,1,8));
  if v_list->'rows'->0->>'list_vehicle_location' <> 'in_workshop' then
    raise exception 'claims list did not show actual workshop custody';
  end if;
  if (public.insurance_claims_list_rpc(gen_random_uuid())->'pagination'->>'totalRows')::integer <> 0 then
    raise exception 'claims list exposed another tenant';
  end if;
  insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number,status,
    vehicle_presence_status,work_order_type,claim_id)
    values(v_order,v_tenant,v_vehicle,v_customer,'TEST-WO-'||substr(v_order::text,1,8),
      'completed','with_customer','insurance',v_claim);
  if (select vehicle_presence_status from public.job_orders where id=v_order) <> 'in_workshop' then
    raise exception 'newly linked work order did not inherit arrival custody';
  end if;
  if (select vehicle_entry_id from public.job_orders where id=v_order) is distinct from v_entry
    or (select work_order_id from public.vehicle_entries where id=v_entry) is distinct from v_order then
    raise exception 'claim-created order was not linked to the exact visit on both sides';
  end if;

  insert into public.vehicle_handover_records(id,tenant_id,work_order_id,claim_id,vehicle_id,
    customer_id,vehicle_entry_id,status,recipient_name,snapshot_json)
    values(v_handover,v_tenant,v_order,v_claim,v_vehicle,v_customer,v_entry,'draft',
      'Paper Recipient','{"signatureMethod":"paper","paperSignatureConfirmed":false}'::jsonb);
  begin
    perform public.finalize_vehicle_handover(v_handover);
    raise exception 'unsigned paper handover was accepted';
  exception when others then
    if sqlerrm = 'unsigned paper handover was accepted' then raise; end if;
    if sqlerrm not like '%VEHICLE_HANDOVER_PAPER_EVIDENCE_REQUIRED%' then raise; end if;
  end;
  update public.vehicle_handover_records set snapshot_json =
    '{"signatureMethod":"paper","paperSignatureConfirmed":true}'::jsonb
    where id=v_handover;
  begin
    perform public.finalize_vehicle_handover(v_handover);
    raise exception 'paper handover without recipient ID was accepted';
  exception when others then
    if sqlerrm = 'paper handover without recipient ID was accepted' then raise; end if;
    if sqlerrm not like '%VEHICLE_HANDOVER_PAPER_EVIDENCE_REQUIRED%' then raise; end if;
  end;
  update public.vehicle_handover_records set recipient_id_number='TEST-ID',
    workshop_representative='Test Manager' where id=v_handover;
  select * into v_record from public.finalize_vehicle_handover(v_handover);
  if v_record.status <> 'finalized' or v_record.finalized_by is null
    or v_record.signature_data_url is not null then
    raise exception 'paper handover evidence was not recorded truthfully';
  end if;
  if (select vehicle_location from public.vehicle_entries where id=v_entry) <> 'مع العميل'
    or (select vehicle_presence_status from public.insurance_claims where id=v_claim) <> 'with_customer'
    or (select vehicle_presence_status from public.job_orders where id=v_order) <> 'with_customer'
    or (select stage from public.vehicle_visit_workflows where entry_id=v_entry) <> 'delivered' then
    raise exception 'finalized paper handover did not synchronize visit, claim and order';
  end if;
  v_list := public.insurance_claims_list_rpc(v_tenant, p_search => 'TEST-CLAIM-'||substr(v_claim::text,1,8));
  if v_list->'rows'->0->>'list_vehicle_location' <> 'delivered' then
    raise exception 'claims list did not show finalized delivery';
  end if;

  -- The other creation order must produce the same two-way link: the claim
  -- and work order already exist when the physical entry is saved.
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model)
    values(v_late_vehicle,v_tenant,v_customer,'TEST-'||substr(v_late_vehicle::text,1,8),'DV','Test','Late Entry');
  insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,insurance_company,vehicle_presence_status)
    values(v_late_claim,v_tenant,v_customer,v_late_vehicle,'TEST-CLAIM-'||substr(v_late_claim::text,1,8),'Test Insurance','with_customer');
  insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number,status,
    vehicle_presence_status,work_order_type,claim_id)
    values(v_late_order,v_tenant,v_late_vehicle,v_customer,'TEST-WO-'||substr(v_late_order::text,1,8),
      'received','with_customer','insurance',v_late_claim);
  insert into public.vehicle_entries(id,tenant_id,entry_number,customer_id,vehicle_id,status,
    arrival_date,arrival_time,vehicle_location,insurance_claim_id)
    values(v_late_entry,v_tenant,'TEST-ENTRY-'||substr(v_late_entry::text,1,8),v_customer,v_late_vehicle,
      'Received',current_date,'09:00','داخل الورشة',v_late_claim);
  if (select work_order_id from public.vehicle_entries where id=v_late_entry) is distinct from v_late_order
    or (select vehicle_entry_id from public.job_orders where id=v_late_order) is distinct from v_late_entry
    or (select vehicle_presence_status from public.job_orders where id=v_late_order) <> 'in_workshop' then
    raise exception 'entry created after order did not link and synchronize actual custody';
  end if;
end $$;
rollback;
