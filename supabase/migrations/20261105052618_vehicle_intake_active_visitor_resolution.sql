-- Resolve the current visitor from active same-tenant identities only.
-- Deleted-only matches require explicit restoration; never duplicate or restore
-- a customer implicitly. Retain the invoker, archive, CAS and atomic contract.
create or replace function public.save_vehicle_entry_intake(
  p_entry_id uuid, p_expected_updated_at timestamptz, p_form jsonb,
  p_technical jsonb default null, p_technical_revision integer default null
) returns jsonb language plpgsql security invoker set search_path = ''
as $function$
#variable_conflict error
declare
  v_tenant uuid := public.get_user_tenant_id(); v_actor uuid := auth.uid();
  v_old public.vehicle_entries%rowtype; v_saved public.vehicle_entries%rowtype;
  v_customer public.customers%rowtype; v_vehicle public.vehicles%rowtype;
  v_declaration public.vehicle_technical_declarations%rowtype;
  v_linked_order public.job_orders%rowtype;
  v_customer_id uuid; v_vehicle_id uuid; v_claim_id uuid; v_order_id uuid; v_company_id uuid;
  v_effective_claim uuid; v_effective_order uuid; v_insurance_channel boolean;
  v_customer_data jsonb; v_vehicle_data jsonb; v_condition jsonb; v_contents jsonb; v_damage_map jsonb;
  v_phone text; v_digits text; v_stored_digits text; v_code text; v_expected_phone text; v_phone_changed boolean;
  v_plate text; v_letters text; v_country text; v_vin text; v_stored_vin text;
  v_ids uuid[]; v_vin_ids uuid[]; v_state text; v_number text; v_mark jsonb; v_position integer := 0;
begin
  if v_actor is null or v_tenant is null
    or coalesce(public.get_user_role()::text,'') not in ('admin','manager','insurance','supervisor','technician')
    or not exists (select 1 from public.profiles p where p.user_id = v_actor and p.tenant_id = v_tenant and p.account_status = 'active') then
    raise exception 'VEHICLE_INTAKE_FORBIDDEN' using errcode = '42501';
  end if;
  -- SQL NULL must fail closed, including missing required nested objects.
  if jsonb_typeof(p_form) is distinct from 'object' or octet_length(p_form::text) > 100000
    or coalesce(p_form->>'status','') not in ('Draft','Received','Issued','Converted to Claim','Converted to Work Order')
    or jsonb_typeof(p_form->'customer') is distinct from 'object'
    or jsonb_typeof(p_form->'vehicle') is distinct from 'object'
    or jsonb_typeof(p_form->'condition') is distinct from 'object'
    or jsonb_typeof(p_form->'contents') is distinct from 'object'
    or jsonb_typeof(p_form->'insurance') is distinct from 'object'
    or jsonb_typeof(p_form->'delivered_by') is distinct from 'object'
    or jsonb_typeof(p_form->'damage_marks') is distinct from 'array'
    or coalesce(p_form#>>'{condition,visit_purpose}','') not in ('workshop','inspection')
    or nullif(p_form->>'arrival_date','') is null or nullif(p_form->>'arrival_time','') is null
    or (p_form ? 'tenant_id' and p_form->>'tenant_id' is distinct from v_tenant::text)
    or (p_form ? 'customer_phone_changed' and jsonb_typeof(p_form->'customer_phone_changed') is distinct from 'boolean') then
    raise exception 'VEHICLE_INTAKE_INVALID_FORM' using errcode = '22023';
  end if;
  if (p_technical is not null and (jsonb_typeof(p_technical) is distinct from 'object' or octet_length(p_technical::text) > 15000))
    or (p_technical is null and p_technical_revision is not null) or p_technical_revision < 1 then
    raise exception 'VEHICLE_INTAKE_INVALID_TECHNICAL' using errcode = '22023';
  end if;
  v_state := p_form->>'status'; v_phone_changed := coalesce((p_form->>'customer_phone_changed')::boolean,false);
  v_customer_id := nullif(p_form->>'customer_id','')::uuid; v_vehicle_id := nullif(p_form->>'vehicle_id','')::uuid;
  v_claim_id := nullif(p_form->>'insurance_claim_id','')::uuid; v_order_id := nullif(p_form->>'work_order_id','')::uuid;
  v_company_id := nullif(p_form->>'insurance_company_id','')::uuid;
  v_customer_data := p_form->'customer'; v_vehicle_data := p_form->'vehicle';
  v_condition := p_form->'condition'; v_contents := p_form->'contents';
  if exists (select 1 from jsonb_array_elements(p_form->'damage_marks') m
    where jsonb_typeof(m.value) is distinct from 'object') then
    raise exception 'VEHICLE_INTAKE_INVALID_FORM' using errcode = '22023';
  end if;
  -- Compatibility projection only: the marks table remains canonical. Keep
  -- coordinates/numbers identical to the rows written by this transaction.
  select jsonb_build_object('marks',coalesce(jsonb_agg(jsonb_build_object(
    'n',coalesce((m.value->>'mark_number')::integer,m.ordinality::integer),
    'x',nullif(m.value->>'x','')::numeric,'y',nullif(m.value->>'y','')::numeric,
    'type',nullif(m.value->>'damage_type','')) order by m.ordinality),'[]'::jsonb))
    into v_damage_map from jsonb_array_elements(p_form->'damage_marks') with ordinality m(value,ordinality);
  if p_entry_id is not null then
    select e.* into v_old from public.vehicle_entries e where e.id = p_entry_id and e.tenant_id = v_tenant and e.deleted_at is null for update;
    if not found or p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then
      raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001';
    end if;
    if v_old.status = 'Cancelled' or exists (select 1 from public.vehicle_visit_workflows w
      where w.entry_id = p_entry_id and w.tenant_id = v_tenant and w.stage in ('delivered','cancelled')) then
      raise exception 'VEHICLE_INTAKE_CLOSED' using errcode = '23514';
    end if;
    if v_old.insurance_claim_id is distinct from v_claim_id or v_old.work_order_id is distinct from v_order_id then
      raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514';
    end if;
    if p_form ? 'vehicle_location_before_edit' and v_old.vehicle_location is distinct from p_form->>'vehicle_location_before_edit' then
      raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001';
    end if;
    if v_old.status like 'Converted to %' then v_state := v_old.status; end if;
    -- Retain hidden/removed historical controls even if sent back blank.
    v_customer_data := v_old.customer_snapshot || v_customer_data || case when v_old.customer_snapshot ? 'email'
      then jsonb_build_object('email',v_old.customer_snapshot->'email') else '{}'::jsonb end;
    v_vehicle_data := v_old.vehicle_snapshot || v_vehicle_data || (select coalesce(jsonb_object_agg(h.key,h.value),'{}'::jsonb)
      from jsonb_each(v_old.vehicle_snapshot) h where h.key in ('engine_number','transmission'));
    v_condition := v_old.vehicle_condition || v_condition; v_contents := v_old.vehicle_contents || v_contents;
    v_damage_map := case when jsonb_typeof(v_old.damage_map) = 'object' then v_old.damage_map else '{}'::jsonb end || v_damage_map;
  elsif p_expected_updated_at is not null then raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001'; end if;
  -- Legacy converted links remain in their original columns. Contradictory
  -- dual links are review cases, never silently repaired by an intake edit.
  if (v_claim_id is not null and v_old.converted_claim_id is not null and v_claim_id <> v_old.converted_claim_id)
    or (v_order_id is not null and v_old.converted_work_order_id is not null and v_order_id <> v_old.converted_work_order_id)
    or (p_form ? 'converted_claim_id' and nullif(p_form->>'converted_claim_id','')::uuid is distinct from v_old.converted_claim_id)
    or (p_form ? 'converted_work_order_id' and nullif(p_form->>'converted_work_order_id','')::uuid is distinct from v_old.converted_work_order_id) then
    raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514';
  end if;
  v_effective_claim := coalesce(v_claim_id,v_old.converted_claim_id);
  v_effective_order := coalesce(v_order_id,v_old.converted_work_order_id);
  v_insurance_channel := v_effective_claim is not null or v_company_id is not null
    or coalesce((p_form#>>'{insurance,is_insurance_related}')::boolean,false)
    or nullif(btrim(p_form#>>'{insurance,company_name}'),'') is not null;

  -- Phone/code identifies today's visitor, not the vehicle's historical owner.
  v_phone := nullif(btrim(p_form#>>'{customer,phone}'),'');
  v_digits := regexp_replace(translate(coalesce(v_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
  if v_phone is not null then
    if v_phone ~ '[A-Za-z]' then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    v_digits := case when v_digits like '00%' then substr(v_digits,3) when length(v_digits) = 8 then '968' || v_digits else v_digits end;
    v_phone := '+' || v_digits;
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-phone|' || v_phone,0));
  end if;
  v_code := nullif(btrim(p_form#>>'{customer,customer_code}'),'');
  if p_entry_id is null and v_phone_changed then
    raise exception 'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT' using errcode = '23514';
  end if;
  if v_customer_id is null then
    if v_phone_changed then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    if v_code is not null then
      select array_agg(c.id) into v_ids from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null and lower(btrim(c.customer_code)) = lower(v_code);
    elsif v_phone is not null then
      select array_agg(c.id) into v_ids from public.customers c
        cross join lateral (select regexp_replace(translate(coalesce(c.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') as digits) n
        where c.tenant_id = v_tenant and c.deleted_at is null and (case when n.digits like '00%' then substr(n.digits,3)
          when length(n.digits) = 8 then '968' || n.digits else n.digits end) = v_digits;
    else raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    if coalesce(cardinality(v_ids),0) > 1 then raise exception 'VEHICLE_INTAKE_CUSTOMER_AMBIGUOUS' using errcode = '23514'; end if;
    if coalesce(cardinality(v_ids),0) = 0 and exists (
      select 1 from public.customers c
      cross join lateral (select regexp_replace(translate(coalesce(c.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') as digits) n
      where c.tenant_id = v_tenant and c.deleted_at is not null and
        ((v_code is not null and lower(btrim(c.customer_code)) = lower(v_code)) or
         (v_code is null and v_phone is not null and (case when n.digits like '00%' then substr(n.digits,3)
           when length(n.digits) = 8 then '968' || n.digits else n.digits end) = v_digits))
    ) then raise exception 'VEHICLE_INTAKE_CUSTOMER_RESTORE_REQUIRED' using errcode = '23514'; end if;
    v_customer_id := v_ids[1];
  end if;
  if v_customer_id is not null then
    if v_phone_changed then
      select c.* into v_customer from public.customers c where c.id = v_customer_id and c.tenant_id = v_tenant and c.deleted_at is null for update;
    else
      -- Do not demand master UPDATE policies for read-only visitor reuse.
      select c.* into v_customer from public.customers c where c.id = v_customer_id and c.tenant_id = v_tenant and c.deleted_at is null;
    end if;
    if not found then raise exception 'VEHICLE_INTAKE_CUSTOMER_UNAVAILABLE' using errcode = '23514'; end if;
    if v_code is not null and lower(btrim(v_customer.customer_code)) is distinct from lower(v_code) then
      raise exception 'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT' using errcode = '23514';
    end if;
  else
    if v_phone is null or v_code is not null then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    -- The existing code allocator is MAX+1. Serialize RPC allocations; keep its
    -- unique index as the final concurrent/non-RPC guard (no new schema here).
    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-customer-code',0));
    insert into public.customers(tenant_id,name,phone,address,id_number)
      values(v_tenant,coalesce(nullif(btrim(v_customer_data->>'name'),''),v_phone),v_phone,
        nullif(v_customer_data->>'address',''),nullif(v_customer_data->>'id_number','')) returning * into v_customer;
    v_customer_id := v_customer.id;
  end if;
  if v_phone is not null then
    if exists (select 1 from public.customers c
      cross join lateral (select regexp_replace(translate(coalesce(c.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') as digits) n
      where c.tenant_id = v_tenant and c.deleted_at is null and c.id <> v_customer_id and (case when n.digits like '00%' then substr(n.digits,3)
        when length(n.digits) = 8 then '968' || n.digits else n.digits end) = v_digits) then
      raise exception 'VEHICLE_INTAKE_PHONE_CONFLICT' using errcode = '23514';
    end if;
    v_stored_digits := regexp_replace(translate(coalesce(v_customer.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
    v_stored_digits := case when v_stored_digits like '00%' then substr(v_stored_digits,3)
      when length(v_stored_digits) = 8 then '968' || v_stored_digits else v_stored_digits end;
    if not v_phone_changed and v_stored_digits is distinct from v_digits then
      raise exception 'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT' using errcode = '23514';
    end if;
  end if;
  if v_phone_changed then
    if v_phone is null or not (p_form ? 'customer_phone_before_edit') then
      raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023';
    end if;
    v_expected_phone := nullif(p_form->>'customer_phone_before_edit','');
    if v_customer.phone is distinct from v_expected_phone then raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001'; end if;
    update public.customers c set phone = v_phone where c.id = v_customer_id and c.tenant_id = v_tenant returning c.* into v_customer;
    if not found then raise exception 'VEHICLE_INTAKE_FORBIDDEN' using errcode = '42501'; end if;
  end if;
  v_customer_data := v_customer_data || jsonb_build_object('name',v_customer.name,'phone',v_customer.phone,'customer_code',v_customer.customer_code);

  v_plate := regexp_replace(translate(coalesce(v_vehicle_data->>'plate_number',''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
  v_letters := upper(regexp_replace(translate(coalesce(v_vehicle_data->>'plate_letters',''),'ابتثجحخدذرزسشصضطظعغفقكلمنهوي','ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),'[^A-Za-z]','','g'));
  v_country := upper(btrim(coalesce(nullif(v_vehicle_data->>'plate_country',''),'OM')));
  if v_country in ('OM','OMN','OMAN','عمان','سلطنة عمان') then v_country := 'OM'; end if;
  v_vin := upper(regexp_replace(coalesce(v_vehicle_data->>'vin',''),'[^A-Za-z0-9]','','g'));
  if v_plate = '' or v_country = '' then raise exception 'VEHICLE_INTAKE_VEHICLE_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-vehicle|' || v_country || '|' || v_letters || '|' || v_plate,0));
  if v_vin <> '' then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-vin|' || v_vin,0)); end if;
  select array_agg(v.id) into v_ids from public.vehicles v where v.tenant_id = v_tenant
    and regexp_replace(translate(v.plate_number,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') = v_plate
    and upper(regexp_replace(translate(coalesce(v.plate_letters,''),'ابتثجحخدذرزسشصضطظعغفقكلمنهوي','ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),'[^A-Za-z]','','g')) = v_letters
    and (case when upper(btrim(coalesce(v.plate_country,'OM'))) in ('OM','OMN','OMAN','عمان','سلطنة عمان')
      then 'OM' else upper(btrim(v.plate_country)) end) = v_country;
  if v_vin <> '' then
    select array_agg(v.id) into v_vin_ids from public.vehicles v where v.tenant_id = v_tenant
      and upper(regexp_replace(coalesce(nullif(v.vin,''),v.vin_number,''),'[^A-Za-z0-9]','','g')) = v_vin;
  end if;
  if coalesce(cardinality(v_ids),0) > 1 or coalesce(cardinality(v_vin_ids),0) > 1
    or (v_ids[1] is not null and v_vin_ids[1] is not null and v_ids[1] <> v_vin_ids[1])
    or (v_vehicle_id is not null and ((v_ids[1] is not null and v_vehicle_id <> v_ids[1])
      or (v_vin_ids[1] is not null and v_vehicle_id <> v_vin_ids[1]))) then
    raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514';
  end if;
  v_vehicle_id := coalesce(v_vehicle_id,v_ids[1],v_vin_ids[1]);
  if v_vehicle_id is not null then
    select v.* into v_vehicle from public.vehicles v where v.id = v_vehicle_id and v.tenant_id = v_tenant;
    if not found then raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514'; end if;
    if v_vehicle.deleted_at is not null then raise exception 'VEHICLE_INTAKE_VEHICLE_DELETED' using errcode = '23514'; end if;
    if not (v_vehicle_id = any(coalesce(v_ids,'{}'::uuid[]))) then raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514'; end if;
    v_stored_vin := upper(regexp_replace(coalesce(nullif(v_vehicle.vin,''),v_vehicle.vin_number,''),'[^A-Za-z0-9]','','g'));
    if v_vin <> '' and v_stored_vin <> '' and v_stored_vin <> v_vin then raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514'; end if;
    -- Existing registry stays read-only here. The authorized NEW entry's
    -- AFTER INSERT trigger reactivates it within this same transaction.
  else
    if nullif(btrim(v_vehicle_data->>'make'),'') is null then raise exception 'VEHICLE_INTAKE_VEHICLE_REQUIRED' using errcode = '22023'; end if;
    insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number)
      values(v_tenant,v_customer_id,v_plate,v_letters,v_country,v_vehicle_data->>'make',coalesce(nullif(v_vehicle_data->>'model',''),'-'),
        nullif(v_vehicle_data->>'year','')::integer,nullif(v_vehicle_data->>'color',''),nullif(v_vin,''),nullif(v_vin,'')) returning * into v_vehicle;
    v_vehicle_id := v_vehicle.id;
  end if;
  v_vehicle_data := v_vehicle_data || jsonb_build_object('plate_number',v_vehicle.plate_number,'plate_letters',v_vehicle.plate_letters,'plate_country',v_vehicle.plate_country);
  if v_effective_claim is not null and not exists (select 1 from public.insurance_claims c where c.id = v_effective_claim and c.tenant_id = v_tenant
    and c.vehicle_id = v_vehicle_id and c.deleted_at is null and c.status::text not in ('cancelled','rejected')) then
    raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514'; end if;
  if v_effective_order is not null then
    select j.* into v_linked_order from public.job_orders j where j.id = v_effective_order and j.tenant_id = v_tenant
      and j.vehicle_id = v_vehicle_id and j.deleted_at is null and j.status::text <> 'delivered' and j.vehicle_delivered_at is null;
    if not found or v_linked_order.claim_id is distinct from v_effective_claim
      or (v_effective_claim is not null and v_linked_order.work_order_type is distinct from 'insurance')
      or (v_effective_claim is null and (v_linked_order.work_order_type = 'insurance' or v_insurance_channel)) then
      raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514';
    end if;
  end if;
  if v_company_id is not null and not exists (select 1 from public.insurance_companies c where c.id = v_company_id and c.tenant_id = v_tenant) then
    raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514'; end if;
  if p_entry_id is null then
    v_number := public.next_vehicle_entry_number(extract(year from now() at time zone 'Asia/Muscat')::integer);
    insert into public.vehicle_entries(tenant_id,entry_number,customer_id,vehicle_id,insurance_company_id,insurance_claim_id,work_order_id,
      status,arrival_date,arrival_time,vehicle_location,vehicle_location_bay,arrival_method,received_by_name,received_by_user_id,
      delivered_by,customer_snapshot,vehicle_snapshot,insurance_snapshot,vehicle_condition,vehicle_contents,damage_map,
      declaration_ar,declaration_en,issued_at,issued_by,created_by,updated_by)
    values(v_tenant,v_number,v_customer_id,v_vehicle_id,v_company_id,v_claim_id,v_order_id,v_state,
      (p_form->>'arrival_date')::date,(p_form->>'arrival_time')::time,'داخل الورشة',nullif(p_form->>'vehicle_location_bay',''),
      nullif(p_form->>'arrival_method',''),p_form->>'received_by_name',v_actor,p_form->'delivered_by',v_customer_data,v_vehicle_data,
      p_form->'insurance',v_condition,v_contents,v_damage_map,p_form->>'declaration_ar',p_form->>'declaration_en',
      case when v_state = 'Issued' then now() end,case when v_state = 'Issued' then v_actor end,v_actor,v_actor) returning * into v_saved;
  else
    update public.vehicle_entries e set customer_id = v_customer_id, vehicle_id = v_vehicle_id, insurance_company_id = v_company_id,
      status = v_state, arrival_date = (p_form->>'arrival_date')::date, arrival_time = (p_form->>'arrival_time')::time,
      vehicle_location_bay = nullif(p_form->>'vehicle_location_bay',''), arrival_method = p_form->>'arrival_method', received_by_name = p_form->>'received_by_name',
      delivered_by = e.delivered_by || p_form->'delivered_by', customer_snapshot = v_customer_data, vehicle_snapshot = v_vehicle_data,
      insurance_snapshot = e.insurance_snapshot || p_form->'insurance', vehicle_condition = v_condition, vehicle_contents = v_contents, damage_map = v_damage_map,
      declaration_ar = coalesce(p_form->>'declaration_ar',e.declaration_ar), declaration_en = coalesce(p_form->>'declaration_en',e.declaration_en),
      issued_at = case when v_state = 'Issued' then coalesce(e.issued_at,now()) else e.issued_at end,
      issued_by = case when v_state = 'Issued' then coalesce(e.issued_by,v_actor) else e.issued_by end, updated_by = v_actor
      where e.id = p_entry_id and e.tenant_id = v_tenant and e.updated_at = p_expected_updated_at returning e.* into v_saved;
    if not found then raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001'; end if;
  end if;
  delete from public.vehicle_entry_damage_marks m where m.vehicle_entry_id = v_saved.id and m.tenant_id = v_tenant;
  for v_mark in select m.value from jsonb_array_elements(p_form->'damage_marks') m loop
    if jsonb_typeof(v_mark) is distinct from 'object' then raise exception 'VEHICLE_INTAKE_INVALID_FORM' using errcode = '22023'; end if;
    v_position := v_position + 1;
    insert into public.vehicle_entry_damage_marks(tenant_id,vehicle_entry_id,mark_number,damage_type,vehicle_part,description,related_to_incident,expected_action,notes,x,y,color)
      values(v_tenant,v_saved.id,coalesce((v_mark->>'mark_number')::integer,v_position),nullif(v_mark->>'damage_type',''),nullif(v_mark->>'vehicle_part',''),
        nullif(v_mark->>'description',''),coalesce((v_mark->>'related_to_incident')::boolean,true),nullif(v_mark->>'expected_action',''),nullif(v_mark->>'notes',''),
        nullif(v_mark->>'x','')::numeric,nullif(v_mark->>'y','')::numeric,nullif(v_mark->>'color',''));
  end loop;
  select d.* into v_declaration from public.vehicle_technical_declarations d where d.tenant_id = v_tenant and d.vehicle_entry_id = v_saved.id for update;
  if p_technical is not null then
    if (v_declaration.id is null and p_technical_revision is not null)
      or (v_declaration.id is not null and v_declaration.revision is distinct from p_technical_revision) then
      raise exception 'VEHICLE_INTAKE_TECHNICAL_STALE' using errcode = '40001'; end if;
    if v_declaration.id is null then
      insert into public.vehicle_technical_declarations(tenant_id,vehicle_entry_id,form_data) values(v_tenant,v_saved.id,p_technical) returning * into v_declaration;
    elsif v_declaration.form_data is distinct from p_technical then
      update public.vehicle_technical_declarations d set form_data = p_technical where d.tenant_id = v_tenant
        and d.vehicle_entry_id = v_saved.id and d.revision = p_technical_revision returning d.* into v_declaration;
      if not found then raise exception 'VEHICLE_INTAKE_TECHNICAL_STALE' using errcode = '40001'; end if;
    end if;
  end if;
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(v_tenant,v_saved.id,v_actor,case when p_entry_id is null then 'vehicle_entry.created' else 'vehicle_entry.updated' end,
      jsonb_build_object('status',v_state,'entry_number',v_saved.entry_number,'technical_revision',v_declaration.revision));
  return jsonb_build_object('entry',to_jsonb(v_saved),'technical',case when v_declaration.id is not null then to_jsonb(v_declaration) end);
end $function$;
revoke all on function public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer) from public, anon;
grant execute on function public.save_vehicle_entry_intake(uuid,timestamptz,jsonb,jsonb,integer) to authenticated;
