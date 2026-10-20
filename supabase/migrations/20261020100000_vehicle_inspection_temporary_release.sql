-- Vehicle inspection and temporary release: a separate, immutable acknowledgement
-- linked to an existing vehicle entry. This does not finalize a work order,
-- deliver a claim, create an invoice, or duplicate vehicle media.

create table if not exists public.vehicle_inspection_release_sequences (
  tenant_id uuid not null references public.tenants(id),
  year_value integer not null,
  current_value integer not null default 0,
  primary key (tenant_id, year_value)
);

create table if not exists public.vehicle_inspection_releases (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  vehicle_entry_id uuid not null references public.vehicle_entries(id),
  claim_id uuid null references public.insurance_claims(id),
  work_order_id uuid null references public.job_orders(id),
  release_number text not null,
  status text not null default 'draft' check (status in ('draft','awaiting_signature','signed')),
  entry_snapshot jsonb not null,
  form_data jsonb not null default '{}'::jsonb,
  photo_media_ids uuid[] not null default '{}'::uuid[],
  declaration_ar text not null,
  declaration_en text not null,
  signature_data_url text null,
  signer_name text null,
  signer_user_agent text null,
  signed_at timestamptz null,
  released_at timestamptz null,
  returned_at timestamptz null,
  returned_by uuid null,
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, release_number)
);

create index if not exists vehicle_inspection_releases_entry_idx
  on public.vehicle_inspection_releases(tenant_id, vehicle_entry_id, created_at desc);

create index if not exists vehicle_inspection_releases_claim_idx
  on public.vehicle_inspection_releases(tenant_id, claim_id, created_at desc)
  where claim_id is not null;

create table if not exists public.vehicle_inspection_release_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  release_id uuid not null references public.vehicle_inspection_releases(id),
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz null,
  revoked_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_inspection_release_links_active_idx
  on public.vehicle_inspection_release_links(tenant_id, release_id, created_at desc)
  where revoked_at is null and consumed_at is null;

alter table public.insurance_claims
  add column if not exists temporary_inspection_release_id uuid null
    references public.vehicle_inspection_releases(id);
alter table public.job_orders
  add column if not exists temporary_inspection_release_id uuid null
    references public.vehicle_inspection_releases(id);

alter table public.vehicle_inspection_release_sequences enable row level security;
alter table public.vehicle_inspection_releases enable row level security;
alter table public.vehicle_inspection_release_links enable row level security;

-- A release can only be changed through the guarded RPCs. Staff can read their
-- tenant's documents; neither staff nor anonymous clients can read link hashes.
revoke all on public.vehicle_inspection_release_sequences from public, anon, authenticated;
revoke all on public.vehicle_inspection_release_links from public, anon, authenticated;
revoke all on public.vehicle_inspection_releases from public, anon, authenticated;
grant select on public.vehicle_inspection_releases to authenticated;

create policy vehicle_inspection_releases_staff_read
on public.vehicle_inspection_releases for select to authenticated
using (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array[
    'admin'::public.app_role,'manager'::public.app_role,
    'insurance'::public.app_role,'supervisor'::public.app_role
  ])
);

create or replace function public.vehicle_inspection_release_staff_tenant()
returns uuid language plpgsql stable security definer
set search_path = public
as $$
declare v_tenant uuid; v_role public.app_role;
begin
  v_tenant := public.get_user_tenant_id();
  v_role := public.get_user_role();
  if auth.uid() is null or v_tenant is null or v_role is null or v_role <> all (array[
    'admin'::public.app_role,'manager'::public.app_role,
    'insurance'::public.app_role,'supervisor'::public.app_role
  ]) then
    raise exception 'inspection_release_not_authorized';
  end if;
  return v_tenant;
end;
$$;

create or replace function public.save_vehicle_inspection_release(
  p_vehicle_entry_id uuid,
  p_form jsonb
)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.vehicle_inspection_release_staff_tenant();
  v_entry public.vehicle_entries%rowtype;
  v_release public.vehicle_inspection_releases%rowtype;
  v_form jsonb;
  v_snapshot jsonb;
  v_photos uuid[];
  v_next integer;
  v_create_new boolean := false;
  v_year integer := extract(year from current_date)::integer;
  v_ar text := 'أقر بأنني عاينت المركبة واستلمتها مؤقتًا بالحالة والمحتويات المبينة في هذا المحضر لحين صدور الإجراء أو الموافقة المطلوبة. هذا المحضر يوثق حالة المركبة عند خروجها المؤقت، ولا يعد إصلاحًا مكتملًا أو تسليمًا نهائيًا أو موافقة على تكاليف الإصلاح. تعاد المركبة للورشة عند الاتفاق على استكمال الإجراء. يثبت التوقيع استلام المركبة والمحتويات المذكورة فقط، ولا يلغي أي التزامات ثابتة بموجب النظام.';
  v_en text := 'I inspected and temporarily received the vehicle in the condition and with the contents recorded in this report pending the required decision or approval. This report documents its condition at temporary release; it is not a completed repair, final delivery, or approval of repair charges. The vehicle will return to the workshop when further work is agreed. The signature acknowledges receipt of the vehicle and listed contents only and does not waive any obligations imposed by law.';
begin
  if p_form is null or jsonb_typeof(p_form) <> 'object' then
    raise exception 'invalid_inspection_form';
  end if;
  select * into v_entry from public.vehicle_entries
  where id = p_vehicle_entry_id and tenant_id = v_tenant and deleted_at is null
  for update;
  if not found then raise exception 'vehicle_entry_not_found'; end if;
  if v_entry.status not in ('Received','Issued','Converted to Claim','Converted to Work Order') then
    raise exception 'vehicle_entry_must_be_saved_first';
  end if;

  select * into v_release from public.vehicle_inspection_releases
  where tenant_id = v_tenant and vehicle_entry_id = v_entry.id
  order by created_at desc limit 1 for update;
  if not found then
    v_create_new := true;
  elsif v_release.status = 'signed' and v_release.returned_at is not null then
    v_create_new := true;
  elsif v_release.status = 'signed' then
    raise exception 'vehicle_has_not_returned';
  elsif v_release.status <> 'draft' then
    raise exception 'inspection_release_locked';
  end if;

  -- Only a documented set of editable fields is persisted. No client-supplied
  -- claim, vehicle, tenant, photos, number, or declaration is accepted.
  v_form := jsonb_build_object(
    'inspection_summary', left(trim(coalesce(p_form->>'inspection_summary','')), 2000),
    'inspected_items', left(trim(coalesce(p_form->>'inspected_items','')), 2000),
    'uninspected_items', left(trim(coalesce(p_form->>'uninspected_items','')), 2000),
    'visible_damage', left(trim(coalesce(p_form->>'visible_damage','')), 2000),
    'pending_action', left(trim(coalesce(p_form->>'pending_action','')), 1000),
    'exit_condition', left(trim(coalesce(p_form->>'exit_condition','')), 1000),
    'contents_handed_over', left(trim(coalesce(p_form->>'contents_handed_over','')), 1000),
    'keys_handed_over', left(trim(coalesce(p_form->>'keys_handed_over','')), 100),
    'recipient_name', left(trim(coalesce(p_form->>'recipient_name','')), 160),
    'recipient_id_number', left(trim(coalesce(p_form->>'recipient_id_number','')), 80),
    'recipient_phone', left(trim(coalesce(p_form->>'recipient_phone','')), 80),
    'recipient_relation', left(trim(coalesce(p_form->>'recipient_relation','')), 80),
    'staff_name', left(trim(coalesce(p_form->>'staff_name','')), 160),
    'notes', left(trim(coalesce(p_form->>'notes','')), 1500)
  );

  select jsonb_build_object(
    'entry_number', v_entry.entry_number,
    'arrival_date', v_entry.arrival_date,
    'arrival_time', v_entry.arrival_time,
    'customer', jsonb_build_object(
      'name', v_entry.customer_snapshot->>'name',
      'phone', v_entry.customer_snapshot->>'phone'
    ),
    'vehicle', jsonb_build_object(
      'plate_number', v_entry.vehicle_snapshot->>'plate_number',
      'plate_letters', v_entry.vehicle_snapshot->>'plate_letters',
      'make', coalesce(v_entry.vehicle_snapshot->>'make', v_entry.vehicle_snapshot->>'brand'),
      'model', v_entry.vehicle_snapshot->>'model',
      'year', v_entry.vehicle_snapshot->>'year',
      'vin', coalesce(v_entry.vehicle_snapshot->>'vin', v_entry.vehicle_snapshot->>'vin_number')
    ),
    'insurance', jsonb_build_object(
      'claim_number', v_entry.insurance_snapshot->>'claim_number',
      'company_name', v_entry.insurance_snapshot->>'company_name'
    ),
    'condition', jsonb_build_object(
      'condition_description', v_entry.vehicle_condition->>'condition_description',
      'visible_damage', v_entry.vehicle_condition->>'visible_damage'
    ),
    'contents', jsonb_build_object(
      'keys_count', v_entry.vehicle_contents->>'keys_count',
      'notes', v_entry.vehicle_contents->>'notes'
    ),
    'damage_marks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'mark_number', m.mark_number, 'damage_type', m.damage_type,
        'vehicle_part', m.vehicle_part, 'description', m.description,
        'notes', m.notes, 'x', m.x, 'y', m.y
      ) order by m.mark_number)
      from public.vehicle_entry_damage_marks m
      where m.tenant_id = v_tenant and m.vehicle_entry_id = v_entry.id
    ), '[]'::jsonb)
  ) into v_snapshot;

  select coalesce(array_agg(m.id order by m.uploaded_at), '{}'::uuid[])
  into v_photos from (
    select id, uploaded_at from public.vehicle_media
    where tenant_id = v_tenant and vehicle_entry_id = v_entry.id
      and media_type = 'image' and deleted_at is null
    order by uploaded_at limit 12
  ) m;

  if v_create_new then
    insert into public.vehicle_inspection_release_sequences (tenant_id, year_value, current_value)
    values (v_tenant, v_year, 1)
    on conflict (tenant_id, year_value)
    do update set current_value = public.vehicle_inspection_release_sequences.current_value + 1
    returning current_value into v_next;

    insert into public.vehicle_inspection_releases (
      tenant_id, vehicle_entry_id, claim_id, work_order_id, release_number,
      entry_snapshot, form_data, photo_media_ids, declaration_ar, declaration_en,
      created_by, updated_by
    ) values (
      v_tenant, v_entry.id,
      coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id),
      coalesce(v_entry.work_order_id, v_entry.converted_work_order_id),
      'VIR-' || v_year::text || '-' || lpad(v_next::text, 4, '0'),
      v_snapshot, v_form, v_photos, v_ar, v_en, auth.uid(), auth.uid()
    ) returning * into v_release;
  else
    update public.vehicle_inspection_releases set
      claim_id = coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id),
      work_order_id = coalesce(v_entry.work_order_id, v_entry.converted_work_order_id),
      entry_snapshot = v_snapshot, form_data = v_form, photo_media_ids = v_photos,
      updated_at = now(), updated_by = auth.uid()
    where id = v_release.id returning * into v_release;
  end if;

  insert into public.vehicle_entry_audit_logs
    (tenant_id, vehicle_entry_id, user_id, action, new_value)
  values (v_tenant, v_entry.id, auth.uid(), 'vehicle_inspection_release.saved',
    jsonb_build_object('release_id', v_release.id, 'release_number', v_release.release_number));
  return to_jsonb(v_release);
end;
$$;

create or replace function public.create_vehicle_inspection_release_link(
  p_release_id uuid,
  p_expires_hours integer default 168
)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid := public.vehicle_inspection_release_staff_tenant();
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_token text;
  v_expiry timestamptz;
begin
  select * into v_release from public.vehicle_inspection_releases
  where id = p_release_id and tenant_id = v_tenant;
  if not found then raise exception 'inspection_release_not_found'; end if;
  select * into v_entry from public.vehicle_entries
  where id = v_release.vehicle_entry_id and tenant_id = v_tenant
    and deleted_at is null
    and status in ('Received','Issued','Converted to Claim','Converted to Work Order')
    for update;
  if not found then raise exception 'vehicle_entry_unavailable'; end if;
  select * into v_release from public.vehicle_inspection_releases
  where id = p_release_id and tenant_id = v_tenant for update;
  if not found then raise exception 'inspection_release_not_found'; end if;
  if v_release.status = 'signed' then raise exception 'inspection_release_already_signed'; end if;
  if v_release.claim_id is not null and not exists (
    select 1 from public.insurance_claims c
    where c.id = v_release.claim_id and c.tenant_id = v_tenant
      and c.deleted_at is null and c.status not in ('paid','cancelled','rejected')
      and c.delivered_at is null
      and (v_entry.vehicle_id is null or c.vehicle_id = v_entry.vehicle_id)
  ) then raise exception 'linked_claim_not_active'; end if;
  if v_release.work_order_id is not null and not exists (
    select 1 from public.job_orders j
    where j.id = v_release.work_order_id and j.tenant_id = v_tenant
      and j.deleted_at is null and j.vehicle_delivered_at is null
      and lower(trim(coalesce(j.status::text,''))) not in
        ('delivered','cancelled','canceled','تم التسليم','ملغى','ملغي')
      and (v_entry.vehicle_id is null or j.vehicle_id = v_entry.vehicle_id)
  ) then raise exception 'linked_work_order_not_active'; end if;
  if nullif(v_release.form_data->>'inspection_summary','') is null
    or nullif(v_release.form_data->>'pending_action','') is null
    or nullif(v_release.form_data->>'exit_condition','') is null
    or nullif(v_release.form_data->>'recipient_name','') is null
    or nullif(v_release.form_data->>'recipient_id_number','') is null
    or nullif(v_release.form_data->>'recipient_phone','') is null then
    raise exception 'inspection_release_required_fields_missing';
  end if;

  update public.vehicle_inspection_release_links set revoked_at = now()
  where tenant_id = v_tenant and release_id = v_release.id
    and revoked_at is null and consumed_at is null;
  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expiry := now() + make_interval(hours => greatest(1, least(coalesce(p_expires_hours,168),720)));
  insert into public.vehicle_inspection_release_links
    (tenant_id, release_id, token_hash, expires_at, created_by)
  values (v_tenant, v_release.id, encode(extensions.digest(v_token, 'sha256'), 'hex'),
    v_expiry, auth.uid());
  update public.vehicle_inspection_releases set status = 'awaiting_signature',
    updated_at = now(), updated_by = auth.uid()
  where id = v_release.id;
  insert into public.vehicle_entry_audit_logs
    (tenant_id, vehicle_entry_id, user_id, action, new_value)
  values (v_tenant, v_release.vehicle_entry_id, auth.uid(),
    'vehicle_inspection_release.link_created',
    jsonb_build_object('release_id', v_release.id, 'expires_at', v_expiry));
  return jsonb_build_object('token', v_token, 'release_id', v_release.id,
    'expires_at', v_expiry);
end;
$$;

create or replace function public.reopen_vehicle_inspection_release(p_release_id uuid)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.vehicle_inspection_release_staff_tenant();
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
begin
  select * into v_release from public.vehicle_inspection_releases
  where id = p_release_id and tenant_id = v_tenant;
  if not found then raise exception 'inspection_release_not_found'; end if;
  select * into v_entry from public.vehicle_entries
  where id = v_release.vehicle_entry_id and tenant_id = v_tenant for update;
  if not found then raise exception 'vehicle_entry_unavailable'; end if;
  select * into v_release from public.vehicle_inspection_releases
  where id = p_release_id and tenant_id = v_tenant for update;
  if not found then raise exception 'inspection_release_not_found'; end if;
  if v_release.status = 'signed' then raise exception 'inspection_release_already_signed'; end if;
  update public.vehicle_inspection_release_links set revoked_at = now()
  where tenant_id = v_tenant and release_id = v_release.id
    and revoked_at is null and consumed_at is null;
  update public.vehicle_inspection_releases set status = 'draft',
    updated_at = now(), updated_by = auth.uid()
  where id = v_release.id returning * into v_release;
  insert into public.vehicle_entry_audit_logs
    (tenant_id, vehicle_entry_id, user_id, action)
  values (v_tenant, v_release.vehicle_entry_id, auth.uid(),
    'vehicle_inspection_release.reopened');
  return to_jsonb(v_release);
end;
$$;

create or replace function public.get_vehicle_inspection_release_for_signature(p_token text)
returns jsonb language plpgsql stable security definer
set search_path = public, extensions
as $$
declare
  v_link public.vehicle_inspection_release_links%rowtype;
  v_release public.vehicle_inspection_releases%rowtype;
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','invalid_link');
  end if;
  select * into v_link from public.vehicle_inspection_release_links
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    and revoked_at is null limit 1;
  if not found then return jsonb_build_object('error','invalid_link'); end if;
  if v_link.expires_at <= now() then return jsonb_build_object('error','expired_link'); end if;
  select * into v_release from public.vehicle_inspection_releases
  where id = v_link.release_id and tenant_id = v_link.tenant_id;
  if not found or v_release.status not in ('awaiting_signature','signed') then
    return jsonb_build_object('error','release_unavailable');
  end if;
  if not exists (
    select 1 from public.vehicle_entries
    where id = v_release.vehicle_entry_id and tenant_id = v_link.tenant_id
      and deleted_at is null
      and status in ('Received','Issued','Converted to Claim','Converted to Work Order')
  ) then return jsonb_build_object('error','entry_unavailable'); end if;
  return jsonb_build_object(
    'release_number', v_release.release_number,
    'entry_snapshot', v_release.entry_snapshot,
    'form_data', v_release.form_data,
    'declaration_ar', v_release.declaration_ar,
    'declaration_en', v_release.declaration_en,
    'signed', v_release.status = 'signed',
    'signer_name', v_release.signer_name,
    'signed_at', v_release.signed_at,
    'expires_at', v_link.expires_at
  );
end;
$$;

create or replace function public.mark_vehicle_inspection_return(p_release_id uuid)
returns jsonb language plpgsql security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.vehicle_inspection_release_staff_tenant();
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
  v_now timestamptz := now();
begin
  select * into v_release from public.vehicle_inspection_releases
  where id = p_release_id and tenant_id = v_tenant;
  if not found then raise exception 'inspection_release_not_found'; end if;
  if v_release.returned_at is not null then return to_jsonb(v_release); end if;
  select * into v_entry from public.vehicle_entries
  where id = v_release.vehicle_entry_id and tenant_id = v_tenant
    and deleted_at is null for update;
  if not found or v_entry.vehicle_location is distinct from 'مع العميل' then
    raise exception 'vehicle_entry_location_changed';
  end if;
  select * into v_release from public.vehicle_inspection_releases
  where id = p_release_id and tenant_id = v_tenant for update;
  if not found then raise exception 'inspection_release_not_found'; end if;
  if v_release.status <> 'signed' then raise exception 'inspection_release_not_signed'; end if;
  if v_release.returned_at is not null then return to_jsonb(v_release); end if;
  if v_release.claim_id is not null then
    select * into v_claim from public.insurance_claims
    where id = v_release.claim_id and tenant_id = v_tenant
      and deleted_at is null for update;
    if not found or v_claim.status in ('paid','cancelled','rejected')
      or v_claim.delivered_at is not null
      or v_claim.temporary_inspection_release_id is distinct from v_release.id
      or v_claim.vehicle_presence_status is distinct from 'with_customer' then
      raise exception 'linked_claim_not_active';
    end if;
  end if;
  if v_release.work_order_id is not null then
    select * into v_order from public.job_orders
    where id = v_release.work_order_id and tenant_id = v_tenant
      and deleted_at is null for update;
    if not found or lower(trim(coalesce(v_order.status::text,''))) in
      ('delivered','cancelled','canceled','تم التسليم','ملغى','ملغي')
      or v_order.vehicle_delivered_at is not null
      or v_order.temporary_inspection_release_id is distinct from v_release.id
      or v_order.vehicle_presence_status is distinct from 'with_customer' then
      raise exception 'linked_work_order_not_active';
    end if;
  end if;
  update public.vehicle_inspection_releases set returned_at = v_now,
    returned_by = auth.uid(), updated_at = v_now
  where id = v_release.id returning * into v_release;
  update public.vehicle_entries set vehicle_location = 'داخل الورشة',
    updated_at = v_now
  where id = v_release.vehicle_entry_id and tenant_id = v_tenant;
  if v_release.claim_id is not null then
    update public.insurance_claims set
      vehicle_presence_status = 'in_workshop',
      vehicle_location_note = 'Returned after temporary inspection release ' || v_release.release_number,
      vehicle_location_updated_at = v_now, vehicle_location_updated_by = auth.uid(),
      updated_at = v_now
    where id = v_release.claim_id and tenant_id = v_tenant;
  end if;
  if v_release.work_order_id is not null then
    update public.job_orders set
      vehicle_presence_status = 'in_workshop',
      vehicle_location_note = 'Returned after temporary inspection release ' || v_release.release_number,
      updated_at = v_now
    where id = v_release.work_order_id and tenant_id = v_tenant;
  end if;
  update public.claim_work_order_operations set
    vehicle_presence_status = 'in_workshop',
    vehicle_location_note = 'Returned after temporary inspection release ' || v_release.release_number,
    vehicle_location_updated_at = v_now, vehicle_location_updated_by = auth.uid(),
    updated_at = v_now, last_changed_from = 'system', last_changed_by = auth.uid()
  where tenant_id = v_tenant
    and ((v_release.claim_id is not null and claim_id = v_release.claim_id)
      or (v_release.work_order_id is not null and work_order_id = v_release.work_order_id));
  insert into public.vehicle_entry_audit_logs
    (tenant_id, vehicle_entry_id, user_id, action, new_value)
  values (v_tenant, v_release.vehicle_entry_id, auth.uid(),
    'vehicle_inspection_release.vehicle_returned',
    jsonb_build_object('release_id',v_release.id,'returned_at',v_now));
  return to_jsonb(v_release);
end;
$$;

create or replace function public.submit_vehicle_inspection_release_signature(
  p_token text,
  p_signature text,
  p_signer_name text,
  p_user_agent text default null
)
returns jsonb language plpgsql security definer
set search_path = public, extensions
as $$
declare
  v_link public.vehicle_inspection_release_links%rowtype;
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
  v_now timestamptz := now();
begin
  if p_token is null or p_token !~ '^[a-f0-9]{64}$' then raise exception 'invalid_link'; end if;
  if nullif(trim(coalesce(p_signer_name,'')),'') is null or length(trim(p_signer_name)) > 160 then
    raise exception 'invalid_signer_name';
  end if;
  if p_signature is null or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$'
    or length(p_signature) > 1500000 then raise exception 'invalid_signature'; end if;
  -- Read the link first, then acquire locks in the same entry -> release ->
  -- link order as staff saves. Revalidate the link after locking so a
  -- concurrent revoke cannot authorize a stale signature.
  select * into v_link from public.vehicle_inspection_release_links
  where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex');
  if not found then raise exception 'invalid_link'; end if;
  select * into v_release from public.vehicle_inspection_releases
  where id = v_link.release_id and tenant_id = v_link.tenant_id;
  if not found then raise exception 'release_unavailable'; end if;
  select * into v_entry from public.vehicle_entries
  where id = v_release.vehicle_entry_id and tenant_id = v_link.tenant_id
    and deleted_at is null
    and status in ('Received','Issued','Converted to Claim','Converted to Work Order')
    for update;
  if not found then raise exception 'entry_unavailable'; end if;
  select * into v_release from public.vehicle_inspection_releases
  where id = v_link.release_id and tenant_id = v_link.tenant_id for update;
  if not found then raise exception 'release_unavailable'; end if;
  select * into v_link from public.vehicle_inspection_release_links
  where id = v_link.id and token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex')
    for update;
  if not found or v_link.revoked_at is not null then raise exception 'invalid_link'; end if;
  if v_link.expires_at <= clock_timestamp() then raise exception 'expired_link'; end if;
  if v_release.status = 'signed' then
    return jsonb_build_object('ok',true,'already_signed',true,'signed_at',v_release.signed_at);
  end if;
  if v_release.status <> 'awaiting_signature' or v_link.consumed_at is not null then
    raise exception 'release_unavailable';
  end if;
  v_now := clock_timestamp();
  if lower(trim(p_signer_name)) <> lower(trim(v_release.form_data->>'recipient_name')) then
    raise exception 'signer_must_match_named_recipient';
  end if;
  -- Validate every linked operational record before any write. A temporary
  -- handover must never reopen a delivered/cancelled record or affect money.
  if v_release.claim_id is not null then
    select * into v_claim from public.insurance_claims
    where id = v_release.claim_id and tenant_id = v_link.tenant_id
      and deleted_at is null for update;
    if not found or v_claim.status in ('paid','cancelled','rejected')
      or v_claim.delivered_at is not null
      or (v_entry.vehicle_id is not null and v_claim.vehicle_id is distinct from v_entry.vehicle_id) then
      raise exception 'linked_claim_not_active';
    end if;
  end if;
  if v_release.work_order_id is not null then
    select * into v_order from public.job_orders
    where id = v_release.work_order_id and tenant_id = v_link.tenant_id
      and deleted_at is null for update;
    if not found or lower(trim(coalesce(v_order.status::text,''))) in
      ('delivered','cancelled','canceled','تم التسليم','ملغى','ملغي')
      or v_order.vehicle_delivered_at is not null
      or (v_entry.vehicle_id is not null and v_order.vehicle_id is distinct from v_entry.vehicle_id) then
      raise exception 'linked_work_order_not_active';
    end if;
  end if;

  update public.vehicle_inspection_releases set
    status = 'signed', signature_data_url = p_signature,
    signer_name = trim(p_signer_name),
    signer_user_agent = left(nullif(trim(coalesce(p_user_agent,'')),''),500),
    signed_at = v_now, released_at = v_now, updated_at = v_now
  where id = v_release.id;
  update public.vehicle_inspection_release_links set consumed_at = v_now
  where id = v_link.id;
  update public.vehicle_entries set vehicle_location = 'مع العميل',
    vehicle_location_bay = null, updated_at = v_now
  where id = v_release.vehicle_entry_id and tenant_id = v_link.tenant_id;

  if v_release.claim_id is not null then
    update public.insurance_claims set
      vehicle_presence_status = 'with_customer',
      vehicle_location_section = null, vehicle_location_bay = null,
      vehicle_location_note = 'Temporary inspection release ' || v_release.release_number,
      vehicle_location_updated_at = v_now,
      temporary_inspection_release_id = v_release.id,
      updated_at = v_now
    where id = v_release.claim_id and tenant_id = v_link.tenant_id;
  end if;
  if v_release.work_order_id is not null then
    update public.job_orders set
      vehicle_presence_status = 'with_customer',
      vehicle_location_section = null, vehicle_location_bay = null,
      vehicle_location_note = 'Temporary inspection release ' || v_release.release_number,
      temporary_inspection_release_id = v_release.id,
      updated_at = v_now
    where id = v_release.work_order_id and tenant_id = v_link.tenant_id;
  end if;
  update public.claim_work_order_operations set
    vehicle_presence_status = 'with_customer',
    vehicle_location_section = null, vehicle_location_bay = null,
    vehicle_location_note = 'Temporary inspection release ' || v_release.release_number,
    vehicle_location_updated_at = v_now,
    updated_at = v_now, last_changed_from = 'system'
  where tenant_id = v_link.tenant_id
    and ((v_release.claim_id is not null and claim_id = v_release.claim_id)
      or (v_release.work_order_id is not null and work_order_id = v_release.work_order_id));

  insert into public.vehicle_entry_audit_logs
    (tenant_id, vehicle_entry_id, user_id, action, new_value)
  values (v_link.tenant_id, v_release.vehicle_entry_id, null,
    'vehicle_inspection_release.customer_signed',
    jsonb_build_object('release_id',v_release.id,'signed_at',v_now,
      'signer_name',trim(p_signer_name)));
  return jsonb_build_object('ok',true,'signed_at',v_now,'release_number',v_release.release_number);
end;
$$;

-- The signed report references existing media IDs. Prevent silently removing
-- those shared photos; it never creates a second Storage object.
create or replace function public.protect_signed_inspection_media()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.vehicle_inspection_releases r
    where r.tenant_id = old.tenant_id
      and r.status in ('awaiting_signature','signed')
      and old.id = any(r.photo_media_ids)
  ) then
    if tg_op = 'DELETE' then
      raise exception 'photo_is_part_of_inspection_release';
    end if;
    if new.deleted_at is distinct from old.deleted_at
      or new.storage_path is distinct from old.storage_path
      or new.storage_bucket is distinct from old.storage_bucket then
      raise exception 'photo_is_part_of_inspection_release';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_signed_inspection_media_update
before update of deleted_at, storage_path, storage_bucket on public.vehicle_media
for each row execute function public.protect_signed_inspection_media();
create trigger protect_signed_inspection_media_delete
before delete on public.vehicle_media
for each row execute function public.protect_signed_inspection_media();

create or replace function public.protect_signed_inspection_entry()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if exists (
    select 1 from public.vehicle_inspection_releases r
    where r.tenant_id = old.tenant_id and r.vehicle_entry_id = old.id
      and r.status = 'signed'
  ) then
    if tg_op = 'DELETE' then raise exception 'signed_inspection_entry_cannot_be_deleted'; end if;
    if new.deleted_at is distinct from old.deleted_at
      and new.deleted_at is not null then
      raise exception 'signed_inspection_entry_cannot_be_deleted';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create trigger protect_signed_inspection_entry_update
before update of deleted_at on public.vehicle_entries
for each row execute function public.protect_signed_inspection_entry();
create trigger protect_signed_inspection_entry_delete
before delete on public.vehicle_entries
for each row execute function public.protect_signed_inspection_entry();

-- Keep server-side claim delivery filters consistent with temporary release.
-- This is the existing paginated list contract with one additional branch;
-- the historical workshop_arrival_date remains unchanged.
create or replace function public.insurance_claims_list_rpc(
  p_tenant_id uuid,
  p_page integer default 1,
  p_page_size integer default 20,
  p_search text default '',
  p_status text default 'all',
  p_company text default 'all',
  p_employee_id uuid default null,
  p_date_range text default 'all',
  p_delivery text default 'all',
  p_sort_by text default 'created_at',
  p_sort_dir text default 'desc'
)
returns jsonb language sql stable security invoker
set search_path = public, pg_temp
as $$
with authorized as materialized (
  select p_tenant_id as tenant_id
  where auth.uid() is not null and p_tenant_id = public.get_user_tenant_id()
),
base as materialized (
  select
    c.*,
    cu.name as list_customer_name,
    cu.phone as list_customer_phone,
    v.brand as list_vehicle_brand,
    v.model as list_vehicle_model,
    v.plate_number as list_vehicle_plate_number,
    v.plate_letters as list_vehicle_plate_letters,
    v.plate_country as list_vehicle_plate_country,
    v.year as list_vehicle_year,
    v.vin_number as list_vehicle_vin,
    v.vehicle_cover_image_url as list_vehicle_cover_image_url,
    v.vehicle_thumbnail_url as list_vehicle_thumbnail_url,
    jo.order_number as list_order_number,
    jo.status::text as list_order_status,
    case
      when c.status::text = 'paid' then 'paid_archive'
      when c.status::text in ('cancelled','rejected') then 'cancelled'
      when c.delivered_at is not null then 'delivered'
      when c.temporary_inspection_release_id is not null
        and c.vehicle_presence_status = 'with_customer' then 'with_customer'
      when c.workshop_arrival_date is not null then 'in_workshop'
      else 'with_customer'
    end as list_vehicle_location,
    greatest(0, floor(extract(epoch from (
      coalesce(c.delivered_at, now()) - coalesce(c.workshop_arrival_date, c.created_at)
    )) / 86400))::integer as list_duration_days
  from public.insurance_claims c
  join authorized a on a.tenant_id = c.tenant_id
  left join public.customers cu on cu.id = c.customer_id and cu.tenant_id = c.tenant_id
  left join public.vehicles v on v.id = c.vehicle_id and v.tenant_id = c.tenant_id
  left join public.job_orders jo on jo.id = c.job_order_id and jo.tenant_id = c.tenant_id
  where c.deleted_at is null
),
filtered as materialized (
  select * from base b
  where (coalesce(nullif(p_status,''),'all') = 'all' or b.status::text = p_status)
    and (coalesce(nullif(p_company,''),'all') = 'all' or b.insurance_company = p_company)
    and (p_employee_id is null or b.insurance_employee_id = p_employee_id)
    and (
      coalesce(nullif(p_delivery,''),'all') = 'all'
      or (p_delivery = 'active' and b.list_vehicle_location not in ('paid_archive','cancelled'))
      or b.list_vehicle_location = p_delivery
    )
    and (
      coalesce(nullif(p_date_range,''),'all') = 'all'
      or (p_date_range = '7d' and b.created_at >= now() - interval '7 days')
      or (p_date_range = '30d' and b.created_at >= now() - interval '30 days')
      or (p_date_range = '90d' and b.created_at >= now() - interval '90 days')
    )
    and (
      nullif(trim(coalesce(p_search,'')),'') is null
      or concat_ws(' ', b.claim_number, b.insurance_company, b.list_customer_name,
        b.vehicle_plate, b.vehicle_make, b.vehicle_model,
        b.list_vehicle_plate_number, b.list_vehicle_plate_letters,
        b.list_vehicle_brand, b.list_vehicle_model)
        ilike '%' || trim(p_search) || '%'
    )
),
paged as materialized (
  select * from filtered
  order by
    case when p_sort_by = 'number' and p_sort_dir = 'asc' then claim_number end asc,
    case when p_sort_by = 'number' and p_sort_dir <> 'asc' then claim_number end desc,
    case when p_sort_by = 'customer' and p_sort_dir = 'asc' then list_customer_name end asc nulls last,
    case when p_sort_by = 'customer' and p_sort_dir <> 'asc' then list_customer_name end desc nulls last,
    case when p_sort_by = 'estimate_date' and p_sort_dir = 'asc' then coalesce(estimate_date, created_at) end asc,
    case when p_sort_by = 'estimate_date' and p_sort_dir <> 'asc' then coalesce(estimate_date, created_at) end desc,
    case when p_sort_by = 'payment_status' and p_sort_dir = 'asc' then (status::text = 'paid')::integer end asc,
    case when p_sort_by = 'payment_status' and p_sort_dir <> 'asc' then (status::text = 'paid')::integer end desc,
    case when p_sort_by = 'duration' and p_sort_dir = 'asc' then list_duration_days end asc,
    case when p_sort_by = 'duration' and p_sort_dir <> 'asc' then list_duration_days end desc,
    case when coalesce(nullif(p_sort_by,''),'created_at') = 'created_at' and p_sort_dir = 'asc' then created_at end asc,
    case when coalesce(nullif(p_sort_by,''),'created_at') = 'created_at' and p_sort_dir <> 'asc' then created_at end desc,
    created_at desc, id desc
  offset greatest(coalesce(p_page,1) - 1,0) * least(greatest(coalesce(p_page_size,20),1),100)
  limit least(greatest(coalesce(p_page_size,20),1),100)
),
page_rows as (
  select
    to_jsonb(p)
      - 'list_customer_name' - 'list_customer_phone'
      - 'list_vehicle_brand' - 'list_vehicle_model'
      - 'list_vehicle_plate_number' - 'list_vehicle_plate_letters'
      - 'list_vehicle_plate_country' - 'list_vehicle_year'
      - 'list_vehicle_vin' - 'list_vehicle_cover_image_url'
      - 'list_vehicle_thumbnail_url' - 'list_order_number'
      - 'list_order_status' - 'list_vehicle_location' - 'list_duration_days'
      || jsonb_build_object(
        'customer', jsonb_build_object('name',p.list_customer_name,'phone',p.list_customer_phone),
        'vehicle', jsonb_build_object(
          'brand',p.list_vehicle_brand,'model',p.list_vehicle_model,
          'plate_number',p.list_vehicle_plate_number,'plate_letters',p.list_vehicle_plate_letters,
          'plate_country',p.list_vehicle_plate_country,'year',p.list_vehicle_year,
          'vin_number',p.list_vehicle_vin,'vehicle_cover_image_url',p.list_vehicle_cover_image_url,
          'vehicle_thumbnail_url',p.list_vehicle_thumbnail_url
        ),
        'job_order', jsonb_build_object('order_number',p.list_order_number,'status',p.list_order_status)
      ) as row_json
  from paged p
),
summary as (
  select count(*)::bigint as total, coalesce(sum(estimated_amount),0)::numeric as estimated_total
  from filtered
),
companies as (
  select coalesce(jsonb_agg(insurance_company order by insurance_company),'[]'::jsonb) as items
  from (select distinct insurance_company from base where nullif(trim(insurance_company),'') is not null) names
)
select jsonb_build_object(
  'rows', coalesce((select jsonb_agg(row_json) from page_rows),'[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', greatest(coalesce(p_page,1),1),
    'pageSize', least(greatest(coalesce(p_page_size,20),1),100),
    'totalRows', (select count(*) from filtered),
    'totalPages', case when (select count(*) from filtered) = 0 then 0
      else ceil((select count(*) from filtered)::numeric /
        least(greatest(coalesce(p_page_size,20),1),100))::integer end
  ),
  'summary', (select to_jsonb(summary) from summary),
  'filterOptions', jsonb_build_object('companies',(select items from companies))
);
$$;

revoke all on function public.vehicle_inspection_release_staff_tenant() from public, anon, authenticated;
revoke all on function public.save_vehicle_inspection_release(uuid,jsonb) from public, anon;
grant execute on function public.save_vehicle_inspection_release(uuid,jsonb) to authenticated;
revoke all on function public.create_vehicle_inspection_release_link(uuid,integer) from public, anon;
grant execute on function public.create_vehicle_inspection_release_link(uuid,integer) to authenticated;
revoke all on function public.reopen_vehicle_inspection_release(uuid) from public, anon;
grant execute on function public.reopen_vehicle_inspection_release(uuid) to authenticated;
revoke all on function public.mark_vehicle_inspection_return(uuid) from public, anon;
grant execute on function public.mark_vehicle_inspection_return(uuid) to authenticated;
revoke all on function public.get_vehicle_inspection_release_for_signature(text) from public;
grant execute on function public.get_vehicle_inspection_release_for_signature(text) to anon, authenticated;
revoke all on function public.submit_vehicle_inspection_release_signature(text,text,text,text) from public;
grant execute on function public.submit_vehicle_inspection_release_signature(text,text,text,text) to anon, authenticated;
