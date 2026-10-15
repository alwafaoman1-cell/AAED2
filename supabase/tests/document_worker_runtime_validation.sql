-- Development only. Synthetic tenants/users/files; every fixture is rolled back.
begin;

do $$
declare
  tenant_a uuid := gen_random_uuid();
  tenant_b uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
begin
  perform set_config('temo.test.worker_tenant_a', tenant_a::text, true);
  perform set_config('temo.test.worker_tenant_b', tenant_b::text, true);
  perform set_config('temo.test.worker_admin_a', admin_a::text, true);
  perform set_config('temo.test.worker_admin_b', admin_b::text, true);
  insert into public.tenants(id,name) values (tenant_a,'TEMO worker synthetic A'), (tenant_b,'TEMO worker synthetic B');
  insert into auth.users(id,instance_id,aud,role,raw_user_meta_data)
  values
    (admin_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_a,'role','admin')),
    (admin_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_b,'role','admin'));
  if (select count(*) from public.profiles where user_id in (admin_a,admin_b)) <> 2 then
    raise exception 'WORKER_FIXTURE_PROFILES_MISSING';
  end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('temo.test.worker_admin_a'), true);
select set_config('request.jwt.claim.role', 'authenticated', true);

do $$
declare
  tenant uuid := current_setting('temo.test.worker_tenant_a')::uuid;
  file_id uuid;
  extraction_id uuid;
  repeat_id uuid;
  job_status text;
begin
  insert into public.document_files(tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path)
  values (tenant,repeat('e',64),'synthetic-worker.pdf','application/pdf',100,'operational','temo-documents',tenant::text||'/operational/'||repeat('e',64)||'.pdf')
  returning id into file_id;
  perform set_config('temo.test.worker_file',file_id::text,true);
  begin
    insert into public.document_extractions(tenant_id,file_id,engine_version,status)
    values(tenant,file_id,'1.0.0-worker','extracted');
    raise exception 'BROWSER_FORGED_WORKER_EXTRACTION';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_WORKER_ENQUEUE_RPC_ONLY' then raise; end if;
  end;
  select q.extraction_id, q.processing_status into extraction_id, job_status
    from public.document_enqueue_processing(file_id,'1.0.0-worker') q;
  if extraction_id is null or job_status <> 'queued' then raise exception 'WORKER_ENQUEUE_FAILED'; end if;
  select q.extraction_id into repeat_id from public.document_enqueue_processing(file_id,'1.0.0-worker') q;
  if repeat_id <> extraction_id then raise exception 'WORKER_ENQUEUE_NOT_IDEMPOTENT'; end if;
  perform set_config('temo.test.worker_extraction',extraction_id::text,true);
  perform set_config('temo.document_enqueue_rpc','off',true);
  begin
    update public.document_extractions set status='extracted',raw_text='forged' where id=extraction_id;
    raise exception 'BROWSER_FORGED_WORKER_RESULT';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_WORKER_RESULT_SERVER_ONLY' then raise; end if;
  end;
  begin
    perform public.document_claim_processing(file_id,'1.0.0-worker');
    raise exception 'BROWSER_CLAIMED_WORKER_JOB';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_WORKER_ENQUEUE_RPC_ONLY' then raise; end if;
  end;
end $$;

select set_config('request.jwt.claim.sub', current_setting('temo.test.worker_admin_b'), true);
do $$
begin
  begin
    perform public.document_enqueue_processing(current_setting('temo.test.worker_file')::uuid,'1.0.0-worker');
    raise exception 'CROSS_TENANT_WORKER_ENQUEUE';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_ACCESS_DENIED' then raise; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
update public.document_extractions
  set status='processing', lease_token=gen_random_uuid(), attempt_count=1, processing_started_at=now()
  where id=current_setting('temo.test.worker_extraction')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('temo.test.worker_admin_a'), true);
select set_config('request.jwt.claim.role','authenticated',true);
do $$
begin
  begin
    insert into public.document_extraction_pages(tenant_id,extraction_id,page_number,extraction_method,text_content,confidence)
    values(current_setting('temo.test.worker_tenant_a')::uuid,current_setting('temo.test.worker_extraction')::uuid,1,'ocr','forged',0.9);
    raise exception 'BROWSER_FORGED_WORKER_PAGE';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_WORKER_PAGES_SERVER_ONLY' then raise; end if;
  end;
end $$;

reset role;
select set_config('request.jwt.claim.sub','',true);
select set_config('request.jwt.claim.role','',true);
insert into public.document_extraction_pages(tenant_id,extraction_id,page_number,extraction_method,text_content,confidence)
values(current_setting('temo.test.worker_tenant_a')::uuid,current_setting('temo.test.worker_extraction')::uuid,1,'ocr','synthetic OCR evidence',0.9);
update public.document_extractions set status='extracted',raw_text='synthetic OCR evidence',page_count=1,lease_token=null
where id=current_setting('temo.test.worker_extraction')::uuid;

set local role authenticated;
select set_config('request.jwt.claim.sub', current_setting('temo.test.worker_admin_a'), true);
select set_config('request.jwt.claim.role','authenticated',true);
insert into public.document_extraction_fields(tenant_id,extraction_id,field_key,raw_value,normalized_value,confidence,source_page,extraction_method,validation_status)
values(current_setting('temo.test.worker_tenant_a')::uuid,current_setting('temo.test.worker_extraction')::uuid,'claim_number','SYN-001','SYN-001',0.8,1,'ocr','valid');
update public.document_extractions set status='needs_review'
where id=current_setting('temo.test.worker_extraction')::uuid;

do $$
begin
  begin
    update public.document_extractions set raw_text='tampered' where id=current_setting('temo.test.worker_extraction')::uuid;
    raise exception 'BROWSER_TAMPERED_WORKER_RESULT';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_WORKER_RESULT_SERVER_ONLY' then raise; end if;
  end;
  perform public.document_verify_review(current_setting('temo.test.worker_extraction')::uuid,
    '[{"key":"claim_number","status":"accepted","value":"SYN-001"}]'::jsonb);
  if (select status from public.document_extractions where id=current_setting('temo.test.worker_extraction')::uuid) <> 'verified' then
    raise exception 'WORKER_REVIEW_NOT_VERIFIED';
  end if;
end $$;

rollback;
