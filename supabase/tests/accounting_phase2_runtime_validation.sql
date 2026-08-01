begin;
select set_config('app.accounting_runtime_validation','on',true);

create temporary table accounting_phase2_results (
  test_name text primary key,
  passed boolean not null,
  details text
) on commit drop;
grant all on accounting_phase2_results to authenticated, anon;

create temporary table accounting_phase2_ids (
  key text primary key,
  id uuid not null
) on commit drop;
grant all on accounting_phase2_ids to authenticated;

create or replace function pg_temp.phase2_assert(p_name text, p_condition boolean, p_details text default null)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'TEST_FAILED: % (%)', p_name, coalesce(p_details, 'condition is false');
  end if;
  insert into accounting_phase2_results values(p_name,true,p_details)
  on conflict(test_name) do update set passed=excluded.passed,details=excluded.details;
end;
$$;

create or replace function pg_temp.phase2_expect_error(p_name text,p_sql text,p_expected text)
returns void language plpgsql as $$
declare v_message text;
begin
  begin
    execute p_sql;
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then
    v_message := sqlerrm;
    if v_message='EXPECTED_ERROR_NOT_RAISED' or position(p_expected in v_message)=0 then
      raise exception 'TEST_FAILED: %, expected %, received %',p_name,p_expected,v_message;
    end if;
  end;
  insert into accounting_phase2_results values(p_name,true,p_expected)
  on conflict(test_name) do update set passed=excluded.passed,details=excluded.details;
end;
$$;

insert into public.tenants(id,name,slug) values
 ('c1000000-0000-4000-8000-000000000001','Accounting Phase 2 A','accounting-phase2-a'),
 ('d1000000-0000-4000-8000-000000000001','Accounting Phase 2 B','accounting-phase2-b');

insert into auth.users(id,email,raw_user_meta_data) values
 ('c1000000-0000-4000-8000-000000000011','phase2-admin-a@runtime.invalid','{"tenant_id":"c1000000-0000-4000-8000-000000000001","full_name":"Phase 2 Admin A","role":"admin"}'),
 ('d1000000-0000-4000-8000-000000000011','phase2-admin-b@runtime.invalid','{"tenant_id":"d1000000-0000-4000-8000-000000000001","full_name":"Phase 2 Admin B","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

insert into public.accounting_fiscal_years(id,tenant_id,name,start_date,end_date)
values('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','FY 2026','2026-01-01','2026-12-31');
insert into public.accounting_periods(id,tenant_id,fiscal_year_id,name,sequence,start_date,end_date)
values('c2100000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','August 2026',8,'2026-08-01','2026-08-31');

insert into public.accounting_accounts(id,tenant_id,code,name_ar,name_en,account_type,normal_balance)
values
 ('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','1100','ذمم عملاء','Customer Receivables','asset','debit'),
 ('c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','1110','ذمم تأمين','Insurance Receivables','asset','debit'),
 ('c3000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','1000','الصندوق','Cash','asset','debit'),
 ('c3000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','1010','البنك','Bank','asset','debit'),
 ('c3000000-0000-4000-8000-000000000005','c1000000-0000-4000-8000-000000000001','1090','حساب تسوية','Payment Clearing','asset','debit'),
 ('c3000000-0000-4000-8000-000000000006','c1000000-0000-4000-8000-000000000001','4100','إيراد كاش','Cash Revenue','revenue','credit'),
 ('c3000000-0000-4000-8000-000000000007','c1000000-0000-4000-8000-000000000001','4200','إيراد تأمين','Insurance Revenue','revenue','credit'),
 ('c3000000-0000-4000-8000-000000000008','c1000000-0000-4000-8000-000000000001','2100','ضريبة مخرجات','Output VAT','liability','credit'),
 ('c3000000-0000-4000-8000-000000000009','c1000000-0000-4000-8000-000000000001','1200','ضريبة مدخلات','Input VAT','asset','debit'),
 ('c3000000-0000-4000-8000-000000000010','c1000000-0000-4000-8000-000000000001','5100','مصروف تشغيلي','Operating Expense','expense','debit');

insert into public.accounting_account_mappings(tenant_id,mapping_key,account_id,priority,status)
values
 ('c1000000-0000-4000-8000-000000000001','cash_customer_receivable','c3000000-0000-4000-8000-000000000001',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','insurance_receivable','c3000000-0000-4000-8000-000000000002',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','cash','c3000000-0000-4000-8000-000000000003',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','bank','c3000000-0000-4000-8000-000000000004',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','payment_clearing','c3000000-0000-4000-8000-000000000005',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','cash_revenue','c3000000-0000-4000-8000-000000000006',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','insurance_revenue','c3000000-0000-4000-8000-000000000007',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','output_vat','c3000000-0000-4000-8000-000000000008',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','input_vat','c3000000-0000-4000-8000-000000000009',100,'active'),
 ('c1000000-0000-4000-8000-000000000001','operating_expense','c3000000-0000-4000-8000-000000000010',100,'active');

insert into public.accounting_posting_rules(
 tenant_id,rule_key,source_type,event_type,debit_mapping_key,credit_mapping_key,is_active,priority,configuration
)
values
 ('c1000000-0000-4000-8000-000000000001','cash-invoice-issue','sales_invoice','issue','cash_customer_receivable','cash_revenue',true,10,
  '{"lines":[{"side":"debit","mapping_key":"$receivable","amount":"total_amount"},{"side":"credit","mapping_key":"$revenue","amount":"net_amount"},{"side":"credit","mapping_key":"output_vat","amount":"vat_amount"}]}'::jsonb),
 ('c1000000-0000-4000-8000-000000000001','insurance-invoice-issue','insurance_invoice','issue','insurance_receivable','insurance_revenue',true,10,
  '{"lines":[{"side":"debit","mapping_key":"$receivable","amount":"total_amount"},{"side":"credit","mapping_key":"$revenue","amount":"net_amount"},{"side":"credit","mapping_key":"output_vat","amount":"vat_amount"}]}'::jsonb),
 ('c1000000-0000-4000-8000-000000000001','sales-payment-clear','sales_payment','clear','cash','cash_customer_receivable',true,10,
  '{"lines":[{"side":"debit","mapping_key":"$payment_account","amount":"amount"},{"side":"credit","mapping_key":"$receivable","amount":"amount"}]}'::jsonb),
 ('c1000000-0000-4000-8000-000000000001','claim-payment-clear','claim_payment','clear','bank','insurance_receivable',true,10,
  '{"lines":[{"side":"debit","mapping_key":"$payment_account","amount":"amount"},{"side":"credit","mapping_key":"$receivable","amount":"amount"}]}'::jsonb),
 ('c1000000-0000-4000-8000-000000000001','expense-recognize','expense','recognize','operating_expense','cash',true,10,
  '{"lines":[{"side":"debit","mapping_key":"$expense_account","amount":"net_amount"},{"side":"debit","mapping_key":"input_vat","amount":"vat_amount"},{"side":"credit","mapping_key":"$payment_account","amount":"total_amount"}]}'::jsonb);

reset role;
insert into public.customers(id,tenant_id,name) values
 ('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','Phase 2 Customer');
insert into public.vehicles(id,tenant_id,customer_id,plate_number,brand,model) values
 ('c4100000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','PHASE2-1','Test','Vehicle');
insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number) values
 ('c4200000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4100000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','WO-PHASE2-1');
insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,job_order_id,claim_number,insurance_company,status) values
 ('c4300000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4000000-0000-4000-8000-000000000001','c4100000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000001','CLAIM-PHASE2-1','Runtime Insurance','approved');
insert into public.sales_documents(
 id,tenant_id,doc_number,doc_type,customer_id,work_order_id,date,subtotal,tax_total,total,status,invoice_status,issued_at
) values (
 'c4400000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','INV-PHASE2-1','invoice','c4000000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000001','2026-08-01',100,5,105,'unpaid','issued','2026-08-01T08:00:00Z'
);
insert into public.sales_documents(
 id,tenant_id,doc_number,doc_type,customer_id,work_order_id,date,subtotal,tax_total,total,status,invoice_status
) values (
 'c4400000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','INV-PHASE2-DRAFT','invoice','c4000000-0000-4000-8000-000000000001','c4200000-0000-4000-8000-000000000001','2026-08-01',100,5,105,'draft','draft'
);
insert into public.insurance_invoices(
 id,tenant_id,claim_id,invoice_number,insurance_company_name,invoice_date,subtotal,vat,total,status
) values (
 'c4500000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4300000-0000-4000-8000-000000000001','IINV-PHASE2-1','Runtime Insurance','2026-08-01',1200,60,1260,'issued'
);
insert into public.sales_payments(id,tenant_id,sales_document_id,payment_number,date,amount,method)
values('c4600000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4400000-0000-4000-8000-000000000001','SPAY-PHASE2-1','2026-08-02',50,'cash');
insert into public.claim_payments(id,tenant_id,claim_id,offset_against_invoice_id,payment_number,payment_date,amount,payment_method,status)
values('c4700000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c4300000-0000-4000-8000-000000000001','c4500000-0000-4000-8000-000000000001','CPAY-PHASE2-1','2026-08-02',600,'bank_transfer','cleared');
insert into public.expenses(id,tenant_id,voucher_number,date,subtotal,vat_amount,total,amount,payment_method,expense_type,linked_work_order_id)
values('c4800000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','EXP-PHASE2-1','2026-08-03',50,2.5,52.5,52.5,'cash','Workshop General Expense','c4200000-0000-4000-8000-000000000001');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);

select pg_temp.phase2_assert('app_versions_schema_aligned',to_regclass('public.app_versions') is not null);
select pg_temp.phase2_assert('preview_is_read_only',(
  select before_count=(select count(*) from public.accounting_journal_entries)
  from (select count(*) before_count from public.accounting_journal_entries) q,
       lateral (select public.preview_accounting_source_posting('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01')) p
));
select pg_temp.phase2_assert('cash_invoice_preview_balanced',(
  select (p->>'balanced')::boolean and (p->>'total_debit')::numeric=105 and jsonb_array_length(p->'lines')=3
  from (select public.preview_accounting_source_posting('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01') p) s
));
select pg_temp.phase2_assert('insurance_invoice_preview_balanced',(
  select (p->>'total_debit')::numeric=1260 and (p->>'total_credit')::numeric=1260
  from (select public.preview_accounting_source_posting('insurance_invoice','c4500000-0000-4000-8000-000000000001','issue','2026-08-01') p) s
));
select pg_temp.phase2_assert('expense_preview_balanced',(
  select (p->>'total_debit')::numeric=52.5 and jsonb_array_length(p->'lines')=3
  from (select public.preview_accounting_source_posting('expense','c4800000-0000-4000-8000-000000000001','recognize','2026-08-03') p) s
));
select pg_temp.phase2_expect_error('draft_invoice_not_postable',
  $$select public.preview_accounting_source_posting('sales_invoice','c4400000-0000-4000-8000-000000000002','issue','2026-08-01')$$,
  'ACCOUNTING_SOURCE_NOT_POSTABLE');

insert into accounting_phase2_ids(key,id)
select 'cash_invoice',(public.post_accounting_source('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01','phase2-cash-invoice-1')).id;
select pg_temp.phase2_assert('cash_invoice_posted',(
 select status='posted' from public.accounting_journal_entries where id=(select id from accounting_phase2_ids where key='cash_invoice')
));
select pg_temp.phase2_assert('cash_invoice_lines_balanced',(
 select sum(debit)=105 and sum(credit)=105 and count(*)=3
 from public.accounting_journal_lines where journal_entry_id=(select id from accounting_phase2_ids where key='cash_invoice')
));
select pg_temp.phase2_assert('idempotency_same_key_same_journal',
 (public.post_accounting_source('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01','phase2-cash-invoice-1')).id=(select id from accounting_phase2_ids where key='cash_invoice'));
select pg_temp.phase2_assert('different_key_same_source_no_duplicate',
 (public.post_accounting_source('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01','phase2-cash-invoice-2')).id=(select id from accounting_phase2_ids where key='cash_invoice'));
select pg_temp.phase2_assert('one_primary_source_link',(
 select count(*)=1 from public.accounting_source_links where tenant_id='c1000000-0000-4000-8000-000000000001' and source_type='sales_invoice' and source_id='c4400000-0000-4000-8000-000000000001' and is_primary
));
select pg_temp.phase2_expect_error('idempotency_key_conflict',
 $$select public.post_accounting_source('sales_invoice','c4400000-0000-4000-8000-000000000002','issue','2026-08-01','phase2-cash-invoice-1')$$,
 'ACCOUNTING_IDEMPOTENCY_KEY_CONFLICT');

insert into accounting_phase2_ids(key,id)
select 'insurance_invoice',(public.post_accounting_source('insurance_invoice','c4500000-0000-4000-8000-000000000001','issue','2026-08-01','phase2-insurance-invoice-1')).id;
insert into accounting_phase2_ids(key,id)
select 'sales_payment',(public.post_accounting_source('sales_payment','c4600000-0000-4000-8000-000000000001','clear','2026-08-02','phase2-sales-payment-1')).id;
insert into accounting_phase2_ids(key,id)
select 'claim_payment',(public.post_accounting_source('claim_payment','c4700000-0000-4000-8000-000000000001','clear','2026-08-02','phase2-claim-payment-1')).id;
insert into accounting_phase2_ids(key,id)
select 'expense',(public.post_accounting_source('expense','c4800000-0000-4000-8000-000000000001','recognize','2026-08-03','phase2-expense-1')).id;

select pg_temp.phase2_assert('all_requested_sources_posted',(
 select count(*)=5 and bool_and(status='posted')
 from public.accounting_journal_entries where id in (select id from accounting_phase2_ids)
));
select pg_temp.phase2_assert('actual_payments_two_lines_each',(
 select count(*)=4 and sum(debit)=650 and sum(credit)=650
 from public.accounting_journal_lines where journal_entry_id in (
  (select id from accounting_phase2_ids where key='sales_payment'),
  (select id from accounting_phase2_ids where key='claim_payment')
 )
));

insert into accounting_phase2_ids(key,id)
select 'reversal',(public.reverse_accounting_source_posting('sales_invoice','c4400000-0000-4000-8000-000000000001','2026-08-04','Phase 2 reversal')).id;
select pg_temp.phase2_assert('source_reversal_posted',(
 select status='posted' and entry_type='reversal' from public.accounting_journal_entries where id=(select id from accounting_phase2_ids where key='reversal')
));
select pg_temp.phase2_assert('source_original_marked_reversed',(
 select status='reversed' from public.accounting_journal_entries where id=(select id from accounting_phase2_ids where key='cash_invoice')
));
select pg_temp.phase2_expect_error('duplicate_source_reversal_blocked',
 $$select public.reverse_accounting_source_posting('sales_invoice','c4400000-0000-4000-8000-000000000001','2026-08-04','Duplicate')$$,
 'ACCOUNTING_SOURCE_POSTING_NOT_FOUND');

reset role;
update public.job_orders set deleted_at=now() where id='c4200000-0000-4000-8000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select pg_temp.phase2_assert('deleted_parent_expense_excluded',not public.is_accounting_source_eligible(
 'c1000000-0000-4000-8000-000000000001','expense','c4800000-0000-4000-8000-000000000001'
));

select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select pg_temp.phase2_expect_error('wrong_tenant_source_denied',
 $$select public.preview_accounting_source_posting('insurance_invoice','c4500000-0000-4000-8000-000000000001','issue','2026-08-01')$$,
 'ACCOUNTING_SOURCE_INELIGIBLE');

reset role;
set local role anon;
select pg_temp.phase2_expect_error('anonymous_preview_denied',
 $$select public.preview_accounting_source_posting('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01')$$,
 'permission denied');
select pg_temp.phase2_expect_error('anonymous_post_denied',
 $$select public.post_accounting_source('sales_invoice','c4400000-0000-4000-8000-000000000001','issue','2026-08-01','anon')$$,
 'permission denied');

reset role;
select pg_temp.phase2_assert('no_source_table_posting_triggers',not exists(
 select 1
 from pg_trigger t
 join pg_class c on c.oid=t.tgrelid
 join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relname in ('sales_documents','invoices','insurance_invoices','sales_payments','claim_payments','expenses')
   and not t.tgisinternal
   and pg_get_triggerdef(t.oid) ilike '%accounting%post%'
));
select pg_temp.phase2_assert('posting_requests_rls_enabled',(
 select relrowsecurity from pg_class where oid='public.accounting_posting_requests'::regclass
));
select pg_temp.phase2_assert('posting_audit_written',(
 select count(*) >= 6 from public.accounting_audit_logs where tenant_id='c1000000-0000-4000-8000-000000000001' and action in ('source.post','source.reverse')
));

select jsonb_build_object(
 'total',count(*),
 'passed',count(*) filter(where passed),
 'failed',count(*) filter(where not passed),
 'tests',jsonb_agg(jsonb_build_object('name',test_name,'result',case when passed then 'PASS' else 'FAIL' end,'details',details) order by test_name)
) as accounting_phase2_runtime_validation
from accounting_phase2_results;

rollback;
