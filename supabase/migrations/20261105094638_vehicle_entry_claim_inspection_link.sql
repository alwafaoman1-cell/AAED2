-- New, explicit visit-scoped inspections only. No historical relinking/backfill.
-- Reuse the established DR allocator/report table and the claim's UUID pointer.
create unique index inspections_entry_damage_report_unique
  on public.inspections (tenant_id, (details->>'vehicleEntryId'))
  where inspection_kind = 'insurance' and details->>'vehicleEntryId' is not null;

-- Align the existing insurance report writer with its existing Insurance role UI
-- permission. Do not change numbering, existing signatures or technician access.
do $migration$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public.save_insurance_damage_report(text,uuid,text,jsonb)'::regprocedure);
  if position('''technician''::public.app_role, ''supervisor''::public.app_role' in v_definition) = 0 then
    raise exception 'INSPECTION_WRITER_DEFINITION_CHANGED';
  end if;
  execute replace(v_definition,
    '''technician''::public.app_role, ''supervisor''::public.app_role',
    '''technician''::public.app_role, ''supervisor''::public.app_role, ''insurance''::public.app_role');
end;
$migration$;

create or replace function public.save_vehicle_entry_damage_inspection(
  p_entry_id uuid, p_existing_code text, p_request_id uuid, p_report jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_inspection public.inspections%rowtype;
  v_claim_id uuid;
  v_order_id uuid;
  v_code text;
  v_report jsonb;
  v_new boolean;
  v_profile_id uuid;
begin
  select p.id into v_profile_id from public.profiles p where p.user_id = auth.uid() and p.tenant_id = v_tenant
    and p.account_status = 'active' and p.disabled_at is null and p.role in ('admin', 'manager', 'supervisor', 'insurance');
  if auth.uid() is null or v_tenant is null or v_profile_id is null then
    raise exception 'INSPECTION_SAVE_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_entry_id is null or p_request_id is null or jsonb_typeof(p_report) is distinct from 'object' then
    raise exception 'INSPECTION_REPORT_INVALID' using errcode = '22023';
  end if;
  -- Lock canonical sources before deduplication, including concurrent tabs/users.
  select * into v_entry from public.vehicle_entries
    where id = p_entry_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found or v_entry.status in ('Draft', 'Cancelled') or v_entry.vehicle_id is null
    or v_entry.vehicle_location is distinct from 'داخل الورشة' then
    raise exception 'INSPECTION_ENTRY_UNAVAILABLE' using errcode = '22023';
  end if;
  if v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null
    and v_entry.insurance_claim_id <> v_entry.converted_claim_id then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  v_claim_id := coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id);
  select * into v_claim from public.insurance_claims
    where id = v_claim_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found or v_claim.vehicle_id is distinct from v_entry.vehicle_id
    or v_claim.status in ('cancelled', 'rejected')
    or (v_claim.vehicle_entry_id is not null and v_claim.vehicle_entry_id <> v_entry.id) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  if v_entry.work_order_id is not null and v_entry.converted_work_order_id is not null
    and v_entry.work_order_id <> v_entry.converted_work_order_id then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  v_order_id := coalesce(v_entry.work_order_id, v_entry.converted_work_order_id);
  if v_order_id is not null then
    select * into v_order from public.job_orders where id = v_order_id and tenant_id = v_tenant and deleted_at is null;
    if not found or v_order.vehicle_id is distinct from v_entry.vehicle_id or v_order.claim_id is distinct from v_claim_id
      or v_order.work_order_type is distinct from 'insurance'
      or (v_order.vehicle_entry_id is not null and v_order.vehicle_entry_id <> v_entry.id) then
      raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
    end if;
  end if;
  select * into v_inspection from public.inspections where tenant_id = v_tenant
    and inspection_kind = 'insurance' and details->>'vehicleEntryId' = v_entry.id::text for update;
  v_new := not found;
  if (v_claim.inspection_id is not null and v_claim.inspection_id is distinct from v_inspection.id)
    or (v_inspection.id is not null and v_inspection.details->>'claimId' is distinct from v_claim_id::text)
    or (nullif(trim(p_existing_code), '') is not null and p_existing_code is distinct from v_inspection.inspection_code) then
    -- Historical links require explicit review, never adopt/overwrite silently.
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  if not v_new and nullif(trim(p_existing_code), '') is null then
    if v_inspection.details->>'insuranceDamageSaveRequestId' is distinct from p_request_id::text then
      raise exception 'INSPECTION_ALREADY_EXISTS' using errcode = '40001';
    end if;
    -- Another tab or a retry already saved. Return that exact report, do not
    -- overwrite it with a stale draft or allocate another DR code.
    return jsonb_build_object('code', v_inspection.inspection_code, 'entryId', v_entry.id,
      'claimId', v_claim_id, 'report', v_inspection.details->'insuranceInspectionReport');
  end if;
  if exists (select 1 from public.inspections i where i.tenant_id = v_tenant
    and i.inspection_kind = 'insurance' and i.details->>'insuranceDamageSaveRequestId' = p_request_id::text
    and i.details->>'vehicleEntryId' is distinct from v_entry.id::text) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  select * into strict v_vehicle from public.vehicles where id = v_entry.vehicle_id and tenant_id = v_tenant;
  v_report := p_report || jsonb_build_object('claimNo', v_claim.claim_number, 'gatePass', v_entry.entry_number,
    'regNo', concat_ws(' ', nullif(v_vehicle.plate_letters, ''), v_vehicle.plate_number),
    'makeModel', concat_ws(' ', v_vehicle.brand, v_vehicle.model), 'modelYear', coalesce(v_vehicle.year::text, ''),
    'insuranceCompany', v_claim.insurance_company);
  v_code := public.save_insurance_damage_report(v_inspection.inspection_code, p_request_id, v_order.order_number, v_report);
  select * into strict v_inspection from public.inspections where tenant_id = v_tenant
    and inspection_kind = 'insurance' and inspection_code = v_code for update;
  -- A request token reused for another visit must not move a report.
  if (v_inspection.details ? 'vehicleEntryId' and v_inspection.details->>'vehicleEntryId' <> v_entry.id::text)
    or (v_inspection.details ? 'claimId' and v_inspection.details->>'claimId' <> v_claim_id::text) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  update public.inspections set details = details || jsonb_build_object(
    'vehicleEntryId', v_entry.id, 'claimId', v_claim_id), inspector_id = coalesce(inspector_id, v_profile_id)
    where id = v_inspection.id;
  if v_claim.inspection_id is distinct from v_inspection.id then
    update public.insurance_claims set inspection_id = v_inspection.id
      where id = v_claim_id and tenant_id = v_tenant;
  end if;
  insert into public.claim_audit_logs(tenant_id, claim_id, user_id, action, details)
    values (v_tenant, v_claim_id, auth.uid(), 'vehicle_entry_inspection_saved', jsonb_build_object(
      'vehicle_entry_id', v_entry.id, 'inspection_id', v_inspection.id, 'inspection_code', v_code, 'created', v_new));
  return jsonb_build_object('code', v_code, 'entryId', v_entry.id,
    'claimId', v_claim_id, 'report', v_inspection.details->'insuranceInspectionReport');
end;
$function$;
revoke all on function public.save_vehicle_entry_damage_inspection(uuid,text,uuid,jsonb) from public, anon;
grant execute on function public.save_vehicle_entry_damage_inspection(uuid,text,uuid,jsonb) to authenticated;

-- Every writer, including the legacy edit RPC, preserves the canonical link.
-- Only new visit-scoped reports opt into this guard; old records are untouched.
create or replace function app_private.guard_entry_inspection_identity()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $guard$
declare v_entry public.vehicle_entries%rowtype; v_claim public.insurance_claims%rowtype; v_vehicle public.vehicles%rowtype;
begin
  if old.details->>'vehicleEntryId' is null then return new; end if;
  if new.tenant_id is distinct from old.tenant_id or new.inspection_code is distinct from old.inspection_code
    or new.inspection_kind is distinct from old.inspection_kind
    or new.details->>'vehicleEntryId' is distinct from old.details->>'vehicleEntryId'
    or new.details->>'claimId' is distinct from old.details->>'claimId' then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  select * into strict v_entry from public.vehicle_entries where tenant_id = new.tenant_id and id = (old.details->>'vehicleEntryId')::uuid;
  select * into strict v_claim from public.insurance_claims where tenant_id = new.tenant_id and id = (old.details->>'claimId')::uuid;
  select * into strict v_vehicle from public.vehicles where tenant_id = new.tenant_id and id = v_entry.vehicle_id;
  if coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id) is distinct from v_claim.id
    or v_claim.vehicle_id is distinct from v_entry.vehicle_id
    or new.job_order_id is distinct from coalesce(v_entry.work_order_id, v_entry.converted_work_order_id)
    or new.details->'insuranceInspectionReport'->>'claimNo' is distinct from v_claim.claim_number
    or new.details->'insuranceInspectionReport'->>'gatePass' is distinct from v_entry.entry_number
    or new.details->'insuranceInspectionReport'->>'regNo' is distinct from concat_ws(' ', nullif(v_vehicle.plate_letters, ''), v_vehicle.plate_number) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  return new;
end;
$guard$;
revoke all on function app_private.guard_entry_inspection_identity() from public, anon, authenticated;
create trigger guard_entry_inspection_identity before update on public.inspections
  for each row execute function app_private.guard_entry_inspection_identity();
