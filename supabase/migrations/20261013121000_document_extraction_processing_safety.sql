-- Follow-up to the already applied Development foundation migration.
-- Preserve page evidence and serialize extraction jobs across browsers.

alter table public.document_extractions add column if not exists lease_token uuid;

create table if not exists public.document_extraction_pages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  extraction_id uuid not null,
  page_number integer not null check (page_number between 1 and 8),
  extraction_method text not null check (extraction_method in ('native_pdf', 'ocr')),
  text_content text not null check (char_length(text_content) <= 200000),
  confidence numeric(4,3) not null check (confidence between 0 and 1),
  width numeric,
  height numeric,
  segments jsonb not null default '[]'::jsonb check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now(),
  constraint document_page_extraction_fk foreign key (tenant_id, extraction_id) references public.document_extractions(tenant_id, id),
  constraint document_page_unique unique (tenant_id, extraction_id, page_number)
);
create index if not exists document_pages_extraction_idx on public.document_extraction_pages (tenant_id, extraction_id, page_number);

alter table public.document_extraction_pages enable row level security;
create policy document_pages_read on public.document_extraction_pages for select to authenticated
using (public.document_extraction_accessible(tenant_id, extraction_id));
create policy document_pages_insert on public.document_extraction_pages for insert to authenticated
with check (public.document_extraction_accessible(tenant_id, extraction_id));
revoke all on public.document_extraction_pages from public, anon, authenticated;
grant select, insert on public.document_extraction_pages to authenticated;

alter table public.document_files add constraint document_file_temo_path_scope_check
check (storage_bucket <> 'temo-documents' or
  storage_path like tenant_id::text || '/' || access_scope || '/%');

create or replace function public.document_field_insert_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if not exists (
    select 1 from public.document_extractions e
    where e.id = new.extraction_id and e.tenant_id = new.tenant_id
      and e.status in ('processing', 'extracted', 'needs_review')
  ) then
    raise exception 'DOCUMENT_FIELD_INSERT_NOT_ALLOWED';
  end if;
  return new;
end $$;
create trigger document_field_insert_guard_trigger before insert on public.document_extraction_fields
for each row execute function public.document_field_insert_guard();

create or replace function public.document_page_insert_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if not exists (
    select 1 from public.document_extractions e
    where e.id = new.extraction_id and e.tenant_id = new.tenant_id and e.status = 'processing'
  ) then
    raise exception 'DOCUMENT_PAGE_INSERT_NOT_ALLOWED';
  end if;
  return new;
end $$;
create trigger document_page_insert_guard_trigger before insert on public.document_extraction_pages
for each row execute function public.document_page_insert_guard();

create or replace function public.document_claim_processing(p_file_id uuid, p_engine_version text)
returns table(extraction_id uuid, acquired boolean, processing_status text, lease uuid)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare
  v_file public.document_files%rowtype;
  v_extraction public.document_extractions%rowtype;
  v_lease uuid;
begin
  select * into v_file from public.document_files
  where id = p_file_id and tenant_id = public.get_user_tenant_id();
  if not found or not public.document_access_allowed(v_file.access_scope) or auth.uid() is null then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;
  if p_engine_version is null or char_length(p_engine_version) not between 1 and 40 then
    raise exception 'DOCUMENT_ENGINE_VERSION_INVALID';
  end if;
  v_lease := gen_random_uuid();
  insert into public.document_extractions (tenant_id, file_id, engine_version, status, lease_token, uploaded_by)
  values (v_file.tenant_id, v_file.id, p_engine_version, 'processing', v_lease, auth.uid())
  on conflict (tenant_id, file_id, engine_version) do nothing
  returning * into v_extraction;
  if found then
    return query select v_extraction.id, true, v_extraction.status, v_lease;
    return;
  end if;
  select * into v_extraction from public.document_extractions e
  where e.tenant_id = v_file.tenant_id and e.file_id = v_file.id and e.engine_version = p_engine_version
  for update;
  if v_extraction.status in ('uploaded', 'queued', 'failed') or
     (v_extraction.status = 'processing' and v_extraction.updated_at < now() - interval '10 minutes') then
    update public.document_extractions e
      set status = 'processing', error_code = null, lease_token = v_lease, updated_at = now()
      where e.id = v_extraction.id
      returning * into v_extraction;
    return query select v_extraction.id, true, v_extraction.status, v_lease;
  else
    return query select v_extraction.id, false, v_extraction.status, v_extraction.lease_token;
  end if;
end $$;
revoke all on function public.document_claim_processing(uuid, text) from public, anon, authenticated;
grant execute on function public.document_claim_processing(uuid, text) to authenticated;
