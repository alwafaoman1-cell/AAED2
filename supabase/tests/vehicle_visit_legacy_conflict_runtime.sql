-- Development-only transactional regression. The trigger bypass creates an
-- impossible-to-create-now legacy pair; all data and trigger state roll back.
begin;
select set_config('request.jwt.claim.sub', '0fda5cff-3124-49d6-a160-4c83000b461a', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
do $$
declare
  v_tenant uuid := '00000000-0000-4000-8000-000000005741';
  v_customer uuid := '5745ba89-1102-4900-bada-310965c79afa';
  v_vehicle uuid := gen_random_uuid();
  v_first uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_order uuid := gen_random_uuid();
begin
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model)
  values(v_vehicle,v_tenant,v_customer,'TEST-'||substr(v_vehicle::text,1,8),'DV','Test','Legacy Conflict');

  execute 'alter table public.vehicle_entries disable trigger trg_vehicle_visit_duplicate_guard';
  execute 'alter table public.vehicle_entries disable trigger trg_vehicle_visit_entry_inserted';
  insert into public.vehicle_entries(id,tenant_id,entry_number,customer_id,vehicle_id,status,
    arrival_date,arrival_time,vehicle_location)
  values
    (v_first,v_tenant,'TEST-OLD-'||substr(v_first::text,1,8),v_customer,v_vehicle,
      'Received',current_date-1,'08:00','داخل الورشة'),
    (v_second,v_tenant,'TEST-OLD-'||substr(v_second::text,1,8),v_customer,v_vehicle,
      'Received',current_date-1,'09:00','داخل الورشة');
  execute 'alter table public.vehicle_entries enable trigger trg_vehicle_visit_entry_inserted';
  execute 'alter table public.vehicle_entries enable trigger trg_vehicle_visit_duplicate_guard';

  if not public.vehicle_visit_has_conflicting_entry(v_first)
    or not public.vehicle_visit_has_conflicting_entry(v_second) then
    raise exception 'legacy conflict not detected';
  end if;
  perform public.sync_vehicle_visit_from_source(v_first,'entry');
  perform public.sync_vehicle_visit_from_source(v_second,'entry');
  update public.vehicle_entries set status='Draft' where id=v_first;
  insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number,status,
    vehicle_entry_id,vehicle_presence_status)
  values(v_order,v_tenant,v_vehicle,v_customer,'TEST-OLD-WO-'||substr(v_order::text,1,8),
    'received',v_second,'in_workshop');
  if exists (select 1 from public.vehicle_visit_workflows where entry_id in (v_first,v_second)) then
    raise exception 'legacy conflict was materialized';
  end if;
  begin
    perform public.advance_vehicle_visit(v_first,0,'approved',now(),null,null,
      '0fda5cff-3124-49d6-a160-4c83000b461a','{"customer_approved":true}'::jsonb);
    raise exception 'conflicting visit was advanced';
  exception when others then
    if sqlerrm = 'conflicting visit was advanced' then raise; end if;
    if sqlerrm not like '%VEHICLE_VISIT_REVIEW_REQUIRED%' then raise; end if;
  end;
  if exists (select 1 from public.vehicle_visit_transitions where entry_id in (v_first,v_second)) then
    raise exception 'legacy conflict created an audit event';
  end if;
end;
$$;
rollback;
