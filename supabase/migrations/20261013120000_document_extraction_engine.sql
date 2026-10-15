-- Development-first document intelligence. Additive; no existing media or business rows are rewritten.
-- Production rollout requires an independent safety gate and is intentionally not part of this migration run.

create or replace function public.document_access_allowed(p_scope text)
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $$
  select case p_scope
    when 'operational' then public.get_user_role() in ('admin'::public.app_role, 'manager'::public.app_role, 'insurance'::public.app_role, 'supervisor'::public.app_role)
    when 'finance' then public.get_user_role() in ('admin'::public.app_role, 'manager'::public.app_role, 'accountant'::public.app_role)
    when 'restricted' then public.get_user_role() in ('admin'::public.app_role, 'manager'::public.app_role)
    else false
  end;
$$;

create table if not exists public.document_files (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  original_file_name text not null check (char_length(original_file_name) between 1 and 255),
  mime_type text not null check (mime_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')),
  byte_size bigint not null check (byte_size between 1 and 12582912),
  access_scope text not null check (access_scope in ('operational', 'finance', 'restricted')),
  storage_bucket text not null check (storage_bucket in ('temo-documents', 'insurance-docs', 'expense-documents')),
  storage_path text not null,
  uploaded_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  constraint document_file_tenant_path_check check (storage_path like tenant_id::text || '/%'),
  constraint document_file_tenant_id_unique unique (tenant_id, id),
  constraint document_file_hash_scope_unique unique (tenant_id, sha256, access_scope),
  constraint document_file_storage_unique unique (tenant_id, storage_bucket, storage_path)
);
create index if not exists document_files_tenant_created_idx on public.document_files (tenant_id, created_at desc);

create table if not exists public.document_extractions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  file_id uuid not null,
  engine_version text not null check (char_length(engine_version) between 1 and 40),
  status text not null default 'uploaded' check (status in ('uploaded', 'queued', 'processing', 'extracted', 'needs_review', 'verified', 'failed')),
  document_type text not null default 'unknown',
  detected_language text not null default 'unknown' check (detected_language in ('ar', 'en', 'mixed', 'unknown')),
  extraction_method text check (extraction_method in ('native_pdf', 'ocr', 'ai')),
  raw_text text check (char_length(raw_text) <= 1000000),
  page_count integer not null default 0 check (page_count between 0 and 8),
  overall_confidence numeric(4,3) check (overall_confidence between 0 and 1),
  ai_used boolean not null default false,
  issues jsonb not null default '[]'::jsonb check (jsonb_typeof(issues) = 'array'),
  matches jsonb not null default '[]'::jsonb check (jsonb_typeof(matches) = 'array'),
  processing_metrics jsonb not null default '{}'::jsonb check (jsonb_typeof(processing_metrics) = 'object'),
  error_code text,
  uploaded_by uuid not null default auth.uid(),
  verified_by uuid,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint document_extraction_file_fk foreign key (tenant_id, file_id) references public.document_files(tenant_id, id),
  constraint document_extraction_tenant_id_unique unique (tenant_id, id),
  constraint document_extraction_idempotency_unique unique (tenant_id, file_id, engine_version),
  constraint document_extraction_verified_check check (status <> 'verified' or (verified_by is not null and verified_at is not null))
);
create index if not exists document_extractions_status_idx on public.document_extractions (tenant_id, status, updated_at desc);
create index if not exists document_extractions_type_idx on public.document_extractions (tenant_id, document_type, created_at desc);

create table if not exists public.document_extraction_fields (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  extraction_id uuid not null,
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,79}$'),
  raw_value text not null check (char_length(raw_value) <= 4000),
  normalized_value text not null check (char_length(normalized_value) <= 4000),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  source_page integer not null check (source_page between 1 and 8),
  source_box jsonb check (source_box is null or jsonb_typeof(source_box) = 'object'),
  extraction_method text not null check (extraction_method in ('native_pdf', 'ocr', 'ai')),
  validation_status text not null check (validation_status in ('valid', 'warning', 'invalid', 'unchecked')),
  review_status text not null default 'pending' check (review_status in ('pending', 'accepted', 'corrected', 'rejected')),
  reviewed_value text check (reviewed_value is null or char_length(reviewed_value) <= 4000),
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint document_field_extraction_fk foreign key (tenant_id, extraction_id) references public.document_extractions(tenant_id, id),
  constraint document_field_unique unique (tenant_id, extraction_id, field_key)
);
create index if not exists document_fields_review_idx on public.document_extraction_fields (tenant_id, extraction_id, review_status);

create table if not exists public.document_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  file_id uuid not null,
  entity_type text not null check (entity_type in ('vehicle', 'claim', 'work_order', 'customer', 'supplier', 'expense', 'purchase_invoice', 'vehicle_entry')),
  entity_id uuid not null,
  linked_by uuid not null default auth.uid(),
  linked_at timestamptz not null default now(),
  removed_at timestamptz,
  constraint document_link_file_fk foreign key (tenant_id, file_id) references public.document_files(tenant_id, id),
  constraint document_link_unique unique (tenant_id, file_id, entity_type, entity_id)
);
create index if not exists document_links_entity_idx on public.document_links (tenant_id, entity_type, entity_id) where removed_at is null;

create table if not exists public.document_extraction_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  extraction_id uuid not null,
  event_type text not null check (event_type in ('status_changed', 'field_corrected', 'field_accepted', 'field_rejected', 'verified')),
  field_key text,
  original_value text,
  new_value text,
  actor_id uuid,
  created_at timestamptz not null default now(),
  constraint document_event_extraction_fk foreign key (tenant_id, extraction_id) references public.document_extractions(tenant_id, id)
);
create index if not exists document_events_extraction_idx on public.document_extraction_events (tenant_id, extraction_id, created_at desc);

create or replace function public.document_file_accessible(p_tenant uuid, p_file uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.document_files f
    where f.tenant_id = p_tenant and f.id = p_file
      and f.tenant_id = public.get_user_tenant_id()
      and public.document_access_allowed(f.access_scope)
  );
$$;

create or replace function public.document_extraction_accessible(p_tenant uuid, p_extraction uuid)
returns boolean language sql stable security invoker set search_path = pg_catalog, public as $$
  select exists (
    select 1 from public.document_extractions e
    where e.tenant_id = p_tenant and e.id = p_extraction
      and public.document_file_accessible(e.tenant_id, e.file_id)
  );
$$;

create or replace function public.document_extraction_prepare()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
       or new.file_id is distinct from old.file_id or new.engine_version is distinct from old.engine_version
       or new.uploaded_by is distinct from old.uploaded_by or new.created_at is distinct from old.created_at then
      raise exception 'DOCUMENT_EXTRACTION_IDENTITY_IMMUTABLE';
    end if;
    if old.status = 'verified' then raise exception 'DOCUMENT_EXTRACTION_VERIFIED_READ_ONLY'; end if;
  else
    new.uploaded_by := auth.uid();
  end if;
  if new.status = 'verified' then
    new.verified_by := auth.uid();
    new.verified_at := now();
  elsif new.verified_by is not null or new.verified_at is not null then
    raise exception 'DOCUMENT_VERIFICATION_STATE_INVALID';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger document_extraction_prepare_trigger before insert or update on public.document_extractions
for each row execute function public.document_extraction_prepare();

create or replace function public.document_field_prepare()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    if row(new.id, new.tenant_id, new.extraction_id, new.field_key, new.raw_value, new.normalized_value,
           new.confidence, new.source_page, new.source_box, new.extraction_method, new.validation_status, new.created_at)
       is distinct from
       row(old.id, old.tenant_id, old.extraction_id, old.field_key, old.raw_value, old.normalized_value,
           old.confidence, old.source_page, old.source_box, old.extraction_method, old.validation_status, old.created_at) then
      raise exception 'DOCUMENT_ORIGINAL_FIELD_IMMUTABLE';
    end if;
    if exists (select 1 from public.document_extractions e where e.id = new.extraction_id and e.tenant_id = new.tenant_id and e.status = 'verified') then
      raise exception 'DOCUMENT_VERIFIED_FIELDS_READ_ONLY';
    end if;
    if new.review_status <> 'pending' then
      new.reviewed_by := auth.uid();
      new.reviewed_at := now();
    end if;
  end if;
  return new;
end $$;
create trigger document_field_prepare_trigger before update on public.document_extraction_fields
for each row execute function public.document_field_prepare();

create or replace function public.document_link_check_entity()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare is_valid boolean := false;
begin
  if tg_op = 'UPDATE' and (new.tenant_id, new.file_id, new.entity_type, new.entity_id) is distinct from
     (old.tenant_id, old.file_id, old.entity_type, old.entity_id) then
    raise exception 'DOCUMENT_LINK_IDENTITY_IMMUTABLE';
  end if;
  if tg_op = 'UPDATE' then return new; end if;
  case new.entity_type
    when 'vehicle' then select exists(select 1 from public.vehicles where id = new.entity_id and tenant_id = new.tenant_id and deleted_at is null) into is_valid;
    when 'claim' then select exists(select 1 from public.insurance_claims where id = new.entity_id and tenant_id = new.tenant_id and deleted_at is null) into is_valid;
    when 'work_order' then select exists(select 1 from public.job_orders where id = new.entity_id and tenant_id = new.tenant_id and deleted_at is null) into is_valid;
    when 'customer' then select exists(select 1 from public.customers where id = new.entity_id and tenant_id = new.tenant_id and deleted_at is null) into is_valid;
    when 'supplier' then select exists(select 1 from public.suppliers where id = new.entity_id and tenant_id = new.tenant_id) into is_valid;
    when 'expense' then select exists(select 1 from public.expenses where id = new.entity_id and tenant_id = new.tenant_id and deleted_at is null) into is_valid;
    when 'purchase_invoice' then select exists(select 1 from public.purchase_invoices where id = new.entity_id and tenant_id = new.tenant_id) into is_valid;
    when 'vehicle_entry' then select exists(select 1 from public.vehicle_entries where id = new.entity_id and tenant_id = new.tenant_id and deleted_at is null) into is_valid;
  end case;
  if not is_valid then raise exception 'DOCUMENT_LINK_TARGET_NOT_FOUND_OR_WRONG_TENANT'; end if;
  return new;
end $$;
create trigger document_link_check_entity_trigger before insert or update on public.document_links
for each row execute function public.document_link_check_entity();

create or replace function public.document_field_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.review_status is distinct from old.review_status or new.reviewed_value is distinct from old.reviewed_value then
    insert into public.document_extraction_events (tenant_id, extraction_id, event_type, field_key, original_value, new_value, actor_id)
    values (new.tenant_id, new.extraction_id,
      case new.review_status when 'corrected' then 'field_corrected' when 'accepted' then 'field_accepted' else 'field_rejected' end,
      new.field_key, old.raw_value, new.reviewed_value, auth.uid());
  end if;
  return new;
end $$;
create trigger document_field_audit_trigger after update on public.document_extraction_fields
for each row execute function public.document_field_audit();

create or replace function public.document_extraction_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.status is distinct from old.status then
    insert into public.document_extraction_events (tenant_id, extraction_id, event_type, original_value, new_value, actor_id)
    values (new.tenant_id, new.id, case when new.status = 'verified' then 'verified' else 'status_changed' end,
      old.status, new.status, auth.uid());
  end if;
  return new;
end $$;
create trigger document_extraction_audit_trigger after update on public.document_extractions
for each row execute function public.document_extraction_audit();

alter table public.document_files enable row level security;
alter table public.document_extractions enable row level security;
alter table public.document_extraction_fields enable row level security;
alter table public.document_links enable row level security;
alter table public.document_extraction_events enable row level security;

create policy document_files_read on public.document_files for select to authenticated
using (tenant_id = public.get_user_tenant_id() and public.document_access_allowed(access_scope));
create policy document_files_insert on public.document_files for insert to authenticated
with check (tenant_id = public.get_user_tenant_id() and public.document_access_allowed(access_scope) and uploaded_by = auth.uid());

create policy document_extractions_read on public.document_extractions for select to authenticated
using (public.document_file_accessible(tenant_id, file_id));
create policy document_extractions_insert on public.document_extractions for insert to authenticated
with check (public.document_file_accessible(tenant_id, file_id) and uploaded_by = auth.uid());
create policy document_extractions_update on public.document_extractions for update to authenticated
using (public.document_file_accessible(tenant_id, file_id))
with check (public.document_file_accessible(tenant_id, file_id));

create policy document_fields_read on public.document_extraction_fields for select to authenticated
using (public.document_extraction_accessible(tenant_id, extraction_id));
create policy document_fields_insert on public.document_extraction_fields for insert to authenticated
with check (public.document_extraction_accessible(tenant_id, extraction_id));
create policy document_fields_update on public.document_extraction_fields for update to authenticated
using (public.document_extraction_accessible(tenant_id, extraction_id))
with check (public.document_extraction_accessible(tenant_id, extraction_id));

create policy document_links_read on public.document_links for select to authenticated
using (public.document_file_accessible(tenant_id, file_id));
create policy document_links_insert on public.document_links for insert to authenticated
with check (public.document_file_accessible(tenant_id, file_id) and linked_by = auth.uid());
create policy document_links_update on public.document_links for update to authenticated
using (public.document_file_accessible(tenant_id, file_id) and public.get_user_role() in ('admin'::public.app_role, 'manager'::public.app_role))
with check (public.document_file_accessible(tenant_id, file_id));

create policy document_events_read on public.document_extraction_events for select to authenticated
using (public.document_extraction_accessible(tenant_id, extraction_id));

revoke all on public.document_files, public.document_extractions, public.document_extraction_fields,
  public.document_links, public.document_extraction_events from public, anon, authenticated;
grant select, insert on public.document_files to authenticated;
grant select, insert, update on public.document_extractions, public.document_extraction_fields, public.document_links to authenticated;
grant select on public.document_extraction_events to authenticated;
revoke all on function public.document_field_audit(), public.document_extraction_audit() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('temo-documents', 'temo-documents', false, 12582912,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy temo_documents_read on storage.objects for select to authenticated
using (bucket_id = 'temo-documents'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and public.document_access_allowed((storage.foldername(name))[2]));
create policy temo_documents_insert on storage.objects for insert to authenticated
with check (bucket_id = 'temo-documents'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and public.document_access_allowed((storage.foldername(name))[2]));

comment on table public.document_files is 'One private file per tenant, hash and access scope. Existing media may be referenced but is not copied.';
comment on table public.document_extraction_fields is 'Original extraction columns are immutable; reviewed_value and review_status preserve human corrections.';
