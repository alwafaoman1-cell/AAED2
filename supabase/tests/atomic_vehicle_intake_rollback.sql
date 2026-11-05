-- Development-only proof. Run through the private helper asserting ref
-- rrhyglrnlveygyiandhs. Trial the candidate AFTER BEGIN in this same transaction;
-- always connection.rollback() in finally. No Auth API, emails or real fixtures.
begin;
set local statement_timeout = '20s';
set local lock_timeout = '3s';
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';

create temporary table intake_test_state (key text primary key, value jsonb);
grant select, insert, update on intake_test_state to authenticated;
create function pg_temp.intake_check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin if p_ok is distinct from true then raise exception 'INTAKE_PROOF_FAILED: %',p_label; end if; end $$;
create function pg_temp.intake_state(p_key text) returns jsonb language sql as $$
  select s.value from pg_temp.intake_test_state s where s.key = p_key
$$;
create function pg_temp.intake_actor(p_key text) returns void language plpgsql as $$
declare v_actor text := pg_temp.intake_state(p_key)#>>'{}';
begin
  perform set_config('request.jwt.claims',jsonb_build_object('sub',v_actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',coalesce(v_actor,''),true);
  perform set_config('request.jwt.claim.role','authenticated',true);
end $$;
create function pg_temp.intake_expect_error(p_form jsonb,p_id uuid,p_at timestamptz,p_tech jsonb,p_rev integer,p_error text)
returns void language plpgsql as $$
declare v_error text;
begin
  begin perform public.save_vehicle_entry_intake(p_id,p_at,p_form,p_tech,p_rev);
  exception when others then v_error := sqlerrm; end;
  if v_error is null or position(p_error in v_error) = 0 then
    raise exception 'INTAKE_EXPECTED_ERROR: %; actual=%',p_error,coalesce(v_error,'SUCCESS');
  end if;
end $$;
-- All tables potentially touched by this RPC AND its current source/lifecycle
-- triggers. Hashes only; never print document/customer values in test evidence.
-- Test-only admin-owned global hash probe: RLS must not hide a foreign-tenant
-- side effect from these assertions. This does NOT elevate the RPC/callers.
create function pg_temp.intake_footprint() returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_table text; v_hash text; v_result jsonb := '{}';
begin
  foreach v_table in array array['customers','vehicles','vehicle_entries','vehicle_entry_damage_marks',
    'vehicle_technical_declarations','vehicle_entry_audit_logs','vehicle_entry_sequences','vehicle_visit_workflows',
    'vehicle_visit_transitions','job_orders','insurance_claims','vehicle_entry_documents','vehicle_entry_signatures','vehicle_media'] loop
    execute format('select md5(coalesce(string_agg(md5(to_jsonb(t)::text),'''' order by md5(to_jsonb(t)::text)),'''')) from public.%I t',v_table) into v_hash;
    v_result := v_result || jsonb_build_object(v_table,v_hash);
  end loop;
  return v_result;
end $$;

do $setup$
declare
  v_tenant uuid := gen_random_uuid(); v_other uuid := gen_random_uuid(); v_actor uuid;
  v_owner uuid; v_visitor uuid; v_vehicle uuid; v_deleted uuid; v_foreign_customer uuid; v_foreign_vehicle uuid; v_company uuid;
  v_role text;
begin
  perform pg_temp.intake_check(to_regprocedure('public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer)') is not null,'candidate available');
  perform pg_temp.intake_check(not (select p.prosecdef from pg_proc p
    where p.oid = 'public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer)'::regprocedure),'SECURITY INVOKER');
  perform pg_temp.intake_check(not has_function_privilege('anon','public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer)','execute'),'anon execution revoked');
  insert into public.tenants(id,name) values(v_tenant,'Synthetic intake rollback'),(v_other,'Synthetic foreign intake rollback');
  foreach v_role in array array['manager','admin','insurance','supervisor','technician','accountant','disabled'] loop
    v_actor := gen_random_uuid();
    insert into auth.users(id,aud,role,raw_user_meta_data,raw_app_meta_data)
      values(v_actor,'authenticated','authenticated','{"profile_provisioning":"manage-users"}','{}');
    perform pg_temp.intake_check(not exists(select 1 from public.profiles p where p.user_id = v_actor),'managed synthetic profile deferral');
    insert into public.profiles(user_id,tenant_id,full_name,role,account_status)
      values(v_actor,v_tenant,'Synthetic intake actor',case when v_role = 'disabled' then 'manager' else v_role end::public.app_role,
        case when v_role = 'disabled' then 'disabled' else 'active' end);
    insert into pg_temp.intake_test_state values(v_role,to_jsonb(v_actor::text));
  end loop;
  insert into public.customers(tenant_id,name,phone,customer_code,email)
    values(v_tenant,'Synthetic owner','80000001','ROLLBACK-OWNER','historical@example.invalid') returning id into v_owner;
  insert into public.customers(tenant_id,name,phone,customer_code)
    values(v_tenant,'Synthetic visitor','80000002','ROLLBACK-VISITOR') returning id into v_visitor;
  insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model,archived,archived_at,archived_reason,vin,vin_number)
    values(v_tenant,v_owner,'92736482','ZX','OMAN','Synthetic','Rollback',true,now(),'Previous visit','SYNTHETICVIN01','SYNTHETICVIN01') returning id into v_vehicle;
  insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model,deleted_at,archived)
    values(v_tenant,v_owner,'92736483','ZX','OM','Synthetic','Deleted',now(),true) returning id into v_deleted;
  insert into public.customers(tenant_id,name,phone,customer_code)
    values(v_other,'Synthetic foreign visitor','80000003','ROLLBACK-FOREIGN') returning id into v_foreign_customer;
  insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model)
    values(v_other,v_foreign_customer,'92736484','ZX','OM','Synthetic','Foreign') returning id into v_foreign_vehicle;
  insert into public.insurance_companies(tenant_id,name) values(v_other,'Synthetic foreign insurer') returning id into v_company;
  insert into pg_temp.intake_test_state values
    ('tenant',to_jsonb(v_tenant::text)),('owner',to_jsonb(v_owner::text)),('visitor',to_jsonb(v_visitor::text)),
    ('vehicle',to_jsonb(v_vehicle::text)),('deleted',to_jsonb(v_deleted::text)),
    ('foreign_customer',to_jsonb(v_foreign_customer::text)),('foreign_vehicle',to_jsonb(v_foreign_vehicle::text)),('foreign_company',to_jsonb(v_company::text)),
    ('form',jsonb_build_object('status','Received','customer_id',v_visitor,'vehicle_id',v_vehicle,
      'customer_phone_changed',false,'customer_phone_before_edit','80000002',
      'arrival_date','2026-11-04','arrival_time','10:30','received_by_name','Synthetic receiver',
      'customer',jsonb_build_object('name','Untrusted caller name','phone','+96880000002','customer_code','ROLLBACK-VISITOR','email','historical@example.invalid'),
      'vehicle',jsonb_build_object('plate_number','92736482','plate_letters','ZX','plate_country','OM','make','Synthetic','model','Rollback','vin','SYNTHETICVIN01','engine_number','KEEP-ENGINE','transmission','KEEP-GEAR'),
      'insurance','{}'::jsonb,'delivered_by','{}'::jsonb,'contents','{"notes":"KEEP-CONTENTS"}'::jsonb,
      'condition','{"visit_purpose":"workshop","condition_description":"KEEP-HISTORY","legacy_attachment":"KEEP-ATTACHMENT"}'::jsonb,
      'damage_marks','[{"mark_number":1,"damage_type":"scratch","description":"Original mark","x":12,"y":34}]'::jsonb)),
    ('technical','{"cranking":"yes","other_observations":"Original declaration"}'::jsonb);
end $setup$;
select pg_temp.intake_actor('manager');
set local role authenticated;

do $create$
declare v_result jsonb; v_form jsonb := pg_temp.intake_state('form'); v_before jsonb;
begin
  v_result := public.save_vehicle_entry_intake(null,null,v_form,pg_temp.intake_state('technical'),null);
  insert into pg_temp.intake_test_state values('result',v_result);
  perform pg_temp.intake_check(v_result#>>'{entry,customer_id}' = v_form->>'customer_id','different visitor accepted');
  perform pg_temp.intake_check((select v.customer_id::text from public.vehicles v where v.id = (v_form->>'vehicle_id')::uuid) = pg_temp.intake_state('owner')#>>'{}','historical owner unchanged');
  perform pg_temp.intake_check((select not v.archived and v.archived_at is null and v.archived_reason is null from public.vehicles v where v.id = (v_form->>'vehicle_id')::uuid),'archived non-deleted vehicle reopened');
  perform pg_temp.intake_check((select c.phone = '80000002' from public.customers c where c.id = (v_form->>'customer_id')::uuid),'untouched legacy phone not normalized');
  perform pg_temp.intake_check(v_result#>>'{entry,customer_snapshot,name}' = 'Synthetic visitor','authoritative visitor snapshot');
  perform pg_temp.intake_check(v_result#>'{entry,damage_map,marks}' = '[{"n":1,"x":12,"y":34,"type":"scratch"}]'::jsonb,'create damage map projection');
  perform pg_temp.intake_check((v_result#>>'{technical,revision}')::integer = 1,'canonical revision 1');
  perform pg_temp.intake_check((select count(*) from public.vehicle_entry_damage_marks m where m.vehicle_entry_id = (v_result#>>'{entry,id}')::uuid) = 1,'canonical marks inserted');
  v_before := pg_temp.intake_footprint();
  perform pg_temp.intake_expect_error(v_form,null,null,null,null,'VEHICLE_VISIT_ALREADY_OPEN');
  perform pg_temp.intake_check(pg_temp.intake_footprint() = v_before,'duplicate visit atomic rollback');
end $create$;
set local role postgres;
insert into public.customers(tenant_id,name,phone,customer_code,deleted_at)
  values((pg_temp.intake_state('tenant')#>>'{}')::uuid,'Deleted duplicate phone','80000002','ROLLBACK-DELETED-DUP',now()),
        ((pg_temp.intake_state('tenant')#>>'{}')::uuid,'Deleted-only identity','80000999','ROLLBACK-DELETED-ONLY',now());
set local role authenticated;
do $visitor_resolution$
declare
  v_form jsonb := pg_temp.intake_state('form'); v_case jsonb; v_result jsonb; v_before jsonb;
  v_id uuid := (pg_temp.intake_state('result')#>>'{entry,id}')::uuid; v_at timestamptz;
begin
  select updated_at into v_at from public.vehicle_entries where id=v_id;
  v_case := jsonb_set(v_form - 'customer_id','{customer,customer_code}','""');
  v_result := public.save_vehicle_entry_intake(v_id,v_at,v_case,null,null);
  perform pg_temp.intake_check(v_result#>>'{entry,customer_id}'=pg_temp.intake_state('visitor')#>>'{}','active visitor wins over a deleted phone match');
  v_before := pg_temp.intake_footprint();
  v_case := jsonb_set(v_case,'{customer,phone}','"+96880000999"');
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_CUSTOMER_RESTORE_REQUIRED');
  v_case := jsonb_set(v_case,'{customer,customer_code}','"ROLLBACK-DELETED-ONLY"');
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_CUSTOMER_RESTORE_REQUIRED');
  v_case := v_form || jsonb_build_object('customer_id',gen_random_uuid());
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_CUSTOMER_UNAVAILABLE');
  v_case := v_form || '{"customer_phone_changed":true,"customer_phone_before_edit":"80000002"}'::jsonb;
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT');
  perform pg_temp.intake_check(pg_temp.intake_footprint()=v_before,'rejected visitor requests have no side effects');
end $visitor_resolution$;
-- The private helper is a NOINHERIT CLI login SET ROLE postgres. RESET ROLE
-- would return to that unprivileged login, not to the fixture administrator.
set local role postgres;
-- Seed historical adjuncts only on OUR synthetic entry. No live row is edited.
insert into public.vehicle_entry_documents(tenant_id,vehicle_entry_id,document_type,file_name)
  values((pg_temp.intake_state('tenant')#>>'{}')::uuid,(pg_temp.intake_state('result')#>>'{entry,id}')::uuid,'other','synthetic-history.pdf');
update public.vehicle_entries e set damage_map = e.damage_map || '{"legacy_note":"KEEP-MAP"}'::jsonb
  where e.id = (pg_temp.intake_state('result')#>>'{entry,id}')::uuid;
set local role authenticated;

do $guards$
declare
  v_form jsonb := pg_temp.intake_state('form'); v_case jsonb; v_before jsonb;
  v_id uuid := (pg_temp.intake_state('result')#>>'{entry,id}')::uuid; v_at timestamptz;
begin
  select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id;
  foreach v_case in array array[null::jsonb,'null'::jsonb,'{}'::jsonb,v_form - 'status',jsonb_set(v_form,'{status}','null'),
    v_form - 'condition',jsonb_set(v_form,'{damage_marks}','null'),jsonb_set(v_form,'{customer_phone_changed}','null')] loop
    perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_INVALID_FORM');
  end loop;
  perform pg_temp.intake_expect_error(v_form,null,null,'null'::jsonb,null,'VEHICLE_INTAKE_INVALID_TECHNICAL');
  perform pg_temp.intake_expect_error(v_form,v_id,null,null,null,'VEHICLE_INTAKE_STALE');
  perform pg_temp.intake_expect_error(v_form,v_id,v_at - interval '1 second',null,null,'VEHICLE_INTAKE_STALE');
  v_before := pg_temp.intake_footprint();
  v_case := jsonb_set(v_form,'{customer_id}',pg_temp.intake_state('foreign_customer'));
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_CUSTOMER_UNAVAILABLE');
  v_case := jsonb_set(v_form,'{vehicle_id}',pg_temp.intake_state('foreign_vehicle'));
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_VEHICLE_CONFLICT');
  v_case := v_form || jsonb_build_object('insurance_company_id',pg_temp.intake_state('foreign_company'));
  perform pg_temp.intake_expect_error(v_case,v_id,v_at,null,null,'VEHICLE_INTAKE_LINK_CONFLICT');
  v_case := jsonb_set(v_form,'{customer,customer_code}','"ROLLBACK-OWNER"');
  perform pg_temp.intake_expect_error(v_case,v_id,v_at,null,null,'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT');
  v_case := jsonb_set(v_form,'{customer,phone}','"+96880000009"');
  perform pg_temp.intake_expect_error(v_case,v_id,v_at,null,null,'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT');
  v_case := jsonb_set(v_form || '{"customer_phone_changed":true,"customer_phone_before_edit":"WRONG"}','{customer,phone}','"+96880000009"');
  perform pg_temp.intake_expect_error(v_case,v_id,v_at,null,null,'VEHICLE_INTAKE_STALE');
  v_case := jsonb_set(jsonb_set(v_form,'{vehicle_id}',pg_temp.intake_state('deleted')),'{vehicle,plate_number}','"92736483"');
  v_case := jsonb_set(v_case,'{vehicle,vin}','""');
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_INTAKE_VEHICLE_DELETED');
  v_case := jsonb_set(v_form,'{vehicle,vin}','"DIFFERENTVIN"');
  perform pg_temp.intake_expect_error(v_case,v_id,v_at,null,null,'VEHICLE_INTAKE_VEHICLE_CONFLICT');
  perform pg_temp.intake_check(pg_temp.intake_footprint() = v_before,'identity/link/deleted/stale denials unchanged');

  -- Deliberately fail AFTER changing customer phone, entry and marks.
  v_case := jsonb_set(v_form || '{"customer_phone_changed":true}','{customer,phone}','"+96880000009"');
  v_case := jsonb_set(v_case,'{damage_marks}','[{"mark_number":8,"damage_type":"dent","x":60,"y":70}]');
  perform pg_temp.intake_expect_error(v_case,v_id,v_at,'{"cranking":"no"}',99,'VEHICLE_INTAKE_TECHNICAL_STALE');
  perform pg_temp.intake_check(pg_temp.intake_footprint() = v_before,'stale declaration rolls back phone entry marks and map');
  -- Creation failure also rolls back new customer/vehicle, transactional entry
  -- numbering, visit workflows/transitions and all audit/technical rows.
  v_case := v_form - 'customer_id' - 'vehicle_id';
  v_case := jsonb_set(jsonb_set(v_case,'{customer,customer_code}','""'),'{customer,phone}','"+96880000019"');
  v_case := jsonb_set(jsonb_set(v_case,'{vehicle,plate_number}','"92736499"'),'{vehicle,vin}','"SYNTHETICNEWVIN"');
  perform pg_temp.intake_expect_error(v_case,null,null,'{}',8,'VEHICLE_INTAKE_TECHNICAL_STALE');
  perform pg_temp.intake_check(pg_temp.intake_footprint() = v_before,'failed new intake all affected tables rollback');
end $guards$;

do $edit$
declare v_form jsonb := pg_temp.intake_state('form'); v_result jsonb; v_id uuid; v_at timestamptz;
  v_documents text := pg_temp.intake_footprint()->>'vehicle_entry_documents';
begin
  v_id := (pg_temp.intake_state('result')#>>'{entry,id}')::uuid;
  select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id;
  v_form := jsonb_set(v_form,'{customer,email}','""');
  v_form := jsonb_set(jsonb_set(v_form,'{vehicle,engine_number}','""'),'{vehicle,transmission}','""');
  v_form := jsonb_set(v_form,'{condition}','{"visit_purpose":"workshop"}');
  v_form := jsonb_set(v_form,'{damage_marks}','[{"mark_number":2,"damage_type":"dent","x":22,"y":44}]');
  v_result := public.save_vehicle_entry_intake(v_id,v_at,v_form,'{"cranking":"no"}',1);
  perform pg_temp.intake_check(v_result#>>'{entry,customer_snapshot,email}' = 'historical@example.invalid','historical email retained');
  perform pg_temp.intake_check(v_result#>>'{entry,vehicle_snapshot,engine_number}' = 'KEEP-ENGINE' and v_result#>>'{entry,vehicle_snapshot,transmission}' = 'KEEP-GEAR','historical engine/transmission retained');
  perform pg_temp.intake_check(v_result#>>'{entry,vehicle_condition,condition_description}' = 'KEEP-HISTORY' and v_result#>>'{entry,vehicle_condition,legacy_attachment}' = 'KEEP-ATTACHMENT','historical condition/adjunct retained');
  perform pg_temp.intake_check(v_result#>>'{entry,damage_map,legacy_note}' = 'KEEP-MAP' and v_result#>'{entry,damage_map,marks}' = '[{"n":2,"x":22,"y":44,"type":"dent"}]'::jsonb,'edit map projection and old extras');
  perform pg_temp.intake_check((v_result#>>'{technical,revision}')::integer = 2,'canonical revision updated once');
  perform pg_temp.intake_check(pg_temp.intake_footprint()->>'vehicle_entry_documents' = v_documents,'historical document untouched');
  v_result := public.save_vehicle_entry_intake(v_id,(v_result#>>'{entry,updated_at}')::timestamptz,v_form,'{"cranking":"no"}',2);
  perform pg_temp.intake_check((v_result#>>'{technical,revision}')::integer = 2,'unchanged declaration no revision churn');
  -- Explicit phone edit: raw legacy baseline compared exactly, only phone moves.
  v_form := jsonb_set(v_form || '{"customer_phone_changed":true}','{customer,phone}','"+96880000009"');
  v_result := public.save_vehicle_entry_intake(v_id,(v_result#>>'{entry,updated_at}')::timestamptz,v_form,null,null);
  perform pg_temp.intake_check((select c.phone = '+96880000009' and c.name = 'Synthetic visitor' from public.customers c where c.id = (v_form->>'customer_id')::uuid),'explicit phone CAS change only');
  perform pg_temp.intake_check((v_result#>>'{technical,revision}')::integer = 2,'null technical preserves canonical declaration');
  update pg_temp.intake_test_state set value = v_result where key = 'result';
  update pg_temp.intake_test_state set value = jsonb_set(v_form || '{"customer_phone_changed":false,"customer_phone_before_edit":"+96880000009"}','{damage_marks}','[]') where key = 'form';
end $edit$;

do $new_and_lookup$
declare v_form jsonb := pg_temp.intake_state('form'); v_case jsonb; v_result jsonb; v_id uuid; v_at timestamptz; v_before jsonb;
begin
  -- No selected customer ID: normalized legacy international phone finds the
  -- same visitor; the normal save must not touch its master identity.
  v_id := (pg_temp.intake_state('result')#>>'{entry,id}')::uuid;
  select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id;
  v_case := jsonb_set(jsonb_set(v_form - 'customer_id','{customer,customer_code}','""'),'{customer,phone}','"0096880000009"');
  v_result := public.save_vehicle_entry_intake(v_id,v_at,v_case,null,null);
  perform pg_temp.intake_check(v_result#>>'{entry,customer_id}' = v_form->>'customer_id','legacy 00968 phone lookup reuse');
  select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id;
  v_case := jsonb_set(v_form - 'customer_id','{customer,phone}','""');
  v_result := public.save_vehicle_entry_intake(v_id,v_at,v_case,null,null);
  perform pg_temp.intake_check(v_result#>>'{entry,customer_id}' = v_form->>'customer_id','customer-code-only lookup reuse');
  v_case := v_form - 'customer_id' - 'vehicle_id';
  v_case := jsonb_set(jsonb_set(v_case,'{customer,customer_code}','""'),'{customer,phone}','"+96880000029"');
  v_case := jsonb_set(jsonb_set(v_case,'{vehicle,plate_number}','"92736529"'),'{vehicle,vin}','"SYNTHETICBULKVIN"');
  v_result := public.save_vehicle_entry_intake(null,null,v_case,null,null);
  perform pg_temp.intake_check(v_result->'technical' = 'null'::jsonb,'bulk null technical accepted');
  perform pg_temp.intake_check(nullif(v_result#>>'{entry,customer_snapshot,customer_code}','') is not null,'new customer code assigned');
  perform pg_temp.intake_check((select v.customer_id::text from public.vehicles v where v.id = (v_result#>>'{entry,vehicle_id}')::uuid) = v_result#>>'{entry,customer_id}','new vehicle owner initialized once');
  v_before := pg_temp.intake_footprint();
  perform pg_temp.intake_expect_error(v_case,null,null,null,null,'VEHICLE_VISIT_ALREADY_OPEN');
  perform pg_temp.intake_check(pg_temp.intake_footprint() = v_before,'new identity repeat does not duplicate masters');
end $new_and_lookup$;
set local role postgres;

-- Existing active identities can be reused by every allowed intake role without
-- requiring UPDATE on the customer/vehicle master. RLS still governs actual writes.
do $roles$
declare v_role text; v_form jsonb := pg_temp.intake_state('form'); v_result jsonb; v_at timestamptz; v_id uuid;
begin
  v_id := (pg_temp.intake_state('result')#>>'{entry,id}')::uuid;
  foreach v_role in array array['admin','manager','insurance','supervisor','technician'] loop
    perform pg_temp.intake_actor(v_role); execute 'set local role authenticated';
    select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id;
    v_result := public.save_vehicle_entry_intake(v_id,v_at,v_form,null,null);
    perform pg_temp.intake_check(v_result#>>'{entry,id}' = v_id::text,'allowed role existing intake: ' || v_role);
    execute 'set local role postgres';
  end loop;
  foreach v_role in array array['accountant','disabled','unprovisioned'] loop
    perform pg_temp.intake_actor(v_role); execute 'set local role authenticated';
    perform pg_temp.intake_expect_error(v_form,null,null,null,null,'VEHICLE_INTAKE_FORBIDDEN');
    execute 'set local role postgres';
  end loop;
end $roles$;

-- Reproduce the EXISTING trigger gaps using synthetic historical links only.
-- Entry/order link completion runs on INSERT, not later converted-link edits.
-- Its claim-less branch also accepts an 'insurance' order with no claim.
do $link_setup$
declare
  v_kind text; v_index integer := 0; v_tenant uuid := (pg_temp.intake_state('tenant')#>>'{}')::uuid;
  v_owner uuid := (pg_temp.intake_state('owner')#>>'{}')::uuid;
  v_visitor uuid := (pg_temp.intake_state('visitor')#>>'{}')::uuid;
  v_vehicle uuid; v_claim uuid; v_other_claim uuid; v_order uuid; v_entry uuid; v_form jsonb;
begin
  perform pg_temp.intake_actor('manager');
  foreach v_kind in array array['legacy_valid','legacy_mismatch','cash_with_claim','orphan_insurance','cash_snapshot','dual_conflict','new_valid','new_wrong_claim','new_cash_valid'] loop
    v_index := v_index + 1; v_claim := null; v_other_claim := null; v_entry := null;
    insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model)
      values(v_tenant,v_owner,(92800000 + v_index)::text,'TT','OM','Synthetic','Link rollback') returning id into v_vehicle;
    if v_kind not in ('orphan_insurance','cash_snapshot','new_cash_valid') then
      insert into public.insurance_claims(tenant_id,customer_id,vehicle_id,claim_number,insurance_company)
        values(v_tenant,v_owner,v_vehicle,'SYNTHETIC-LINK-' || v_index,'Synthetic insurer') returning id into v_claim;
    end if;
    if v_kind in ('legacy_mismatch','dual_conflict','new_wrong_claim') then
      insert into public.insurance_claims(tenant_id,customer_id,vehicle_id,claim_number,insurance_company)
        values(v_tenant,v_owner,v_vehicle,'SYNTHETIC-OTHER-' || v_index,'Synthetic insurer') returning id into v_other_claim;
    end if;
    insert into public.job_orders(tenant_id,customer_id,vehicle_id,order_number,claim_id,work_order_type)
      values(v_tenant,v_owner,v_vehicle,'SYNTHETIC-IGNORED-' || v_index,
        case when v_kind in ('cash_with_claim','orphan_insurance','cash_snapshot','new_cash_valid') then null else v_claim end,
        case when v_kind in ('cash_with_claim','cash_snapshot','new_cash_valid') then 'general_customer' else 'insurance' end) returning id into v_order;
    v_form := pg_temp.intake_state('form') || jsonb_build_object('vehicle_id',v_vehicle,'insurance_claim_id',null,'work_order_id',null);
    v_form := jsonb_set(v_form,'{vehicle}',jsonb_build_object('plate_number',(92800000 + v_index)::text,'plate_letters','TT','plate_country','OM','make','Synthetic','model','Link rollback','vin',''));
    v_form := jsonb_set(v_form,'{insurance}',case when v_kind = 'cash_snapshot'
      then '{"is_insurance_related":true}'::jsonb else '{}'::jsonb end);
    if v_kind like 'new_%' then
      v_form := v_form || jsonb_build_object('insurance_claim_id',case when v_kind = 'new_wrong_claim' then v_other_claim else v_claim end,'work_order_id',v_order);
    else
      -- Seed valid converted-only history first. Cash/no-claim orders link too.
      insert into public.vehicle_entries(tenant_id,entry_number,customer_id,vehicle_id,status,vehicle_location,
        converted_claim_id,converted_work_order_id,customer_snapshot,vehicle_snapshot,vehicle_condition)
        values(v_tenant,'SYNTHETIC-HISTORY-' || v_index,v_visitor,v_vehicle,'Received','داخل الورشة',
          case when v_kind = 'cash_with_claim' then null else v_claim end,v_order,v_form->'customer',v_form->'vehicle','{"visit_purpose":"workshop"}') returning id into v_entry;
      if v_kind = 'legacy_mismatch' then
        update public.vehicle_entries e set converted_claim_id = v_other_claim where e.id = v_entry;
        perform pg_temp.intake_check((select e.converted_claim_id = v_other_claim from public.vehicle_entries e where e.id = v_entry),'existing triggers allow mismatched legacy claim edit');
      elsif v_kind = 'cash_with_claim' then
        update public.vehicle_entries e set converted_claim_id = v_claim where e.id = v_entry;
      elsif v_kind = 'dual_conflict' then
        update public.vehicle_entries e set insurance_claim_id = v_other_claim where e.id = v_entry;
        v_form := v_form || jsonb_build_object('insurance_claim_id',v_other_claim);
      elsif v_kind = 'orphan_insurance' then
        perform pg_temp.intake_check((select j.work_order_type = 'insurance' and j.claim_id is null and j.vehicle_entry_id = v_entry
          from public.job_orders j where j.id = v_order),'existing insert trigger accepts orphan insurance channel');
      end if;
    end if;
    insert into pg_temp.intake_test_state values('link_' || v_kind,jsonb_build_object('form',v_form,'entry_id',v_entry,'claim_id',v_claim,'order_id',v_order));
  end loop;
end $link_setup$;
set local role authenticated;
do $link_regression$
declare v_kind text; v_case jsonb; v_id uuid; v_at timestamptz; v_before jsonb; v_result jsonb;
begin
  foreach v_kind in array array['legacy_mismatch','cash_with_claim','orphan_insurance','cash_snapshot','dual_conflict','new_wrong_claim'] loop
    v_case := pg_temp.intake_state('link_' || v_kind); v_id := (v_case->>'entry_id')::uuid; v_at := null;
    if v_id is not null then select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id; end if;
    v_before := pg_temp.intake_footprint();
    perform pg_temp.intake_expect_error(v_case->'form',v_id,v_at,null,null,'VEHICLE_INTAKE_LINK_CONFLICT');
    perform pg_temp.intake_check(pg_temp.intake_footprint() = v_before,'link/channel denial atomic: ' || v_kind);
  end loop;
  foreach v_kind in array array['legacy_valid','new_valid','new_cash_valid'] loop
    v_case := pg_temp.intake_state('link_' || v_kind); v_id := (v_case->>'entry_id')::uuid; v_at := null;
    if v_id is not null then select e.updated_at into v_at from public.vehicle_entries e where e.id = v_id; end if;
    v_before := pg_temp.intake_footprint();
    v_result := public.save_vehicle_entry_intake(v_id,v_at,v_case->'form',null,null);
    perform pg_temp.intake_check(v_result#>>'{entry,customer_id}' = pg_temp.intake_state('visitor')#>>'{}','linked visitor remains independent of financial owner');
    perform pg_temp.intake_check((select j.customer_id::text from public.job_orders j where j.id = (v_case->>'order_id')::uuid) = pg_temp.intake_state('owner')#>>'{}','work-order financial customer unchanged');
    if v_case->>'claim_id' is not null then
      perform pg_temp.intake_check((select c.customer_id::text from public.insurance_claims c where c.id = (v_case->>'claim_id')::uuid) = pg_temp.intake_state('owner')#>>'{}','claim financial customer unchanged');
    end if;
    if v_kind = 'legacy_valid' then
      perform pg_temp.intake_check(v_result#>'{entry,insurance_claim_id}' = 'null'::jsonb and v_result#>'{entry,work_order_id}' = 'null'::jsonb
        and v_result#>>'{entry,converted_claim_id}' = v_case->>'claim_id' and v_result#>>'{entry,converted_work_order_id}' = v_case->>'order_id','converted-only columns preserved without backfill');
      perform pg_temp.intake_check(pg_temp.intake_footprint()->>'insurance_claims' = v_before->>'insurance_claims'
        and pg_temp.intake_footprint()->>'job_orders' = v_before->>'job_orders','legacy edit does not mutate financial source records');
    end if;
  end loop;
end $link_regression$;
set local role postgres;
-- A new archived-vehicle intake must work for every existing intake writer,
-- including insurance/supervisor who cannot UPDATE the vehicle registry.
do $archived_roles$
declare v_role text; v_vehicle uuid; v_form jsonb; v_result jsonb; v_before jsonb; v_i integer := 0;
begin
  foreach v_role in array array['admin','manager','insurance','supervisor','technician'] loop
    execute 'set local role postgres';
    v_i := v_i + 1;
    insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model,archived,archived_at,archived_reason)
      values((pg_temp.intake_state('tenant')#>>'{}')::uuid,(pg_temp.intake_state('owner')#>>'{}')::uuid,
        (92880000+v_i)::text,'TEST','OM','Synthetic','Archived role proof',true,now(),'Synthetic archive') returning id into v_vehicle;
    v_form := pg_temp.intake_state('form') || jsonb_build_object('vehicle_id',v_vehicle,'status','Received');
    v_form := jsonb_set(v_form,'{vehicle}',jsonb_build_object('plate_number',(92880000+v_i)::text,'plate_letters','TEST','plate_country','OM','make','Synthetic','model','Archived role proof','vin',''));
    perform pg_temp.intake_actor(v_role); execute 'set local role authenticated';
    v_before := pg_temp.intake_footprint();
    perform pg_temp.intake_expect_error(v_form,null,null,'{}',8,'VEHICLE_INTAKE_TECHNICAL_STALE');
    perform pg_temp.intake_check(v_before = pg_temp.intake_footprint(),'failed new intake leaves archived vehicle and all links unchanged: ' || v_role);
    v_result := public.save_vehicle_entry_intake(null,null,v_form,'{"cranking":"yes"}',null);
    perform pg_temp.intake_check(v_result#>>'{entry,vehicle_id}' = v_vehicle::text,'archived role intake confirmed: ' || v_role);
    perform pg_temp.intake_check((select not v.archived and v.archived_at is null and v.archived_reason is null
      and v.customer_id::text = pg_temp.intake_state('owner')#>>'{}' from public.vehicles v where v.id=v_vehicle),'archive restored after insert without ownership rewrite: ' || v_role);
  end loop;
end $archived_roles$;
set local role postgres;
select pg_temp.intake_actor('unprovisioned');
set local role anon;
do $anon$ declare v_denied boolean := false; begin
  begin perform public.save_vehicle_entry_intake(null,null,null,null,null);
  exception when insufficient_privilege then v_denied := true; end;
  if not v_denied then raise exception 'ANON_INTAKE_NOT_DENIED'; end if;
end $anon$;
set local role postgres;
select jsonb_build_object('proof','atomic_vehicle_intake','status','passed','rollback_required',true) as verification;
rollback;
