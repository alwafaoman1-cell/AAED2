begin;

create temporary table accounting_runtime_results (
  test_name text primary key,
  passed boolean not null,
  details text
) on commit drop;
grant all on accounting_runtime_results to authenticated, anon;

create temporary table accounting_runtime_ids (
  key text primary key,
  id uuid not null
) on commit drop;
grant all on accounting_runtime_ids to authenticated;

create or replace function pg_temp.assert_true(p_name text, p_condition boolean, p_details text default null)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'TEST_FAILED: % (%)', p_name, coalesce(p_details, 'condition is false');
  end if;
  insert into accounting_runtime_results values (p_name, true, p_details)
  on conflict (test_name) do update set passed = excluded.passed, details = excluded.details;
end;
$$;

create or replace function pg_temp.expect_error(p_name text, p_sql text, p_expected text)
returns void language plpgsql as $$
declare v_message text;
begin
  begin
    execute p_sql;
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then
    v_message := sqlerrm;
    if v_message = 'EXPECTED_ERROR_NOT_RAISED' or position(p_expected in v_message) = 0 then
      raise exception 'TEST_FAILED: %, expected %, received %', p_name, p_expected, v_message;
    end if;
  end;
  insert into accounting_runtime_results values (p_name, true, p_expected)
  on conflict (test_name) do update set passed = excluded.passed, details = excluded.details;
end;
$$;

-- Stable fixture identifiers. Everything remains inside this transaction and is rolled back.
insert into public.tenants(id, name, slug) values
  ('a1000000-0000-0000-0000-000000000001', 'Accounting Runtime A', 'accounting-runtime-a'),
  ('b1000000-0000-0000-0000-000000000001', 'Accounting Runtime B', 'accounting-runtime-b');

insert into auth.users(id, email, raw_user_meta_data) values
  ('a1000000-0000-0000-0000-000000000011', 'admin-a@runtime.invalid', '{"tenant_id":"a1000000-0000-0000-0000-000000000001","full_name":"Admin A","role":"admin"}'),
  ('a1000000-0000-0000-0000-000000000012', 'manager-a@runtime.invalid', '{"tenant_id":"a1000000-0000-0000-0000-000000000001","full_name":"Manager A","role":"manager"}'),
  ('a1000000-0000-0000-0000-000000000013', 'tech-a@runtime.invalid', '{"tenant_id":"a1000000-0000-0000-0000-000000000001","full_name":"Tech A","role":"technician"}'),
  ('b1000000-0000-0000-0000-000000000011', 'admin-b@runtime.invalid', '{"tenant_id":"b1000000-0000-0000-0000-000000000001","full_name":"Admin B","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000011","role":"authenticated"}', true);

insert into public.accounting_role_permissions(tenant_id, role, permission_key, granted)
select 'a1000000-0000-0000-0000-000000000001', 'manager'::public.app_role, permission_key, true
from unnest(array[
  'accounting.view_journal','accounting.manage_accounts','accounting.manage_fiscal_years',
  'accounting.manage_periods','accounting.manage_cost_centers','accounting.create_journal',
  'accounting.approve_journal','accounting.post_journal','accounting.reverse_journal',
  'accounting.manage_mappings','accounting.manage_opening_balances'
]) permission_key;

insert into public.accounting_fiscal_years(id, tenant_id, name, start_date, end_date)
values ('a2000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'FY 2026', '2026-01-01', '2026-12-31');
insert into public.accounting_periods(id, tenant_id, fiscal_year_id, name, sequence, start_date, end_date)
values ('a2100000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'a2000000-0000-0000-0000-000000000001', 'August 2026', 8, '2026-08-01', '2026-08-31');

insert into public.accounting_accounts(id, tenant_id, code, name_ar, name_en, account_type, normal_balance, is_postable)
values
  ('a3000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', '1000', 'النقدية', 'Cash', 'asset', 'debit', true),
  ('a3000000-0000-0000-0000-000000000002', 'a1000000-0000-0000-0000-000000000001', '4000', 'الإيرادات', 'Revenue', 'revenue', 'credit', true),
  ('a3000000-0000-0000-0000-000000000003', 'a1000000-0000-0000-0000-000000000001', '1100', 'أصول', 'Assets', 'asset', 'debit', false),
  ('a3000000-0000-0000-0000-000000000004', 'a1000000-0000-0000-0000-000000000001', '1110', 'أصول متداولة', 'Current Assets', 'asset', 'debit', false);
update public.accounting_accounts set parent_id='a3000000-0000-0000-0000-000000000003'
where id='a3000000-0000-0000-0000-000000000004';
select pg_temp.assert_true('account_tree_level', (select level=2 from public.accounting_accounts where id='a3000000-0000-0000-0000-000000000004'));
select pg_temp.expect_error('account_tree_cycle', $$update public.accounting_accounts set parent_id='a3000000-0000-0000-0000-000000000004' where id='a3000000-0000-0000-0000-000000000003'$$, 'ACCOUNTING_ACCOUNT_TREE_CYCLE');
select pg_temp.expect_error('fiscal_year_overlap', $$insert into public.accounting_fiscal_years(tenant_id,name,start_date,end_date) values('a1000000-0000-0000-0000-000000000001','Overlap','2026-06-01','2027-05-31')$$, 'ACCOUNTING_FISCAL_YEAR_OVERLAP');
select pg_temp.expect_error('period_outside_year', $$insert into public.accounting_periods(tenant_id,fiscal_year_id,name,sequence,start_date,end_date) values('a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','Outside',9,'2026-12-15','2027-01-15')$$, 'ACCOUNTING_PERIOD_OUTSIDE_FISCAL_YEAR');

insert into public.accounting_account_mappings(tenant_id,mapping_key,account_id,priority,status)
values('a1000000-0000-0000-0000-000000000001','cash.default','a3000000-0000-0000-0000-000000000001',100,'active');
select pg_temp.assert_true('mapping_resolution', public.resolve_accounting_account_mapping('cash.default')='a3000000-0000-0000-0000-000000000001');
select pg_temp.expect_error('mapping_missing', $$select public.resolve_accounting_account_mapping('missing.key')$$, 'ACCOUNTING_MAPPING_NOT_FOUND');

insert into public.accounting_opening_balances(tenant_id,fiscal_year_id,account_id,debit,credit,source)
values('a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000001',100,0,'runtime');
select pg_temp.assert_true('opening_balance_saved', exists(select 1 from public.accounting_opening_balances where debit=100.000 and status='draft'));
select pg_temp.expect_error('opening_balance_invalid_amount', $$insert into public.accounting_opening_balances(tenant_id,fiscal_year_id,account_id,debit,credit) values('a1000000-0000-0000-0000-000000000001','a2000000-0000-0000-0000-000000000001','a3000000-0000-0000-0000-000000000002',100,100)$$, 'accounting_opening_balances_amount_check');

select pg_temp.expect_error('direct_non_draft_insert', $$insert into public.accounting_journal_entries(tenant_id,entry_number,accounting_date,fiscal_year_id,accounting_period_id,status) values('a1000000-0000-0000-0000-000000000001','ILLEGAL-1','2026-08-01','a2000000-0000-0000-0000-000000000001','a2100000-0000-0000-0000-000000000001','posted')$$, 'ACCOUNTING_DIRECT_NON_DRAFT_INSERT_FORBIDDEN');

insert into accounting_runtime_ids(key,id)
select 'entry', (public.create_accounting_journal_entry(
  'a2000000-0000-0000-0000-000000000001','a2100000-0000-0000-0000-000000000001','2026-08-01',
  '2026-08-01','manual','قيد اختبار','Runtime entry','RUNTIME-1','manual_journal','runtime-1'
)).id;
insert into public.accounting_journal_lines(tenant_id,journal_entry_id,account_id,line_number,debit,credit)
values
 ('a1000000-0000-0000-0000-000000000001', (select id from accounting_runtime_ids where key='entry'), 'a3000000-0000-0000-0000-000000000001', 1, 100, 0),
 ('a1000000-0000-0000-0000-000000000001', (select id from accounting_runtime_ids where key='entry'), 'a3000000-0000-0000-0000-000000000002', 2, 0, 100);
select pg_temp.assert_true('journal_created_as_draft', (select status='draft' from public.accounting_journal_entries where id=(select id from accounting_runtime_ids where key='entry')));
select pg_temp.assert_true('journal_approved', (public.approve_accounting_journal_entry((select id from accounting_runtime_ids where key='entry'))).status='approved');
select pg_temp.assert_true('journal_posted', (public.post_accounting_journal_entry((select id from accounting_runtime_ids where key='entry'))).status='posted');
select pg_temp.expect_error('duplicate_posting_blocked', format('select public.post_accounting_journal_entry(%L::uuid)', (select id from accounting_runtime_ids where key='entry')), 'ACCOUNTING_ENTRY_STATUS_INVALID');
select pg_temp.expect_error('posted_entry_update_blocked', format('update public.accounting_journal_entries set reference=''changed'' where id=%L::uuid', (select id from accounting_runtime_ids where key='entry')), 'ACCOUNTING_POSTED_ENTRY_IMMUTABLE');
select pg_temp.expect_error('posted_line_delete_blocked', format('delete from public.accounting_journal_lines where journal_entry_id=%L::uuid', (select id from accounting_runtime_ids where key='entry')), 'ACCOUNTING_POSTED_LINES_IMMUTABLE');

insert into accounting_runtime_ids(key,id)
select 'reversal', (public.reverse_accounting_journal_entry((select id from accounting_runtime_ids where key='entry'),'2026-08-02','Runtime reversal')).id;
select pg_temp.assert_true('reversal_posted', (select status='posted' and description_ar=('عكس القيد '||(select entry_number from public.accounting_journal_entries where id=(select id from accounting_runtime_ids where key='entry'))) from public.accounting_journal_entries where id=(select id from accounting_runtime_ids where key='reversal')));
select pg_temp.assert_true('original_marked_reversed', (select status='reversed' from public.accounting_journal_entries where id=(select id from accounting_runtime_ids where key='entry')));
select pg_temp.assert_true('reversal_balanced', (select sum(debit)=sum(credit) and sum(debit)=100.000 from public.accounting_journal_lines where journal_entry_id=(select id from accounting_runtime_ids where key='reversal')));
select pg_temp.assert_true('audit_log_written', (select count(*) >= 10 from public.accounting_audit_logs where tenant_id='a1000000-0000-0000-0000-000000000001'));

-- Unbalanced journals cannot be approved.
insert into accounting_runtime_ids(key,id)
select 'unbalanced', (public.create_accounting_journal_entry('a2000000-0000-0000-0000-000000000001','a2100000-0000-0000-0000-000000000001','2026-08-03')).id;
insert into public.accounting_journal_lines(tenant_id,journal_entry_id,account_id,line_number,debit,credit)
values('a1000000-0000-0000-0000-000000000001',(select id from accounting_runtime_ids where key='unbalanced'),'a3000000-0000-0000-0000-000000000001',1,50,0);
select pg_temp.expect_error('unbalanced_entry_blocked', format('select public.approve_accounting_journal_entry(%L::uuid)', (select id from accounting_runtime_ids where key='unbalanced')), 'ACCOUNTING_ENTRY_UNBALANCED');

-- Authorized role can read and create; ungranted role cannot.
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000012","role":"authenticated"}', true);
select pg_temp.assert_true('authorized_role_read', (select count(*)=4 from public.accounting_accounts));
select pg_temp.assert_true('authorized_role_rpc', public.next_accounting_journal_number('a2000000-0000-0000-0000-000000000001') like 'JE-2026-%');

select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000013","role":"authenticated"}', true);
select pg_temp.assert_true('unauthorized_role_hidden', (select count(*)=0 from public.accounting_accounts));
select pg_temp.expect_error('unauthorized_role_rpc', $$select public.next_accounting_journal_number('a2000000-0000-0000-0000-000000000001')$$, 'ACCOUNTING_PERMISSION_DENIED');

reset role;
-- Build an isolated tenant-B record, then prove tenant A and tenant B cannot see each other.
insert into public.accounting_fiscal_years(id,tenant_id,name,start_date,end_date) values('b2000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','FY 2026','2026-01-01','2026-12-31');
insert into public.accounting_accounts(id,tenant_id,code,name_ar,name_en,account_type,normal_balance) values('b3000000-0000-0000-0000-000000000001','b1000000-0000-0000-0000-000000000001','1000','نقدية ب','Cash B','asset','debit');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"b1000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select pg_temp.assert_true('wrong_tenant_isolation', (select count(*)=1 and bool_and(tenant_id='b1000000-0000-0000-0000-000000000001'::uuid) from public.accounting_accounts));

reset role;
-- Operational source eligibility and deleted/cancelled parent rules.
insert into public.customers(id,tenant_id,name) values('a4000000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','Runtime Customer');
insert into public.vehicles(id,tenant_id,customer_id,plate_number,brand,model) values('a4100000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','RUNTIME-1','Test','Vehicle');
insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number) values('a4200000-0000-4000-8000-000000000001','a1000000-0000-0000-0000-000000000001','a4100000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','WO-RUNTIME-1');
insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,insurance_company) values('a4300000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a4000000-0000-0000-0000-000000000001','a4100000-0000-0000-0000-000000000001','CLAIM-RUNTIME-1','Runtime Insurance');
insert into public.sales_documents(id,tenant_id,doc_number,customer_id,work_order_id,subtotal,total,status) values('a4400000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','INV-RUNTIME-1','a4000000-0000-0000-0000-000000000001','a4200000-0000-4000-8000-000000000001'::text,100,105,'issued');
insert into public.expenses(id,tenant_id,voucher_number,amount,subtotal,vat_amount,total,linked_work_order_id) values('a4500000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','EXP-RUNTIME-1',52.5,50,2.5,52.5,'a4200000-0000-4000-8000-000000000001');
insert into public.claim_payments(id,tenant_id,claim_id,payment_number,amount,status) values('a4600000-0000-0000-0000-000000000001','a1000000-0000-0000-0000-000000000001','a4300000-0000-0000-0000-000000000001','PAY-RUNTIME-1',10,'cleared');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select pg_temp.assert_true('active_invoice_eligible', public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','sales_invoice','a4400000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('active_expense_eligible', public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','expense','a4500000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('active_payment_eligible', public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','claim_payment','a4600000-0000-0000-0000-000000000001'));
reset role;
update public.sales_documents set deleted_at=now() where id='a4400000-0000-0000-0000-000000000001';
update public.expenses set deleted_at=now() where id='a4500000-0000-0000-0000-000000000001';
update public.job_orders set deleted_at=now() where id='a4200000-0000-4000-8000-000000000001';
update public.insurance_claims set status='cancelled' where id='a4300000-0000-0000-0000-000000000001';
update public.claim_payments set status='bounced' where id='a4600000-0000-0000-0000-000000000001';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"a1000000-0000-0000-0000-000000000011","role":"authenticated"}', true);
select pg_temp.assert_true('deleted_invoice_excluded', not public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','sales_invoice','a4400000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('deleted_expense_excluded', not public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','expense','a4500000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('deleted_work_order_excluded', not public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','work_order','a4200000-0000-4000-8000-000000000001'));
select pg_temp.assert_true('cancelled_claim_excluded', not public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','claim','a4300000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('bounced_payment_excluded', not public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','claim_payment','a4600000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('child_of_deleted_parent_excluded', not public.is_accounting_source_eligible('a1000000-0000-0000-0000-000000000001','sales_invoice','a4400000-0000-0000-0000-000000000001'));
select pg_temp.assert_true('cross_tenant_eligibility_denied', not public.is_accounting_source_eligible('b1000000-0000-0000-0000-000000000001','customer','a4000000-0000-0000-0000-000000000001'));

reset role;
set local role anon;
select pg_temp.expect_error('anonymous_table_denied', $$select count(*) from public.accounting_accounts$$, 'permission denied');
select pg_temp.expect_error('anonymous_rpc_denied', $$select public.next_accounting_journal_number('a2000000-0000-0000-0000-000000000001')$$, 'permission denied');
select pg_temp.expect_error('anonymous_receipts_denied', $$select count(*) from public.accounting_receipts$$, 'permission denied');
select pg_temp.expect_error('anonymous_claims_view_denied', $$select count(*) from public.accounting_claims_summary_view$$, 'permission denied');
select pg_temp.expect_error('anonymous_profit_view_denied', $$select count(*) from public.accounting_work_order_profit_view$$, 'permission denied');

reset role;
select pg_temp.assert_true('required_indexes_present', (
  select count(*) >= 12 from pg_indexes
  where schemaname='public' and indexname in (
    'accounting_accounts_parent_idx','accounting_fiscal_years_dates_idx',
    'accounting_periods_dates_idx','accounting_journal_entries_date_idx',
    'accounting_journal_entries_status_date_idx','accounting_journal_lines_entry_idx',
    'accounting_journal_lines_account_idx','accounting_source_links_entry_idx',
    'accounting_source_links_source_idx','accounting_audit_entity_idx',
    'accounting_audit_time_idx','accounting_mappings_lookup_idx'
  )
));

select jsonb_build_object(
  'total', count(*),
  'passed', count(*) filter (where passed),
  'failed', count(*) filter (where not passed),
  'tests', jsonb_agg(jsonb_build_object('name',test_name,'result',case when passed then 'PASS' else 'FAIL' end,'details',details) order by test_name)
) as accounting_phase1b_runtime_validation
from accounting_runtime_results;

rollback;
