-- OCR/parser 1.0.5 is immutable per file. Retain all earlier extractions and
-- admit the new worker version through the existing tenant-scoped controls.
-- Apply on Development and verify before a separately approved Production rollout.

alter policy document_worker_file_read on public.document_files
  using (storage_bucket = 'temo-documents' and exists (
    select 1 from public.document_extractions e
    where e.tenant_id = document_files.tenant_id and e.file_id = document_files.id
      and e.engine_version in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker')
      and e.status in ('queued', 'retryable_failed', 'processing')
  ));
alter policy document_worker_extraction_read on public.document_extractions
  using (engine_version in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker'));
alter policy document_worker_extraction_update on public.document_extractions
  using (engine_version in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker')
    and status in ('queued', 'retryable_failed', 'processing'))
  with check (engine_version in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker')
    and status in ('processing', 'retryable_failed', 'failed', 'extracted'));
alter policy document_worker_page_read on public.document_extraction_pages
  using (exists (
    select 1 from public.document_extractions e
    where e.tenant_id = document_extraction_pages.tenant_id and e.id = document_extraction_pages.extraction_id
      and e.engine_version in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker') and e.status = 'processing'
  ));
alter policy document_worker_page_insert on public.document_extraction_pages
  with check (exists (
    select 1 from public.document_extractions e
    where e.tenant_id = document_extraction_pages.tenant_id and e.id = document_extraction_pages.extraction_id
      and e.engine_version in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker') and e.status = 'processing'
  ));

create or replace function public.document_worker_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_engine text;
declare v_status text;
begin
  if current_user = 'temo_document_worker' then
    if tg_table_name = 'document_extractions' then
      if tg_op <> 'UPDATE' or old.engine_version not in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker') or
         old.status not in ('queued', 'retryable_failed', 'processing') or
         new.status not in ('processing', 'retryable_failed', 'failed', 'extracted') or
         (old.status in ('queued', 'retryable_failed') and new.status <> 'processing') then
        raise exception 'DOCUMENT_WORKER_TRANSITION_INVALID';
      end if;
    elsif tg_table_name = 'document_extraction_pages' then
      if tg_op <> 'INSERT' then raise exception 'DOCUMENT_WORKER_PAGE_INSERT_ONLY'; end if;
    else
      raise exception 'DOCUMENT_WORKER_TABLE_DENIED';
    end if;
    return new;
  end if;
  if auth.role() is distinct from 'authenticated' then
    raise exception 'DOCUMENT_WORKER_RESULT_SERVER_ONLY';
  end if;
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
  if p_engine_version not in ('1.0.0-worker', '1.0.1-worker', '1.0.2-worker', '1.0.3-worker', '1.0.4-worker', '1.0.5-worker') or p_engine_version is null then
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
