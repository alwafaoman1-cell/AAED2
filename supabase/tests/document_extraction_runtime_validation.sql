-- Run on Development only. Entire fixture is rolled back. No real customer data is read.
begin;

do $$
declare
  tenant_a uuid := gen_random_uuid();
  tenant_b uuid := gen_random_uuid();
  admin_a uuid := gen_random_uuid();
  manager_a uuid := gen_random_uuid();
  insurance_a uuid := gen_random_uuid();
  accountant_a uuid := gen_random_uuid();
  technician_a uuid := gen_random_uuid();
  admin_b uuid := gen_random_uuid();
begin
  perform set_config('temo.test.tenant_a', tenant_a::text, true);
  perform set_config('temo.test.tenant_b', tenant_b::text, true);
  perform set_config('temo.test.admin_a', admin_a::text, true);
  perform set_config('temo.test.manager_a', manager_a::text, true);
  perform set_config('temo.test.insurance_a', insurance_a::text, true);
  perform set_config('temo.test.accountant_a', accountant_a::text, true);
  perform set_config('temo.test.technician_a', technician_a::text, true);
  perform set_config('temo.test.admin_b', admin_b::text, true);
  insert into public.tenants(id,name) values(tenant_a,'TEMO synthetic A'),(tenant_b,'TEMO synthetic B');
  insert into auth.users(id,instance_id,aud,role,raw_user_meta_data)
  values
    (admin_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_a,'role','admin')),
    (manager_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_a,'role','manager')),
    (insurance_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_a,'role','insurance')),
    (accountant_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_a,'role','accountant')),
    (technician_a,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_a,'role','technician')),
    (admin_b,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',jsonb_build_object('tenant_id',tenant_b,'role','admin'));
  if (select count(*) from public.profiles where user_id in (admin_a,manager_a,insurance_a,accountant_a,technician_a,admin_b)) <> 6 then
    raise exception 'TEST_PROFILE_SETUP_FAILED';
  end if;
  if has_table_privilege('anon','public.document_files','SELECT') then raise exception 'ANON_FILE_GRANT'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claim.sub',current_setting('temo.test.admin_a'),true);

do $$
declare
  tenant uuid := current_setting('temo.test.tenant_a')::uuid;
  v_operational uuid;
  v_finance uuid;
  v_restricted uuid;
  v_id uuid;
  v_id_second uuid;
  v_empty uuid;
  v_acquired boolean;
begin
  if public.get_user_tenant_id() <> tenant or public.get_user_role() <> 'admin'::public.app_role then
    raise exception 'ADMIN_CLAIMS_SETUP_FAILED';
  end if;
  begin
    insert into public.document_files(tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path)
    values(tenant,repeat('c',64),'unverified-legacy.pdf','application/pdf',100,'operational','insurance-docs',tenant::text||'/unverified-legacy.pdf');
    raise exception 'UNVERIFIED_LEGACY_BUCKET_ALLOWED';
  exception when check_violation then null;
  end;
  insert into public.document_files(tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path)
  values(tenant,repeat('a',64),'synthetic.pdf','application/pdf',100,'operational','temo-documents',tenant::text||'/operational/'||repeat('a',64)||'.pdf')
  returning id into v_operational;
  insert into public.document_files(tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path)
  values(tenant,repeat('b',64),'synthetic-finance.pdf','application/pdf',100,'finance','temo-documents',tenant::text||'/finance/'||repeat('b',64)||'.pdf')
  returning id into v_finance;
  insert into public.document_files(tenant_id,sha256,original_file_name,mime_type,byte_size,access_scope,storage_bucket,storage_path)
  values(tenant,repeat('d',64),'synthetic-restricted.pdf','application/pdf',100,'restricted','temo-documents',tenant::text||'/restricted/'||repeat('d',64)||'.pdf')
  returning id into v_restricted;
  perform set_config('temo.test.operational_file',v_operational::text,true);
  perform set_config('temo.test.finance_file',v_finance::text,true);
  select extraction_id,acquired into v_id,v_acquired from public.document_claim_processing(v_operational,'1.0.0');
  if not v_acquired then raise exception 'FIRST_PROCESSING_CLAIM_FAILED'; end if;
  select extraction_id,acquired into v_id_second,v_acquired from public.document_claim_processing(v_operational,'1.0.0');
  if v_acquired or v_id_second <> v_id then raise exception 'PROCESSING_NOT_IDEMPOTENT'; end if;
  perform set_config('temo.test.extraction',v_id::text,true);
  insert into public.document_extraction_pages(tenant_id,extraction_id,page_number,extraction_method,text_content,confidence)
  values(tenant,v_id,1,'native_pdf','synthetic text',0.95);
  insert into public.document_extraction_fields(tenant_id,extraction_id,field_key,raw_value,normalized_value,confidence,source_page,extraction_method,validation_status)
  values(tenant,v_id,'vin','TEST ORIGINAL','TEST ORIGINAL',0.7,1,'native_pdf','warning');
  update public.document_extractions set status='needs_review' where id=v_id;
  if has_table_privilege('authenticated','public.document_extraction_fields','UPDATE') then
    raise exception 'DIRECT_FIELD_UPDATE_GRANT_REMAINS';
  end if;
  begin
    update public.document_extractions set status='verified' where id=v_id;
    raise exception 'DIRECT_VERIFICATION_ALLOWED';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_REVIEW_RPC_ONLY' then raise; end if;
  end;
  begin
    perform public.document_verify_review(v_id,
      '[{"key":"vin","status":"accepted","value":"WRONG"}]'::jsonb);
    raise exception 'INVALID_REVIEW_ACCEPTED';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_REVIEW_ACCEPTED_VALUE_INVALID' then raise; end if;
  end;
  if exists (select 1 from public.document_extraction_fields where extraction_id=v_id and review_status <> 'pending') or
     exists (select 1 from public.document_extraction_events where extraction_id=v_id and event_type='field_accepted') then
    raise exception 'FAILED_REVIEW_LEFT_PARTIAL_AUDIT';
  end if;
  perform public.document_verify_review(v_id,
    '[{"key":"vin","status":"corrected","value":"TEST CORRECTED"}]'::jsonb);
  if not exists (select 1 from public.document_extraction_events where extraction_id=v_id and event_type='field_corrected' and original_value='TEST ORIGINAL' and new_value='TEST CORRECTED') then
    raise exception 'CORRECTION_AUDIT_MISSING';
  end if;
  if (select status from public.document_extractions where id=v_id) <> 'verified' then
    raise exception 'ATOMIC_VERIFICATION_MISSING';
  end if;
  if not exists (select 1 from public.document_extraction_events where extraction_id=v_id and event_type='verified') then
    raise exception 'VERIFICATION_AUDIT_MISSING';
  end if;
  select extraction_id,acquired into v_empty,v_acquired
    from public.document_claim_processing(v_operational,'empty-review-1.0');
  if not v_acquired then raise exception 'EMPTY_REVIEW_PROCESSING_NOT_ACQUIRED'; end if;
  update public.document_extractions set status='needs_review' where id=v_empty;
  perform public.document_verify_review(v_empty,'[]'::jsonb);
  if (select status from public.document_extractions where id=v_empty) <> 'verified' then
    raise exception 'EMPTY_FIELD_DOCUMENT_NOT_VERIFIED';
  end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('temo.test.manager_a'),true);
do $$ begin
  if (select count(*) from public.document_files) <> 3 then raise exception 'MANAGER_SCOPE_ISOLATION_FAILED'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('temo.test.insurance_a'),true);
do $$ begin
  if (select count(*) from public.document_files) <> 1 then raise exception 'INSURANCE_SCOPE_ISOLATION_FAILED'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('temo.test.accountant_a'),true);
do $$ begin
  if (select count(*) from public.document_files) <> 1 then raise exception 'ACCOUNTANT_SCOPE_ISOLATION_FAILED'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('temo.test.technician_a'),true);
do $$ begin
  if (select count(*) from public.document_files) <> 0 then raise exception 'TECHNICIAN_SHOULD_NOT_READ_DOCUMENTS'; end if;
end $$;

select set_config('request.jwt.claim.sub',current_setting('temo.test.admin_b'),true);
do $$
declare v_denied boolean := false;
begin
  if (select count(*) from public.document_files) <> 0 then raise exception 'CROSS_TENANT_READ'; end if;
  begin
    perform * from public.document_claim_processing(current_setting('temo.test.operational_file')::uuid,'1.0.0');
  exception when others then v_denied := true;
  end;
  if not v_denied then raise exception 'CROSS_TENANT_PROCESSING_ALLOWED'; end if;
end $$;

reset role;
do $$ begin
  begin
    update public.document_extraction_fields set raw_value='TAMPERED'
      where extraction_id=current_setting('temo.test.extraction')::uuid;
    raise exception 'ORIGINAL_FIELD_MUTABLE';
  exception when raise_exception then
    if sqlerrm <> 'DOCUMENT_ORIGINAL_FIELD_IMMUTABLE' then raise; end if;
  end;
end $$;
rollback;
select 'PASS: document RLS, role scopes, tenant isolation, idempotency, audit, immutability; fixture rolled back' as result;
