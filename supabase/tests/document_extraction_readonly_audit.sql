-- Development only. Counts and configuration, no PII and no writes.
select
  (select count(*) from public.document_files) as file_rows,
  (select count(*) from public.document_extractions) as extraction_rows,
  (select count(*) from public.document_extraction_fields) as field_rows,
  (select count(*) from public.document_extraction_pages) as page_rows,
  (select count(*) from public.document_links) as link_rows,
  (select count(*) from public.document_extraction_events) as event_rows,
  (select public from storage.buckets where id = 'temo-documents') as bucket_public,
  (select count(*) from supabase_migrations.schema_migrations
   where version in ('20261013120000','20261013121000','20261013122000','20261013123000','20261013124000','20261013125000','20261014100000')) as registered_migrations,
  (select count(*) from pg_trigger where tgrelid = 'public.document_extractions'::regclass
    and tgname = 'document_worker_extraction_guard' and not tgisinternal) as worker_guards,
  (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname in
     ('document_files','document_extractions','document_extraction_fields','document_extraction_pages','document_links','document_extraction_events')
     and c.relrowsecurity) as rls_enabled_tables;
