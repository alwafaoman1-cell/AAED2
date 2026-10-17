-- Development Preview only. Apply to rrhyglrnlveygyiandhs after verifying the
-- connection target. Never apply to Production or through a broad db push.
-- Keep 1.0.0 jobs drainable; 1.0.1 creates a new immutable extraction for a
-- previously uploaded file after the claim parser has changed.
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
  if p_engine_version not in ('1.0.0-worker', '1.0.1-worker') or p_engine_version is null then
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
