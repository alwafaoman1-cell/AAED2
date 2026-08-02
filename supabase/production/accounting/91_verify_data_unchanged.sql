\set ON_ERROR_STOP on
\pset pager off

-- Phase 5A baseline. Any difference requires investigation before proceeding.
with expected(table_name,row_count) as (values
 ('tenants',2::bigint),('profiles',2),('customers',320),('vehicles',146),
 ('job_orders',105),('insurance_claims',77),('insurance_invoices',45),
 ('invoices',0),('claim_payments',26),('sales_payments',13),('expenses',53),
 ('purchase_invoices',0),('supplier_payments',0),('suppliers',17)
), actual as (
 select 'tenants' table_name,count(*) row_count from public.tenants union all
 select 'profiles',count(*) from public.profiles union all
 select 'customers',count(*) from public.customers union all
 select 'vehicles',count(*) from public.vehicles union all
 select 'job_orders',count(*) from public.job_orders union all
 select 'insurance_claims',count(*) from public.insurance_claims union all
 select 'insurance_invoices',count(*) from public.insurance_invoices union all
 select 'invoices',count(*) from public.invoices union all
 select 'claim_payments',count(*) from public.claim_payments union all
 select 'sales_payments',count(*) from public.sales_payments union all
 select 'expenses',count(*) from public.expenses union all
 select 'purchase_invoices',count(*) from public.purchase_invoices union all
 select 'supplier_payments',count(*) from public.supplier_payments union all
 select 'suppliers',count(*) from public.suppliers
)
select e.table_name,e.row_count expected,a.row_count actual,(e.row_count=a.row_count) unchanged
from expected e join actual a using(table_name) order by e.table_name;

select 'auth.users' table_name,2 expected,count(*) actual,(count(*)=2) unchanged from auth.users
union all
select 'storage.objects',99,count(*),(count(*)=99) from storage.objects;

select jsonb_build_object(
 'journals',(select count(*) from public.accounting_journal_entries),
 'active_rules',(select count(*) from public.accounting_posting_rules where is_active),
 'accounts',(select count(*) from public.accounting_accounts),
 'mappings',(select count(*) from public.accounting_account_mappings)
) accounting_runtime_state;
