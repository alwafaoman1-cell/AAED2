-- Development-only committed fixture for two-session idempotency validation.
begin;
select set_config('app.accounting_runtime_validation','on',true);

insert into public.tenants(id,name,slug)
values('e1000000-0000-4000-8000-000000000001','Accounting Phase 2 Concurrency','accounting-phase2-concurrency');

insert into auth.users(id,email,raw_user_meta_data)
values('e1000000-0000-4000-8000-000000000011','phase2-concurrency@runtime.invalid','{"tenant_id":"e1000000-0000-4000-8000-000000000001","full_name":"Concurrency Admin","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

insert into public.accounting_fiscal_years(id,tenant_id,name,start_date,end_date)
values('e2000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','FY 2026','2026-01-01','2026-12-31');
insert into public.accounting_periods(id,tenant_id,fiscal_year_id,name,sequence,start_date,end_date)
values('e2100000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001','August 2026',8,'2026-08-01','2026-08-31');

insert into public.accounting_accounts(id,tenant_id,code,name_ar,name_en,account_type,normal_balance)
values
 ('e3000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','1100','ذمم','Receivable','asset','debit'),
 ('e3000000-0000-4000-8000-000000000002','e1000000-0000-4000-8000-000000000001','4100','إيراد','Revenue','revenue','credit'),
 ('e3000000-0000-4000-8000-000000000003','e1000000-0000-4000-8000-000000000001','2100','ضريبة','Output VAT','liability','credit');
insert into public.accounting_account_mappings(tenant_id,mapping_key,account_id,priority,status)
values
 ('e1000000-0000-4000-8000-000000000001','cash_customer_receivable','e3000000-0000-4000-8000-000000000001',100,'active'),
 ('e1000000-0000-4000-8000-000000000001','cash_revenue','e3000000-0000-4000-8000-000000000002',100,'active'),
 ('e1000000-0000-4000-8000-000000000001','output_vat','e3000000-0000-4000-8000-000000000003',100,'active');
insert into public.accounting_posting_rules(
 tenant_id,rule_key,source_type,event_type,debit_mapping_key,credit_mapping_key,is_active,configuration
) values (
 'e1000000-0000-4000-8000-000000000001','concurrent-invoice','sales_invoice','issue',
 'cash_customer_receivable','cash_revenue',true,
 '{"lines":[{"side":"debit","mapping_key":"$receivable","amount":"total_amount"},{"side":"credit","mapping_key":"$revenue","amount":"net_amount"},{"side":"credit","mapping_key":"output_vat","amount":"vat_amount"}]}'::jsonb
);

reset role;
insert into public.customers(id,tenant_id,name)
values('e4000000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','Concurrency Customer');
insert into public.vehicles(id,tenant_id,customer_id,plate_number,brand,model)
values('e4100000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','CONCURRENT-1','Test','Vehicle');
insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number)
values('e4200000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','e4100000-0000-4000-8000-000000000001','e4000000-0000-4000-8000-000000000001','WO-CONCURRENT-1');
insert into public.sales_documents(
 id,tenant_id,doc_number,doc_type,customer_id,work_order_id,date,subtotal,tax_total,total,status,invoice_status,issued_at
) values (
 'e4400000-0000-4000-8000-000000000001','e1000000-0000-4000-8000-000000000001','INV-CONCURRENT-1','invoice','e4000000-0000-4000-8000-000000000001','e4200000-0000-4000-8000-000000000001','2026-08-05',100,5,105,'unpaid','issued','2026-08-05T08:00:00Z'
);

commit;
