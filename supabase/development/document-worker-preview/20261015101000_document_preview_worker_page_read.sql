-- Development preview only: ON CONFLICT DO NOTHING on OCR pages still needs
-- SELECT privilege. Scope the dedicated worker to the disposable staging tenant.
grant select on public.document_extraction_pages to temo_document_worker;

create policy document_preview_worker_page_read
  on public.document_extraction_pages for select to temo_document_worker
  using (tenant_id = '00000000-0000-4000-8000-000000005741'::uuid);
