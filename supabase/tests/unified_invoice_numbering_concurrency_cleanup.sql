begin;
drop function if exists public.uin_concurrency_issue(uuid, text);
alter table public.invoice_number_registry disable trigger trg_invoice_number_registry_immutable;
delete from public.sales_documents
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and id::text like 'fa100000-0000-4000-8000-%';
delete from public.insurance_invoices
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and id::text like 'fa200000-0000-4000-8000-%';
delete from public.invoice_number_audit_events
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and (source_id::text like 'fa100000-0000-4000-8000-%'
    or source_id::text like 'fa200000-0000-4000-8000-%');
delete from public.invoice_number_registry
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and (source_id::text like 'fa100000-0000-4000-8000-%'
    or source_id::text like 'fa200000-0000-4000-8000-%');
delete from public.invoice_number_sequences
where tenant_id = 'fa000000-0000-4000-8000-000000000001';
delete from public.invoice_numbering_settings
where tenant_id = 'fa000000-0000-4000-8000-000000000001';
delete from public.tenants
where id = 'fa000000-0000-4000-8000-000000000001'
  and slug = 'uin-concurrency-runtime';
alter table public.invoice_number_registry enable trigger trg_invoice_number_registry_immutable;
commit;

select jsonb_build_object(
  'tenant_removed', not exists (
    select 1 from public.tenants where id = 'fa000000-0000-4000-8000-000000000001'
  ),
  'registry_removed', not exists (
    select 1 from public.invoice_number_registry where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  ),
  'sales_documents_removed', not exists (
    select 1 from public.sales_documents where id::text like 'fa100000-0000-4000-8000-%'
  ),
  'insurance_invoices_removed', not exists (
    select 1 from public.insurance_invoices where id::text like 'fa200000-0000-4000-8000-%'
  ),
  'settings_removed', not exists (
    select 1 from public.invoice_numbering_settings where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  ),
  'sequence_removed', not exists (
    select 1 from public.invoice_number_sequences where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  ),
  'worker_removed', to_regprocedure('public.uin_concurrency_issue(uuid,text)') is null
) as unified_invoice_numbering_concurrency_cleanup;
