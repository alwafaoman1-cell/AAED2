-- Applied in Production as migration 20261021071925.
-- Return the printable entry snapshot only with the first successful customer
-- signature response. A replayed or already-signed link cannot obtain it.
-- Existing entry data, signatures, and numbering are not changed.
create or replace function public.submit_vehicle_entry_customer_signature(
  p_token text,
  p_signature text,
  p_signer_name text,
  p_user_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_link public.vehicle_entry_signature_links%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_existing_id uuid;
  v_signature_id uuid;
  v_receiver_signature text;
  v_damage_marks jsonb;
  v_now timestamptz := now();
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'invalid_link';
  end if;
  if nullif(trim(coalesce(p_signer_name, '')), '') is null or length(trim(p_signer_name)) > 160 then
    raise exception 'invalid_signer_name';
  end if;
  if p_signature is null
    or p_signature !~ '^data:image/png;base64,'
    or length(p_signature) > 1500000 then
    raise exception 'invalid_signature';
  end if;

  select * into v_link
  from public.vehicle_entry_signature_links
  where token = trim(p_token)
  for update;

  if not found or v_link.revoked_at is not null then
    raise exception 'invalid_link';
  end if;
  if v_link.expires_at <= v_now then
    raise exception 'expired_link';
  end if;

  select * into v_entry
  from public.vehicle_entries
  where id = v_link.vehicle_entry_id
    and tenant_id = v_link.tenant_id
    and deleted_at is null
    and status <> 'Cancelled';
  if not found then
    raise exception 'entry_unavailable';
  end if;

  select id into v_existing_id
  from public.vehicle_entry_signatures
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id
    and signature_role = 'delivered_by'
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    update public.vehicle_entry_signature_links
    set consumed_at = coalesce(consumed_at, v_now)
    where id = v_link.id;
    return jsonb_build_object('ok', true, 'already_signed', true, 'signature_id', v_existing_id);
  end if;

  insert into public.vehicle_entry_signatures (
    tenant_id,
    vehicle_entry_id,
    signature_role,
    signer_name,
    signature_data_url,
    signed_at,
    public_link_id,
    signature_source,
    consented_at,
    consent_version,
    declaration_ar_snapshot,
    declaration_en_snapshot,
    signer_user_agent
  ) values (
    v_link.tenant_id,
    v_link.vehicle_entry_id,
    'delivered_by',
    trim(p_signer_name),
    p_signature,
    v_now,
    v_link.id,
    'customer_link',
    v_now,
    'vehicle-entry-v1',
    v_entry.declaration_ar,
    v_entry.declaration_en,
    left(nullif(trim(coalesce(p_user_agent, '')), ''), 500)
  )
  returning id into v_signature_id;

  update public.vehicle_entry_signature_links
  set consumed_at = v_now
  where id = v_link.id;

  insert into public.vehicle_entry_audit_logs (
    tenant_id, vehicle_entry_id, user_id, action, new_value
  ) values (
    v_link.tenant_id,
    v_link.vehicle_entry_id,
    null,
    'vehicle_entry.customer_signature_saved',
    jsonb_build_object(
      'signature_id', v_signature_id,
      'link_id', v_link.id,
      'signed_at', v_now,
      'consent_version', 'vehicle-entry-v1'
    )
  );

  select signature_data_url into v_receiver_signature
  from public.vehicle_entry_signatures
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id
    and signature_role = 'receiver'
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'mark_number', mark_number,
    'damage_type', damage_type,
    'vehicle_part', vehicle_part,
    'description', description,
    'notes', notes,
    'x', x,
    'y', y
  ) order by mark_number), '[]'::jsonb) into v_damage_marks
  from public.vehicle_entry_damage_marks
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id;

  return jsonb_build_object(
    'ok', true,
    'signature_id', v_signature_id,
    'signed_at', v_now,
    'preview_entry', jsonb_build_object(
      'entry_number', v_entry.entry_number,
      'arrival_date', v_entry.arrival_date,
      'arrival_time', v_entry.arrival_time,
      'arrival_method', v_entry.arrival_method,
      'vehicle_location', v_entry.vehicle_location,
      'vehicle_location_bay', v_entry.vehicle_location_bay,
      'received_by_name', v_entry.received_by_name,
      'customer_snapshot', jsonb_build_object(
        'name', v_entry.customer_snapshot->>'name',
        'phone', v_entry.customer_snapshot->>'phone'
      ),
      'vehicle_snapshot', jsonb_build_object(
        'plate_number', v_entry.vehicle_snapshot->>'plate_number',
        'plate_letters', v_entry.vehicle_snapshot->>'plate_letters',
        'plate_country', v_entry.vehicle_snapshot->>'plate_country',
        'brand', v_entry.vehicle_snapshot->>'brand',
        'make', v_entry.vehicle_snapshot->>'make',
        'model', v_entry.vehicle_snapshot->>'model',
        'year', v_entry.vehicle_snapshot->>'year',
        'color', v_entry.vehicle_snapshot->>'color',
        'vin', v_entry.vehicle_snapshot->>'vin',
        'vin_number', v_entry.vehicle_snapshot->>'vin_number',
        'mileage', v_entry.vehicle_snapshot->>'mileage',
        'current_owner_name', v_entry.vehicle_snapshot->>'current_owner_name',
        'highlight_color', v_entry.vehicle_snapshot->>'highlight_color'
      ),
      'insurance_snapshot', jsonb_build_object(
        'claim_number', v_entry.insurance_snapshot->>'claim_number',
        'company_name', v_entry.insurance_snapshot->>'company_name',
        'insurance_company_name', v_entry.insurance_snapshot->>'insurance_company_name',
        'employee_name', v_entry.insurance_snapshot->>'employee_name',
        'police_report_number', v_entry.insurance_snapshot->>'police_report_number',
        'lpo_number', v_entry.insurance_snapshot->>'lpo_number'
      ),
      'delivered_by', jsonb_build_object(
        'delivery_type', v_entry.delivered_by->>'delivery_type',
        'full_name', v_entry.delivered_by->>'full_name',
        'phone', v_entry.delivered_by->>'phone',
        'id_number', v_entry.delivered_by->>'id_number',
        'towing_company', v_entry.delivered_by->>'towing_company',
        'towing_plate', v_entry.delivered_by->>'towing_plate',
        'towing_country', v_entry.delivered_by->>'towing_country'
      ),
      'vehicle_condition', v_entry.vehicle_condition,
      'vehicle_contents', v_entry.vehicle_contents,
      'damage_marks', v_damage_marks,
      'declaration_ar', v_entry.declaration_ar,
      'declaration_en', v_entry.declaration_en,
      'receiver_signature_data_url', v_receiver_signature
    )
  );
end;
$$;

revoke all on function public.submit_vehicle_entry_customer_signature(text, text, text, text) from public;
grant execute on function public.submit_vehicle_entry_customer_signature(text, text, text, text) to anon, authenticated, service_role;
