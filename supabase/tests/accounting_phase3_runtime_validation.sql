begin;
select set_config('app.accounting_runtime_validation','off',true);

create temporary table accounting_phase3_results(test_name text primary key, passed boolean not null) on commit drop;
grant all on accounting_phase3_results to authenticated, anon;
create or replace function pg_temp.ok(p_name text,p_value boolean) returns void language plpgsql as $$
begin if not coalesce(p_value,false) then raise exception 'PHASE3_TEST_FAILED:%',p_name; end if;
insert into accounting_phase3_results values(p_name,true); end $$;
create or replace function pg_temp.fails(p_name text,p_sql text,p_expected text) returns void language plpgsql as $$
declare m text; begin begin execute p_sql; raise exception 'EXPECTED_ERROR_NOT_RAISED'; exception when others then m:=sqlerrm;
if m='EXPECTED_ERROR_NOT_RAISED' or position(p_expected in m)=0 then raise exception 'PHASE3_TEST_FAILED:% expected:% actual:%',p_name,p_expected,m; end if; end;
insert into accounting_phase3_results values(p_name,true); end $$;

insert into public.tenants(id,name,slug) values
('c1000000-0000-4000-8000-000000000001','Phase 3 Tenant A','phase3-a'),
('c1000000-0000-4000-8000-000000000002','Phase 3 Tenant B','phase3-b');
insert into auth.users(id,email,raw_user_meta_data) values
('c1000000-0000-4000-8000-000000000011','phase3-admin@invalid.local','{"tenant_id":"c1000000-0000-4000-8000-000000000001","role":"admin"}'),
('c1000000-0000-4000-8000-000000000012','phase3-accountant@invalid.local','{"tenant_id":"c1000000-0000-4000-8000-000000000001","role":"accountant"}'),
('c1000000-0000-4000-8000-000000000013','phase3-basic@invalid.local','{"tenant_id":"c1000000-0000-4000-8000-000000000001","role":"technician"}'),
('c1000000-0000-4000-8000-000000000014','phase3-operations@invalid.local','{"tenant_id":"c1000000-0000-4000-8000-000000000001","role":"manager"}'),
('c1000000-0000-4000-8000-000000000021','phase3-other@invalid.local','{"tenant_id":"c1000000-0000-4000-8000-000000000002","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
insert into public.accounting_role_permissions(tenant_id,role,permission_key,granted)
select 'c1000000-0000-4000-8000-000000000001','accountant'::public.app_role,k,true from unnest(array[
 'accounting.view_journal','accounting.manage_accounts','accounting.manage_fiscal_years','accounting.manage_periods',
 'accounting.manage_cost_centers','accounting.manage_mappings','accounting.manage_opening_balances'
]) k;
insert into public.accounting_role_permissions(tenant_id,role,permission_key,granted) values
('c1000000-0000-4000-8000-000000000001','manager'::public.app_role,'accounting.manage_cost_centers',true);
insert into public.accounting_fiscal_years(id,tenant_id,name,start_date,end_date) values
('c2000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','FY 2026','2026-01-01','2026-12-31');
insert into public.accounting_periods(id,tenant_id,fiscal_year_id,name,sequence,start_date,end_date) values
('c2100000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','August',8,'2026-08-01','2026-08-31');
insert into public.accounting_accounts(id,tenant_id,code,name_ar,name_en,account_type,normal_balance,is_postable,is_active) values
('c3000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','1110','الصندوق','Cash','asset','debit',true,true),
('c3000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','1120','البنك','Bank','asset','debit',true,true),
('c3000000-0000-4000-8000-000000000003','c1000000-0000-4000-8000-000000000001','4000','إيراد','Revenue','revenue','credit',true,true),
('c3000000-0000-4000-8000-000000000004','c1000000-0000-4000-8000-000000000001','4010','معطل','Inactive','revenue','credit',true,false);
insert into public.accounting_cost_centers(id,tenant_id,code,name_ar,name_en) values
('c4000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','INS','التأمين','Insurance');
select pg_temp.ok('account_created',count(*)=4) from public.accounting_accounts;
select pg_temp.fails('duplicate_account_code',$$insert into public.accounting_accounts(tenant_id,code,name_ar,name_en,account_type,normal_balance) values('c1000000-0000-4000-8000-000000000001','1110','مكرر','Duplicate','asset','debit')$$,'accounting_accounts_tenant_code_key');
select pg_temp.fails('fiscal_overlap',$$insert into public.accounting_fiscal_years(tenant_id,name,start_date,end_date) values('c1000000-0000-4000-8000-000000000001','Overlap','2026-06-01','2027-05-31')$$,'ACCOUNTING_FISCAL_YEAR_OVERLAP');

insert into public.accounting_account_mappings(id,tenant_id,mapping_key,account_id,priority,status,effective_from,effective_to) values
('c5000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','cash','c3000000-0000-4000-8000-000000000001',100,'active','2026-01-01','2026-12-31');
select pg_temp.fails('mapping_overlap',$$insert into public.accounting_account_mappings(tenant_id,mapping_key,account_id,priority,status,effective_from) values('c1000000-0000-4000-8000-000000000001','cash','c3000000-0000-4000-8000-000000000002',100,'active','2026-06-01')$$,'ACCOUNTING_MAPPING_EFFECTIVE_RANGE_OVERLAP');
select pg_temp.fails('inactive_account_mapping',$$insert into public.accounting_account_mappings(tenant_id,mapping_key,account_id,priority,status) values('c1000000-0000-4000-8000-000000000001','inactive.test','c3000000-0000-4000-8000-000000000004',100,'active')$$,'ACCOUNTING_MAPPING_ACCOUNT_NOT_POSTABLE');

insert into public.accounting_posting_rules(tenant_id,rule_key,source_type,event_type,debit_mapping_key,credit_mapping_key,is_active)
values('c1000000-0000-4000-8000-000000000001','phase3.inactive','insurance_invoice','issued','cash','cash',false);
select pg_temp.fails('posting_rule_activation_blocked',$$update public.accounting_posting_rules set is_active=true where rule_key='phase3.inactive'$$,'ACCOUNTING_POSTING_RULE_ACTIVATION_DEFERRED_PHASE_3');

insert into public.accounting_cash_bank_accounts(id,tenant_id,name_ar,name_en,account_kind,accounting_account_id,is_default) values
('c6000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','الصندوق','Cash','cash','c3000000-0000-4000-8000-000000000001',true),
('c6000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','البنك','Bank','bank','c3000000-0000-4000-8000-000000000002',true);
insert into public.accounting_payment_method_mappings(tenant_id,payment_method,cash_bank_account_id)
values('c1000000-0000-4000-8000-000000000001','cash','c6000000-0000-4000-8000-000000000001');
select pg_temp.ok('cash_bank_setup',count(*)=2) from public.accounting_cash_bank_accounts;

insert into public.accounting_opening_balance_batches(id,tenant_id,fiscal_year_id,batch_number,description) values
('c7000000-0000-4000-8000-000000000001','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','OB-TEST-1','Unbalanced'),
('c7000000-0000-4000-8000-000000000002','c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','OB-TEST-2','Balanced');
insert into public.accounting_opening_balances(tenant_id,fiscal_year_id,batch_id,account_id,debit,credit,source) values
('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000001','c3000000-0000-4000-8000-000000000001',50,0,'fixture'),
('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000001',100,0,'fixture'),
('c1000000-0000-4000-8000-000000000001','c2000000-0000-4000-8000-000000000001','c7000000-0000-4000-8000-000000000002','c3000000-0000-4000-8000-000000000003',0,100,'fixture');
select pg_temp.fails('unbalanced_opening_batch',$$select public.accounting_approve_opening_balance_batch('c7000000-0000-4000-8000-000000000001')$$,'ACCOUNTING_OPENING_BATCH_UNBALANCED');
select pg_temp.ok('balanced_opening_batch_approved',(public.accounting_approve_opening_balance_batch('c7000000-0000-4000-8000-000000000002')).status='approved');

select pg_temp.ok('readiness_auto_posting_off',(public.accounting_setup_readiness()->>'auto_posting')::boolean=false);
select pg_temp.ok('active_rules_zero',(public.accounting_setup_readiness()->>'active_posting_rules')::int=0);
select pg_temp.ok('audit_written',count(*)>0) from public.accounting_audit_logs where tenant_id='c1000000-0000-4000-8000-000000000001';

select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select pg_temp.ok('accountant_authorized',count(*)=2) from public.accounting_cash_bank_accounts;

select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000014","role":"authenticated"}',true);
select pg_temp.ok('operations_scoped_permission',(select count(*)=1 from public.accounting_cost_centers) and (select count(*)=0 from public.accounting_cash_bank_accounts));

select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select pg_temp.ok('basic_hidden',count(*)=0) from public.accounting_cash_bank_accounts;

select set_config('request.jwt.claims','{"sub":"c1000000-0000-4000-8000-000000000021","role":"authenticated"}',true);
select pg_temp.ok('wrong_tenant_hidden',count(*)=0) from public.accounting_cash_bank_accounts;

reset role; set local role anon;
select pg_temp.fails('anonymous_denied',$$select count(*) from public.accounting_cash_bank_accounts$$,'permission denied');
select pg_temp.fails('anonymous_readiness_denied',$$select public.accounting_setup_readiness()$$,'permission denied');

reset role;
select jsonb_build_object('total',count(*),'passed',count(*) filter(where passed),'failed',count(*) filter(where not passed)) as accounting_phase3_runtime_validation from accounting_phase3_results;
rollback;
