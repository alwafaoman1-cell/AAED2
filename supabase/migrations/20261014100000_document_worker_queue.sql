-- Development only. The worker reads private files with server-held credentials;
-- a browser can enqueue but can never claim the worker lease or publish OCR pages.
alter table public.document_extractions
  drop constraint if exists document_extractions_status_check;
alter table public.document_extractions
  add constraint document_extractions_status_check
  check (status in ('uploaded', 'queued', 'processing', 'extracted', 'needs_review', 'verified', 'failed', 'retryable_failed'));
alter table public.document_extractions
  add column if not exists attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  add column if not exists next_attempt_at timestamptz,
  add column if not exists processing_started_at timestamptz;

create index if not exists document_worker_queue_idx
  on public.document_extractions (next_attempt_at, created_at)
  where status in ('queued', 'retryable_failed');

create or replace function public.document_enqueue_processing(p_file_id uuid, p_engine_version text)
returns table(extraction_id uuid, processing_status text)
language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_file public.document_files%rowtype;
declare v_extraction public.document_extractions%rowtype;
begin
  if auth.uid() is null then raise exception 'DOCUMENT_ACCESS_DENIED'; end if;
  select * into v_file from public.document_files
    where id = p_file_id and tenant_id = public.get_user_tenant_id();
  if not found or not public.document_access_allowed(v_file.access_scope) then
    raise exception 'DOCUMENT_ACCESS_DENIED';
  end if;
  if p_engine_version is distinct from '1.0.0-worker' then
    raise exception 'DOCUMENT_ENGINE_VERSION_INVALID';
  end if;
  perform set_config('temo.document_enqueue_rpc', 'on', true);
  insert into public.document_extractions (tenant_id, file_id, engine_version, status, uploaded_by)
    values (v_file.tenant_id, v_file.id, p_engine_version, 'queued', auth.uid())
    on conflict (tenant_id, file_id, engine_version) do nothing;
  select * into v_extraction from public.document_extractions e
    where e.tenant_id = v_file.tenant_id and e.file_id = v_file.id and e.engine_version = p_engine_version
    for update;
  if v_extraction.status in ('failed', 'retryable_failed') and v_extraction.attempt_count < 3 then
    perform set_config('temo.document_enqueue_rpc', 'on', true);
    update public.document_extractions set status = 'queued', next_attempt_at = null, error_code = null
      where id = v_extraction.id returning * into v_extraction;
  end if;
  return query select v_extraction.id, v_extraction.status;
end $$;
revoke all on function public.document_enqueue_processing(uuid, text) from public, anon;
grant execute on function public.document_enqueue_processing(uuid, text) to authenticated;

-- Browser writes cannot fabricate a worker-completed OCR page. The worker uses
-- a server-side DB connection; existing local-browser path is retained for Dev
-- fallback and must be disabled before a server-authoritative Production launch.
comment on function public.document_enqueue_processing(uuid, text) is
  'Queues a tenant-scoped private document. Worker claims rows with FOR UPDATE SKIP LOCKED using server-only DB credentials.';

create or replace function public.document_worker_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_engine text;
declare v_status text;
begin
  -- Direct server-side connections have a NULL auth.role(). Treat that as
  -- distinct from a browser session so the worker can publish OCR results.
  if auth.role() is distinct from 'authenticated' then return new; end if;
  if tg_table_name = 'document_extractions' then
    if tg_op = 'INSERT' then
      if new.engine_version like '%-worker' and
         (current_setting('temo.document_enqueue_rpc', true) is distinct from 'on' or
          new.status <> 'queued' or new.lease_token is not null or
          new.raw_text is not null or new.page_count <> 0 or new.attempt_count <> 0) then
        raise exception 'DOCUMENT_WORKER_ENQUEUE_RPC_ONLY';
      end if;
      return new;
    end if;
    if old.engine_version not like '%-worker' then return new; end if;
    if current_setting('temo.document_enqueue_rpc', true) = 'on' and
       old.status in ('failed', 'retryable_failed') and new.status = 'queued' then
      return new;
    end if;
    if old.status in ('queued', 'processing', 'retryable_failed', 'failed') then
      raise exception 'DOCUMENT_WORKER_RESULT_SERVER_ONLY';
    end if;
    if old.status = 'extracted' and
       (new.status <> 'needs_review' or
        row(new.raw_text, new.page_count, new.extraction_method, new.lease_token,
            new.attempt_count, new.next_attempt_at, new.processing_started_at)
          is distinct from
        row(old.raw_text, old.page_count, old.extraction_method, old.lease_token,
            old.attempt_count, old.next_attempt_at, old.processing_started_at)) then
      raise exception 'DOCUMENT_WORKER_RESULT_SERVER_ONLY';
    end if;
    if old.status = 'needs_review' and
       (new.status <> 'verified' or current_setting('temo.document_review_rpc', true) is distinct from 'on' or
        row(new.raw_text, new.page_count, new.extraction_method, new.processing_metrics,
            new.document_type, new.detected_language, new.overall_confidence, new.issues, new.matches)
          is distinct from
        row(old.raw_text, old.page_count, old.extraction_method, old.processing_metrics,
            old.document_type, old.detected_language, old.overall_confidence, old.issues, old.matches)) then
      raise exception 'DOCUMENT_WORKER_RESULT_SERVER_ONLY';
    end if;
  elsif tg_table_name = 'document_extraction_pages' then
    select engine_version into v_engine from public.document_extractions
      where tenant_id = new.tenant_id and id = new.extraction_id;
    if v_engine like '%-worker' then raise exception 'DOCUMENT_WORKER_PAGES_SERVER_ONLY'; end if;
  elsif tg_table_name = 'document_extraction_fields' then
    select engine_version, status into v_engine, v_status from public.document_extractions
      where tenant_id = new.tenant_id and id = new.extraction_id;
    if v_engine like '%-worker' and v_status <> 'extracted' then
      raise exception 'DOCUMENT_WORKER_FIELDS_NOT_READY';
    end if;
  end if;
  return new;
end $$;
create trigger document_worker_extraction_guard before insert or update on public.document_extractions
  for each row execute function public.document_worker_write_guard();
create trigger document_worker_page_guard before insert on public.document_extraction_pages
  for each row execute function public.document_worker_write_guard();
create trigger document_worker_field_guard before insert on public.document_extraction_fields
  for each row execute function public.document_worker_write_guard();
revoke all on function public.document_worker_write_guard() from public, anon, authenticated;
