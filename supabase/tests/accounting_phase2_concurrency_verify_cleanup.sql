select jsonb_build_object(
 'journal_entries',(select count(*) from public.accounting_journal_entries where tenant_id='e1000000-0000-4000-8000-000000000001'),
 'primary_source_links',(select count(*) from public.accounting_source_links where tenant_id='e1000000-0000-4000-8000-000000000001' and source_type='sales_invoice' and source_id='e4400000-0000-4000-8000-000000000001' and is_primary),
 'posting_requests',(select count(*) from public.accounting_posting_requests where tenant_id='e1000000-0000-4000-8000-000000000001'),
 'distinct_request_journals',(select count(distinct journal_entry_id) from public.accounting_posting_requests where tenant_id='e1000000-0000-4000-8000-000000000001')
) as concurrency_result;

-- Runtime fixtures are exact, isolated test IDs. Replica mode is used only for
-- cleanup because posted journals are intentionally immutable in normal use.
set session_replication_role = replica;
delete from public.accounting_audit_logs where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_posting_requests where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_source_links where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_journal_lines where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_journal_entries where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_journal_number_sequences where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_posting_rules where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_account_mappings where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_periods where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_fiscal_years where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.accounting_accounts where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.sales_documents where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.job_orders where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.vehicles where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.customers where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.profiles where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from public.user_roles where tenant_id='e1000000-0000-4000-8000-000000000001';
delete from auth.users where id='e1000000-0000-4000-8000-000000000011';
delete from public.tenants where id='e1000000-0000-4000-8000-000000000001';
set session_replication_role = origin;

select jsonb_build_object(
 'tenant_rows',(select count(*) from public.tenants where id='e1000000-0000-4000-8000-000000000001'),
 'journal_rows',(select count(*) from public.accounting_journal_entries where tenant_id='e1000000-0000-4000-8000-000000000001'),
 'auth_rows',(select count(*) from auth.users where id='e1000000-0000-4000-8000-000000000011')
) as cleanup_result;
