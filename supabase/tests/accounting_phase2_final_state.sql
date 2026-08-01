explain (analyze, buffers, format json)
select id
from public.accounting_posting_requests
where tenant_id='00000000-0000-0000-0000-000000000000'
  and idempotency_key='phase2-index-validation';

select jsonb_build_object(
  'app_versions_exists', to_regclass('public.app_versions') is not null,
  'posting_requests_exists', to_regclass('public.accounting_posting_requests') is not null,
  'posting_requests_rls', coalesce((select relrowsecurity from pg_class where oid='public.accounting_posting_requests'::regclass), false),
  'active_posting_rules', (select count(*) from public.accounting_posting_rules where is_active),
  'posting_requests', (select count(*) from public.accounting_posting_requests),
  'journal_entries', (select count(*) from public.accounting_journal_entries),
  'journal_lines', (select count(*) from public.accounting_journal_lines),
  'phase2_fixture_tenants', (select count(*) from public.tenants where id in (
    'e1000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001'
  )),
  'phase2_fixture_audit_rows', (select count(*) from public.accounting_audit_logs where tenant_id in (
    'e1000000-0000-4000-8000-000000000001',
    'e5000000-0000-4000-8000-000000000001'
  )),
  'accounting_runtime_auth_users', (select count(*) from auth.users where email like '%@runtime.invalid'),
  'accounting_runtime_storage_objects', (select count(*) from storage.objects where name ilike '%accounting%runtime%' or name ilike '%phase2%'),
  'source_table_posting_triggers', (
    select count(*)
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal
      and n.nspname='public'
      and c.relname in ('sales_documents','invoices','insurance_invoices','sales_payments','claim_payments','expenses','purchase_invoices','supplier_payments')
      and pg_get_triggerdef(t.oid) ilike '%accounting%'
  ),
  'request_indexes', (
    select count(*) from pg_indexes
    where schemaname='public' and tablename='accounting_posting_requests'
  ),
  'anon_post_execute', has_function_privilege('anon','public.post_accounting_source(text,uuid,text,date,text)','execute'),
  'anon_preview_execute', has_function_privilege('anon','public.preview_accounting_source_posting(text,uuid,text,date)','execute')
) as accounting_phase2_final_state;
