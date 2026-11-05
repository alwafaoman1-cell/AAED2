-- Guard first attachment/insert as well as later edits. Historical unlinked
-- reports cannot acquire visit identity in a later transaction.
create or replace function app_private.guard_entry_inspection_identity()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $guard$
declare v_entry public.vehicle_entries%rowtype; v_claim public.insurance_claims%rowtype; v_vehicle public.vehicles%rowtype;
begin
  if tg_op = 'UPDATE' and old.details->>'vehicleEntryId' is not null then
    if new.tenant_id is distinct from old.tenant_id or new.inspection_code is distinct from old.inspection_code
      or new.inspection_kind is distinct from old.inspection_kind
      or new.details->>'vehicleEntryId' is distinct from old.details->>'vehicleEntryId'
      or new.details->>'claimId' is distinct from old.details->>'claimId' then
      raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
    end if;
  elsif new.details->>'vehicleEntryId' is null and new.details->>'claimId' is null then
    return new;
  elsif tg_op = 'UPDATE' then
    if old.created_at < transaction_timestamp()
      or old.details->>'insuranceDamageSaveRequestId' is null
      or new.details->>'insuranceDamageSaveRequestId' is distinct from old.details->>'insuranceDamageSaveRequestId' then
      raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
    end if;
  end if;
  if new.inspection_kind <> 'insurance' or new.details->>'vehicleEntryId' is null or new.details->>'claimId' is null then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  select * into strict v_entry from public.vehicle_entries where tenant_id = new.tenant_id and id = (new.details->>'vehicleEntryId')::uuid;
  select * into strict v_claim from public.insurance_claims where tenant_id = new.tenant_id and id = (new.details->>'claimId')::uuid;
  select * into strict v_vehicle from public.vehicles where tenant_id = new.tenant_id and id = v_entry.vehicle_id;
  if coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id) is distinct from v_claim.id
    or (v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null and v_entry.insurance_claim_id <> v_entry.converted_claim_id)
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
drop trigger guard_entry_inspection_identity on public.inspections;
create trigger guard_entry_inspection_identity before insert or update on public.inspections
  for each row execute function app_private.guard_entry_inspection_identity();
