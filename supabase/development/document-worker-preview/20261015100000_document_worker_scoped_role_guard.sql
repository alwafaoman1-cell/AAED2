-- Development preview worker uses a dedicated NOINHERIT, NOBYPASSRLS login.
-- Do not require USAGE on Supabase's managed auth schema for that login.
-- Browser sessions retain the existing authenticated write guard unchanged.
create or replace function public.document_worker_write_guard()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
declare v_engine text;
declare v_status text;
begin
  if current_user = 'temo_document_worker' then return new; end if;
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
