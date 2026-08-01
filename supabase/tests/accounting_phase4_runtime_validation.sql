begin;
create temporary table accounting_phase4_results(test_name text primary key,passed boolean not null) on commit drop;
grant all on accounting_phase4_results to authenticated,anon;
create or replace function pg_temp.ok(n text,v boolean) returns void language plpgsql as $$begin if not coalesce(v,false) then raise exception 'PHASE4_TEST_FAILED:%',n;end if;insert into accounting_phase4_results values(n,true);end$$;
create or replace function pg_temp.fails(n text,q text,expected text) returns void language plpgsql as $$declare m text;begin begin execute q;raise exception 'EXPECTED_ERROR_NOT_RAISED';exception when others then m:=sqlerrm;if m='EXPECTED_ERROR_NOT_RAISED' or position(expected in m)=0 then raise exception 'PHASE4_TEST_FAILED:% expected:% actual:%',n,expected,m;end if;end;insert into accounting_phase4_results values(n,true);end$$;

insert into public.tenants(id,name,slug) values
('d1000000-0000-4000-8000-000000000001','Phase 4 Tenant A','phase4-a'),
('d1000000-0000-4000-8000-000000000002','Phase 4 Tenant B','phase4-b');
insert into auth.users(id,email,raw_user_meta_data) values
('d1000000-0000-4000-8000-000000000011','phase4-admin@invalid.local','{"tenant_id":"d1000000-0000-4000-8000-000000000001","role":"admin"}'),
('d1000000-0000-4000-8000-000000000012','phase4-accountant@invalid.local','{"tenant_id":"d1000000-0000-4000-8000-000000000001","role":"accountant"}'),
('d1000000-0000-4000-8000-000000000021','phase4-other@invalid.local','{"tenant_id":"d1000000-0000-4000-8000-000000000002","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
insert into public.accounting_role_permissions(tenant_id,role,permission_key,granted)
select 'd1000000-0000-4000-8000-000000000001','accountant'::public.app_role,k,true from unnest(array[
 'accounting.view_journal','accounting.create_journal','accounting.approve_journal','accounting.post_journal',
 'accounting_reports.view','accounting_reports.journal','accounting_reports.ledger','accounting_reports.trial_balance',
 'accounting_reports.income_statement','accounting_reports.balance_sheet','accounting_reports.cash_flow',
 'accounting_reports.receivables','accounting_reports.payables','accounting_reports.cash_bank','accounting_reports.revenue',
 'accounting_reports.expenses','accounting_reports.vat','accounting_reports.vehicle_profit_loss','accounting_reports.cost_centers',
 'accounting_reports.audit','accounting_reports.export_excel','accounting_reports.export_pdf','accounting_reports.print','accounting_reports.saved_views'
]) k;
insert into public.accounting_fiscal_years(id,tenant_id,name,start_date,end_date,status) values
('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','FY 2026','2026-01-01','2026-12-31','open');
insert into public.accounting_periods(id,tenant_id,fiscal_year_id,name,sequence,start_date,end_date,status) values
('d2100000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001','August',8,'2026-08-01','2026-08-31','open');
insert into public.accounting_accounts(id,tenant_id,code,name_ar,name_en,account_type,normal_balance,is_postable,is_active) values
('d3000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001','1110','الصندوق','Cash','asset','debit',true,true),
('d3000000-0000-4000-8000-000000000002','d1000000-0000-4000-8000-000000000001','4100','إيرادات التأمين','Insurance Revenue','revenue','credit',true,true);

create temporary table phase4_entry(id uuid) on commit drop;
insert into phase4_entry select (public.create_accounting_journal_entry('d2000000-0000-4000-8000-000000000001','d2100000-0000-4000-8000-000000000001','2026-08-01','2026-08-01','manual','اختبار','Test','P4',null,null)).id;
insert into public.accounting_journal_lines(tenant_id,journal_entry_id,line_number,account_id,debit,credit,description) values
('d1000000-0000-4000-8000-000000000001',(select id from phase4_entry),1,'d3000000-0000-4000-8000-000000000001',105,0,'Cash'),
('d1000000-0000-4000-8000-000000000001',(select id from phase4_entry),2,'d3000000-0000-4000-8000-000000000002',0,105,'Revenue');
select public.approve_accounting_journal_entry((select id from phase4_entry));
select public.post_accounting_journal_entry((select id from phase4_entry));

select pg_temp.ok('journal_report_rows',(public.accounting_report_rpc('journal','2026-08-01','2026-08-31',1,50,null,'{}','date','desc')->'pagination'->>'totalRows')::int=1);
select pg_temp.ok('trial_balance_balanced',(public.accounting_report_rpc('trial-balance','2026-08-01','2026-08-31',1,50,null,'{}','date','desc')->'aggregates'->>'balance')::numeric=0);
select pg_temp.ok('revenue_report',(public.accounting_report_rpc('revenue','2026-08-01','2026-08-31',1,50,null,'{}','date','desc')->'pagination'->>'totalRows')::int=1);
select pg_temp.ok('eligibility_deleted_excluded',not public.accounting_report_record_eligible('d1000000-0000-4000-8000-000000000001','issued',now(),null,false));
select pg_temp.ok('eligibility_cancelled_excluded',not public.accounting_report_record_eligible('d1000000-0000-4000-8000-000000000001','cancelled',null,null,false));
select pg_temp.ok('eligibility_archived_excluded',not public.accounting_report_record_eligible('d1000000-0000-4000-8000-000000000001','active',null,now(),true));
select pg_temp.ok('eligibility_active_included',public.accounting_report_record_eligible('d1000000-0000-4000-8000-000000000001','issued',null,null,false));

select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select pg_temp.ok('accountant_report_access',(public.accounting_report_rpc('journal','2026-08-01','2026-08-31',1,50,null,'{}','date','desc')->>'available')::boolean);
insert into public.accounting_report_saved_views(tenant_id,user_id,report_key,name,filters) values('d1000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000012','journal','My View','{"from":"2026-08-01"}');
select pg_temp.ok('saved_view_own',count(*)=1) from public.accounting_report_saved_views;

select set_config('request.jwt.claims','{"sub":"d1000000-0000-4000-8000-000000000021","role":"authenticated"}',true);
select pg_temp.ok('wrong_tenant_report_hidden',(public.accounting_report_rpc('journal','2026-08-01','2026-08-31',1,50,null,'{}','date','desc')->'pagination'->>'totalRows')::int=0);
select pg_temp.ok('wrong_tenant_saved_hidden',count(*)=0) from public.accounting_report_saved_views;

reset role;set local role anon;
select pg_temp.fails('anonymous_report_denied',$$select public.accounting_report_rpc('journal',null,null,1,50,null,'{}','date','desc')$$,'permission denied');
reset role;
select jsonb_build_object('total',count(*),'passed',count(*) filter(where passed)) accounting_phase4_runtime_validation from accounting_phase4_results;
rollback;
