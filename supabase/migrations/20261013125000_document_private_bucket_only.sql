-- New extraction records may reference only the dedicated private bucket.
-- Reusing legacy media requires a future server-verified ownership flow; a
-- browser must not be able to register a path in another bucket as its own.
alter table public.document_files
  add constraint document_files_private_bucket_only
  check (storage_bucket = 'temo-documents');

comment on table public.document_files is
  'Private extraction files are deduplicated per tenant, hash and access scope. Legacy media cannot be registered without a verified server-side ownership flow.';
