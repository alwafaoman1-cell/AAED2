-- Secure, one-time customer signature links for Vehicle Entry & Receipt.
-- Non-destructive: existing entries and signatures are preserved.

create table if not exists public.vehicle_entry_signature_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_entry_id uuid not null references public.vehicle_entries(id) on delete cascade,
  token text not null default encode(extensions.gen_random_bytes(32), 'hex'),
  expires_at timestamptz not null default (now() + interval '7 days'),
  consumed_at timestamptz null,
  revoked_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  constraint vehicle_entry_signature_links_token_unique unique (token)
);

create index if not exists vehicle_entry_signature_links_entry_idx
  on public.vehicle_entry_signature_links(tenant_id, vehicle_entry_id, created_at desc);

create index if not exists vehicle_entry_signature_links_active_idx
  on public.vehicle_entry_signature_links(token)
  where revoked_at is null and consumed_at is null;

alter table public.vehicle_entry_signature_links enable row level security;

drop policy if exists "Staff manage vehicle entry signature links" on public.vehicle_entry_signature_links;
create policy "Staff manage vehicle entry signature links"
on public.vehicle_entry_signature_links for all
using (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,
    'supervisor'::app_role,'technician'::app_role
  ])
)
with check (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,
    'supervisor'::app_role,'technician'::app_role
  ])
);

alter table public.vehicle_entry_signatures
  add column if not exists public_link_id uuid null references public.vehicle_entry_signature_links(id) on delete set null,
  add column if not exists signature_source text not null default 'staff',
  add column if not exists consented_at timestamptz null,
  add column if not exists consent_version text null,
  add column if not exists declaration_ar_snapshot text null,
  add column if not exists declaration_en_snapshot text null,
  add column if not exists signer_user_agent text null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.vehicle_entry_signatures'::regclass
      and conname = 'vehicle_entry_signatures_source_check'
  ) then
    alter table public.vehicle_entry_signatures
      add constraint vehicle_entry_signatures_source_check
      check (signature_source in ('staff','customer_link','override'));
  end if;
end;
$$;

create or replace function public.create_vehicle_entry_signature_link(
  p_vehicle_entry_id uuid,
  p_expires_hours integer default 168
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_tenant uuid;
  v_role public.app_role;
  v_entry public.vehicle_entries%rowtype;
  v_link public.vehicle_entry_signature_links%rowtype;
begin
  v_tenant := public.get_user_tenant_id();
  v_role := public.get_user_role();

  if auth.uid() is null or v_tenant is null or v_role is null or v_role <> all (array[
    'admin'::public.app_role,'manager'::public.app_role,'insurance'::public.app_role,
    'supervisor'::public.app_role,'technician'::public.app_role
  ]) then
    raise exception 'not_authorized';
  end if;

  select * into v_entry
  from public.vehicle_entries
  where id = p_vehicle_entry_id
    and tenant_id = v_tenant
    and deleted_at is null;

  if not found then
    raise exception 'vehicle_entry_not_found';
  end if;
  if v_entry.status = 'Cancelled' then
    raise exception 'vehicle_entry_cancelled';
  end if;

  -- Only the newest generated link remains usable.
  update public.vehicle_entry_signature_links
  set revoked_at = now()
  where tenant_id = v_tenant
    and vehicle_entry_id = p_vehicle_entry_id
    and revoked_at is null
    and consumed_at is null;

  insert into public.vehicle_entry_signature_links (
    tenant_id, vehicle_entry_id, expires_at, created_by
  ) values (
    v_tenant,
    p_vehicle_entry_id,
    now() + make_interval(hours => greatest(1, least(coalesce(p_expires_hours, 168), 720))),
    auth.uid()
  )
  returning * into v_link;

  insert into public.vehicle_entry_audit_logs (
    tenant_id, vehicle_entry_id, user_id, action, new_value
  ) values (
    v_tenant,
    p_vehicle_entry_id,
    auth.uid(),
    'vehicle_entry.customer_signature_link_created',
    jsonb_build_object('link_id', v_link.id, 'expires_at', v_link.expires_at)
  );

  return jsonb_build_object(
    'token', v_link.token,
    'expires_at', v_link.expires_at,
    'vehicle_entry_id', p_vehicle_entry_id
  );
end;
$$;

create or replace function public.get_vehicle_entry_for_customer_signature(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_link public.vehicle_entry_signature_links%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_signature public.vehicle_entry_signatures%rowtype;
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then
    return jsonb_build_object('error', 'invalid_link');
  end if;

  select * into v_link
  from public.vehicle_entry_signature_links
  where token = trim(p_token)
    and revoked_at is null
  limit 1;

  if not found then
    return jsonb_build_object('error', 'invalid_link');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('error', 'expired_link');
  end if;

  select * into v_entry
  from public.vehicle_entries
  where id = v_link.vehicle_entry_id
    and tenant_id = v_link.tenant_id
    and deleted_at is null
    and status <> 'Cancelled';

  if not found then
    return jsonb_build_object('error', 'entry_unavailable');
  end if;

  select * into v_signature
  from public.vehicle_entry_signatures
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id
    and signature_role = 'delivered_by'
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'entry_number', v_entry.entry_number,
    'arrival_date', v_entry.arrival_date,
    'arrival_time', v_entry.arrival_time,
    'arrival_method', v_entry.arrival_method,
    'customer', jsonb_build_object(
      'name', coalesce(v_entry.customer_snapshot->>'name', v_entry.delivered_by->>'full_name')
    ),
    'vehicle', jsonb_build_object(
      'plate_number', v_entry.vehicle_snapshot->>'plate_number',
      'plate_letters', v_entry.vehicle_snapshot->>'plate_letters',
      'make', coalesce(v_entry.vehicle_snapshot->>'make', v_entry.vehicle_snapshot->>'brand'),
      'model', v_entry.vehicle_snapshot->>'model',
      'year', v_entry.vehicle_snapshot->>'year',
      'color', v_entry.vehicle_snapshot->>'color',
      'vin', coalesce(v_entry.vehicle_snapshot->>'vin', v_entry.vehicle_snapshot->>'vin_number')
    ),
    'vehicle_condition', v_entry.vehicle_condition,
    'vehicle_contents', v_entry.vehicle_contents,
    'declaration_ar', v_entry.declaration_ar,
    'declaration_en', v_entry.declaration_en,
    'signed', v_signature.id is not null,
    'signer_name', v_signature.signer_name,
    'signed_at', v_signature.signed_at,
    'expires_at', v_link.expires_at
  );
end;
$$;

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

  return jsonb_build_object('ok', true, 'signature_id', v_signature_id, 'signed_at', v_now);
end;
$$;

revoke all on function public.create_vehicle_entry_signature_link(uuid, integer) from public, anon;
grant execute on function public.create_vehicle_entry_signature_link(uuid, integer) to authenticated;

revoke all on function public.get_vehicle_entry_for_customer_signature(text) from public;
grant execute on function public.get_vehicle_entry_for_customer_signature(text) to anon, authenticated;

revoke all on function public.submit_vehicle_entry_customer_signature(text, text, text, text) from public;
grant execute on function public.submit_vehicle_entry_customer_signature(text, text, text, text) to anon, authenticated;
