-- Future arrivals only: the entry is the physical custody evidence. Never
-- backfill or silently reconcile older, contradictory claim/order records.
create function public.vehicle_visit_align_new_entry_presence()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null or new.vehicle_id is null
    or new.vehicle_location is distinct from 'داخل الورشة' then return new; end if;

  update public.job_orders j set vehicle_presence_status = 'in_workshop', updated_at = now()
    where j.tenant_id = new.tenant_id and j.vehicle_id = new.vehicle_id
      and j.id in (new.work_order_id, new.converted_work_order_id)
      and (j.vehicle_entry_id is null or j.vehicle_entry_id = new.id)
      and j.deleted_at is null and j.status::text <> 'delivered'
      and j.vehicle_delivered_at is null and j.vehicle_presence_status = 'with_customer';
  update public.insurance_claims c set vehicle_presence_status = 'in_workshop', updated_at = now()
    where c.tenant_id = new.tenant_id and c.vehicle_id = new.vehicle_id
      and c.id in (new.insurance_claim_id, new.converted_claim_id)
      and (c.vehicle_entry_id is null or c.vehicle_entry_id = new.id)
      and c.deleted_at is null and c.status::text not in ('cancelled','rejected')
      and c.delivered_at is null and c.vehicle_delivered_at is null
      and c.vehicle_presence_status = 'with_customer';
  return new;
end;
$$;

create trigger trg_vehicle_visit_align_new_entry_presence
  after insert on public.vehicle_entries for each row
  execute function public.vehicle_visit_align_new_entry_presence();

-- A newly created/linked claim or order inherits the location of the exact
-- physical visit. Existing source rows are not rewritten by this trigger.
create function public.vehicle_visit_align_new_source_presence()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry public.vehicle_entries%rowtype;
begin
  if new.vehicle_entry_id is null or new.deleted_at is not null
    or new.vehicle_presence_status is distinct from 'with_customer' then return new; end if;
  select * into v_entry from public.vehicle_entries
    where id = new.vehicle_entry_id and tenant_id = new.tenant_id
      and vehicle_id = new.vehicle_id and deleted_at is null;
  if not found or v_entry.vehicle_location is distinct from 'داخل الورشة' then return new; end if;
  if tg_table_name = 'job_orders' then
    if new.status::text <> 'delivered' and new.vehicle_delivered_at is null then
      new.vehicle_presence_status := 'in_workshop';
    end if;
  elsif new.status::text not in ('cancelled','rejected')
    and new.delivered_at is null and new.vehicle_delivered_at is null then
    new.vehicle_presence_status := 'in_workshop';
  end if;
  return new;
end;
$$;

create trigger trg_vehicle_visit_align_new_order_presence
  before insert or update of vehicle_entry_id on public.job_orders
  for each row execute function public.vehicle_visit_align_new_source_presence();
create trigger trg_vehicle_visit_align_new_claim_presence
  before insert or update of vehicle_entry_id on public.insurance_claims
  for each row execute function public.vehicle_visit_align_new_source_presence();

revoke all on function public.vehicle_visit_align_new_entry_presence(),
  public.vehicle_visit_align_new_source_presence() from public, anon, authenticated;

-- Keep the existing handover transaction and electronic-signature path intact.
-- For paper handover, an authorized staff member must attest to the signed
-- original and provide recipient ID + workshop representative. The immutable
-- finalized row retains that attestation in snapshot_json and finalized_by/at.
create or replace function public.finalize_vehicle_handover(p_record_id uuid)
returns public.vehicle_handover_records
language plpgsql security definer set search_path = public as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_record public.vehicle_handover_records;
  v_year integer;
  v_sequence bigint;
  v_receipt text;
begin
  if auth.uid() is null or v_tenant is null then raise exception 'VEHICLE_HANDOVER_AUTH_REQUIRED'; end if;
  if public.get_user_role() <> all (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role
  ]) then raise exception 'VEHICLE_HANDOVER_PERMISSION_DENIED'; end if;

  select * into v_record from public.vehicle_handover_records
    where id = p_record_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VEHICLE_HANDOVER_NOT_FOUND'; end if;
  if v_record.status = 'finalized' then return v_record; end if;
  if v_record.status <> 'draft' then raise exception 'VEHICLE_HANDOVER_NOT_DRAFT'; end if;
  if nullif(trim(v_record.recipient_name), '') is null then
    raise exception 'VEHICLE_HANDOVER_RECIPIENT_REQUIRED';
  end if;
  if nullif(trim(coalesce(v_record.signature_data_url, '')), '') is null and (
    coalesce(v_record.snapshot_json->>'signatureMethod', '') <> 'paper'
    or coalesce(v_record.snapshot_json->>'paperSignatureConfirmed', '') <> 'true'
    or nullif(trim(coalesce(v_record.recipient_id_number, '')), '') is null
    or nullif(trim(coalesce(v_record.workshop_representative, '')), '') is null
  ) then raise exception 'VEHICLE_HANDOVER_PAPER_EVIDENCE_REQUIRED'; end if;

  v_year := extract(year from v_record.delivered_at at time zone 'Asia/Muscat')::integer;
  insert into public.vehicle_handover_sequences(tenant_id, sequence_year, last_number)
    values (v_tenant, v_year, 1)
    on conflict (tenant_id, sequence_year) do update
      set last_number = public.vehicle_handover_sequences.last_number + 1, updated_at = now()
    returning last_number into v_sequence;
  v_receipt := format('VH-%s-%s', v_year, lpad(v_sequence::text, 5, '0'));

  perform set_config('app.vehicle_handover_transition', 'finalize', true);
  update public.vehicle_handover_records set
    status = 'finalized', receipt_number = v_receipt,
    finalized_at = now(), finalized_by = auth.uid(), updated_at = now(), updated_by = auth.uid()
    where id = p_record_id returning * into v_record;

  update public.job_orders set
    status = 'delivered', vehicle_delivered_at = v_record.delivered_at,
    vehicle_presence_status = 'with_customer', vehicle_location_note = 'تم خروج وتسليم المركبة',
    updated_at = now()
    where id = v_record.work_order_id and tenant_id = v_tenant and deleted_at is null;

  if v_record.claim_id is not null then
    update public.insurance_claims set
      delivered_at = v_record.delivered_at, vehicle_delivered_at = v_record.delivered_at,
      vehicle_presence_status = 'with_customer', repair_stage = 'delivered',
      receiver_name = v_record.recipient_name,
      receiver_id_number = v_record.recipient_id_number,
      receiver_id_photo = v_record.receiver_id_photo_url,
      delivery_notes = v_record.satisfaction_notes,
      vehicle_location_note = 'تم خروج وتسليم المركبة', updated_at = now()
      where id = v_record.claim_id and tenant_id = v_tenant and deleted_at is null;
  end if;

  update public.claim_work_order_operations set
    vehicle_delivered_at = v_record.delivered_at,
    vehicle_presence_status = 'with_customer', operational_status = 'delivered',
    repair_stage = 'delivered', vehicle_location_note = 'تم خروج وتسليم المركبة',
    updated_at = now(), last_changed_from = 'system', last_changed_by = auth.uid()
    where tenant_id = v_tenant
      and (work_order_id = v_record.work_order_id or (v_record.claim_id is not null and claim_id = v_record.claim_id));
  return v_record;
end;
$$;

revoke all on function public.finalize_vehicle_handover(uuid) from public, anon, authenticated;
grant execute on function public.finalize_vehicle_handover(uuid) to authenticated;
