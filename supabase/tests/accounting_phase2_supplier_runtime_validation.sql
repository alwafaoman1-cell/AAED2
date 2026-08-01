begin;

create temporary table phase2_supplier_results(name text, result text, details text) on commit drop;
grant select, insert on phase2_supplier_results to authenticated;

insert into public.tenants(id,name,slug)
values('e5000000-0000-4000-8000-000000000001','Accounting Supplier Runtime','accounting-supplier-runtime');
insert into auth.users(id,email,raw_user_meta_data)
values('e5000000-0000-4000-8000-000000000011','phase2-supplier@runtime.invalid','{"tenant_id":"e5000000-0000-4000-8000-000000000001","full_name":"Supplier Runtime Admin","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

insert into public.accounting_fiscal_years(id,tenant_id,name,start_date,end_date)
values('e5100000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','FY 2026','2026-01-01','2026-12-31');
insert into public.accounting_periods(id,tenant_id,fiscal_year_id,name,sequence,start_date,end_date)
values('e5200000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','e5100000-0000-4000-8000-000000000001','August 2026',8,'2026-08-01','2026-08-31');

insert into public.accounting_accounts(id,tenant_id,code,name_ar,name_en,account_type,normal_balance)
values
 ('e5300000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','5100','مشتريات','Purchases','expense','debit'),
 ('e5300000-0000-4000-8000-000000000002','e5000000-0000-4000-8000-000000000001','1150','ضريبة مدخلات','Input VAT','asset','debit'),
 ('e5300000-0000-4000-8000-000000000003','e5000000-0000-4000-8000-000000000001','2200','دائنون','Supplier Payable','liability','credit'),
 ('e5300000-0000-4000-8000-000000000004','e5000000-0000-4000-8000-000000000001','1200','بنك','Bank','asset','debit');
insert into public.accounting_account_mappings(tenant_id,mapping_key,account_id,priority,status)
values
 ('e5000000-0000-4000-8000-000000000001','purchase_expense','e5300000-0000-4000-8000-000000000001',100,'active'),
 ('e5000000-0000-4000-8000-000000000001','input_vat','e5300000-0000-4000-8000-000000000002',100,'active'),
 ('e5000000-0000-4000-8000-000000000001','supplier_payable','e5300000-0000-4000-8000-000000000003',100,'active'),
 ('e5000000-0000-4000-8000-000000000001','bank_account','e5300000-0000-4000-8000-000000000004',100,'active');

insert into public.accounting_posting_rules(
 tenant_id,rule_key,source_type,event_type,debit_mapping_key,credit_mapping_key,is_active,configuration
) values
 ('e5000000-0000-4000-8000-000000000001','supplier-invoice-runtime','supplier_invoice','receive','purchase_expense','supplier_payable',true,
  '{"lines":[{"side":"debit","mapping_key":"purchase_expense","amount":"net_amount"},{"side":"debit","mapping_key":"input_vat","amount":"vat_amount"},{"side":"credit","mapping_key":"supplier_payable","amount":"total_amount"}]}'::jsonb),
 ('e5000000-0000-4000-8000-000000000001','supplier-payment-runtime','supplier_payment','pay','supplier_payable','bank_account',true,
  '{"lines":[{"side":"debit","mapping_key":"supplier_payable","amount":"amount"},{"side":"credit","mapping_key":"$payment_account","amount":"amount"}]}'::jsonb);

reset role;
insert into public.suppliers(id,tenant_id,name)
values('e5400000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','Runtime Supplier');
insert into public.purchase_invoices(
 id,tenant_id,invoice_number,supplier_invoice_number,supplier_id,supplier_name,date,subtotal,vat,total,status
) values (
 'e5500000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','PI-RUNTIME-1','SUP-1',
 'e5400000-0000-4000-8000-000000000001','Runtime Supplier','2026-08-06',50,2.5,52.5,'received'
);
insert into public.supplier_payments(
 id,tenant_id,payment_number,purchase_invoice_id,supplier_id,supplier_name,amount,payment_method,payment_date
) values (
 'e5600000-0000-4000-8000-000000000001','e5000000-0000-4000-8000-000000000001','SP-RUNTIME-1',
 'e5500000-0000-4000-8000-000000000001','e5400000-0000-4000-8000-000000000001','Runtime Supplier',20,'bank_transfer','2026-08-07'
);

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e5000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

do $$
declare v jsonb; j1 public.accounting_journal_entries%rowtype; j2 public.accounting_journal_entries%rowtype;
begin
  v := public.preview_accounting_source_posting('supplier_invoice','e5500000-0000-4000-8000-000000000001','receive','2026-08-06');
  insert into phase2_supplier_results values('supplier_invoice_preview',case when v->>'total_debit'='52.500' and v->>'total_credit'='52.500' and jsonb_array_length(v->'lines')=3 then 'PASS' else 'FAIL' end,v::text);
  j1 := public.post_accounting_source('supplier_invoice','e5500000-0000-4000-8000-000000000001','receive','2026-08-06','supplier-invoice-runtime-key');
  insert into phase2_supplier_results values('supplier_invoice_posted',case when j1.status='posted' then 'PASS' else 'FAIL' end,j1.id::text);

  v := public.preview_accounting_source_posting('supplier_payment','e5600000-0000-4000-8000-000000000001','pay','2026-08-07');
  insert into phase2_supplier_results values('supplier_payment_preview',case when v->>'total_debit'='20.000' and v->>'total_credit'='20.000' and jsonb_array_length(v->'lines')=2 then 'PASS' else 'FAIL' end,v::text);
  j2 := public.post_accounting_source('supplier_payment','e5600000-0000-4000-8000-000000000001','pay','2026-08-07','supplier-payment-runtime-key');
  insert into phase2_supplier_results values('supplier_payment_posted',case when j2.status='posted' then 'PASS' else 'FAIL' end,j2.id::text);
end $$;

select jsonb_build_object(
  'total', count(*),
  'passed', count(*) filter(where result='PASS'),
  'failed', count(*) filter(where result<>'PASS'),
  'tests', jsonb_agg(jsonb_build_object('name',name,'result',result,'details',details) order by name)
) as accounting_phase2_supplier_runtime_validation
from phase2_supplier_results;

rollback;
