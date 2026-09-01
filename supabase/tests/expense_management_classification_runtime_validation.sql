begin;
create temporary table expense_runtime_results(test_name text primary key,passed boolean not null,details text) on commit drop;
grant all on expense_runtime_results to authenticated,anon;
create or replace function pg_temp.assert_true(n text,c boolean,d text default null) returns void language plpgsql as $$begin if not coalesce(c,false) then raise exception 'TEST_FAILED: % (%)',n,coalesce(d,'false'); end if; insert into expense_runtime_results values(n,true,d); end$$;
create or replace function pg_temp.expect_error(n text,s text,e text) returns void language plpgsql as $$declare m text;begin begin execute s;raise exception 'EXPECTED_ERROR_NOT_RAISED';exception when others then m:=sqlerrm;if m='EXPECTED_ERROR_NOT_RAISED' or position(e in m)=0 then raise exception 'TEST_FAILED: %, expected %, got %',n,e,m;end if;end;insert into expense_runtime_results values(n,true,e);end$$;

insert into public.tenants(id,name,slug) values
 ('e9000000-0000-4000-8000-000000000001','Expense Runtime A','expense-runtime-a'),
 ('e9000000-0000-4000-8000-000000000002','Expense Runtime B','expense-runtime-b');
insert into auth.users(id,email,raw_user_meta_data) values
 ('e9000000-0000-4000-8000-000000000011','expense-admin@runtime.invalid','{"tenant_id":"e9000000-0000-4000-8000-000000000001","full_name":"Admin","role":"admin"}'),
 ('e9000000-0000-4000-8000-000000000012','expense-manager@runtime.invalid','{"tenant_id":"e9000000-0000-4000-8000-000000000001","full_name":"Manager","role":"manager"}'),
 ('e9000000-0000-4000-8000-000000000013','expense-tech@runtime.invalid','{"tenant_id":"e9000000-0000-4000-8000-000000000001","full_name":"Tech","role":"technician"}'),
 ('e9000000-0000-4000-8000-000000000021','expense-admin-b@runtime.invalid','{"tenant_id":"e9000000-0000-4000-8000-000000000002","full_name":"Admin B","role":"admin"}');

set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select public.apply_default_expense_category_template();
select pg_temp.assert_true(
  'template_applied',
  (select count(*) from public.expense_categories) =
  (select count(*) from public.expense_category_template_items)
);
select pg_temp.assert_true('template_has_complete_baseline',(select count(*)>=116 from public.expense_categories));
select pg_temp.assert_true('template_has_subcategories',(select count(*)>0 from public.expense_categories where level=3 and category_type='subcategory'));
select pg_temp.assert_true('template_has_thirteen_departments',(select count(*)=13 from public.expense_categories where level=1 and category_type='department'));
select pg_temp.assert_true('fines_nested_under_government',(select count(*)=1 from public.expense_categories fines join public.expense_categories gov on gov.id=fines.parent_id and gov.tenant_id=fines.tenant_id where fines.code='FINES' and fines.level=2 and fines.category_type='category' and gov.code='GOV'));
select pg_temp.assert_true('template_bilingual',(select bool_and(name_ar<>'' and name_en<>'') from public.expense_categories));
select pg_temp.assert_true('category_audit_written',(select count(*)>40 from public.expense_category_audit_logs));
select pg_temp.assert_true('template_no_auto_expenses',(select count(*)=0 from public.expenses));

insert into public.customers(id,tenant_id,name) values('e9000000-0000-4000-8000-000000000101','e9000000-0000-4000-8000-000000000001','Runtime Customer');
insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,brand,model) values('e9000000-0000-4000-8000-000000000102','e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000101','98765','A','Test','Car');
insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,order_number,work_order_type) values
 ('e9000000-0000-4000-8000-000000000103','e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000102','e9000000-0000-4000-8000-000000000101','WO-EXP-RUNTIME','general_customer');

insert into public.expenses(id,tenant_id,voucher_number,date,amount,subtotal,vat_amount,total,description,expense_scope,work_order_id,linked_work_order_id,department_id,expense_category_id,payment_method)
select 'e9000000-0000-4000-8000-000000000104','e9000000-0000-4000-8000-000000000001','EXP-RUNTIME-1',current_date,100,100,5,105,'parts',
 'work_order','e9000000-0000-4000-8000-000000000103',null,d.id,c.id,'cash'
from public.expense_categories d join public.expense_categories c on c.parent_id=d.id where d.code='PARTS' and c.code='PARTS_NEW';
select pg_temp.assert_true('work_order_derived',(select e.classification_status='classified' and e.work_order_channel='cash' and e.linked_work_order_id=j.order_number and e.vehicle_id='e9000000-0000-4000-8000-000000000102' from public.expenses e join public.job_orders j on j.id=e.work_order_id where e.voucher_number='EXP-RUNTIME-1'));
select pg_temp.assert_true('vat_unchanged',(select subtotal=100 and vat_amount=5 and total=105 from public.expenses where voucher_number='EXP-RUNTIME-1'));

insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,insurance_company,status) values
 ('e9000000-0000-4000-8000-000000000106','e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000101','e9000000-0000-4000-8000-000000000102','CLAIM-EXP-RUNTIME','Runtime Insurance','approved');
insert into public.job_orders(id,tenant_id,vehicle_id,customer_id,claim_id,order_number,work_order_type) values
 ('e9000000-0000-4000-8000-000000000107','e9000000-0000-4000-8000-000000000001','e9000000-0000-4000-8000-000000000102','e9000000-0000-4000-8000-000000000101','e9000000-0000-4000-8000-000000000106','WO-INS-EXP-RUNTIME','insurance');
insert into public.expenses(id,tenant_id,voucher_number,date,amount,subtotal,vat_amount,total,description,expense_scope,work_order_id,department_id,expense_category_id,payment_method)
select 'e9000000-0000-4000-8000-000000000108','e9000000-0000-4000-8000-000000000001','EXP-INS-RUNTIME',current_date,200,200,10,210,'insurance parts',
 'work_order','e9000000-0000-4000-8000-000000000107',d.id,c.id,'bank'
from public.expense_categories d join public.expense_categories c on c.parent_id=d.id where d.code='PARTS' and c.code='PARTS_NEW';
select pg_temp.assert_true('insurance_work_order_derived',(select work_order_channel='insurance' and claim_id='e9000000-0000-4000-8000-000000000106' and vehicle_id='e9000000-0000-4000-8000-000000000102' and customer_id='e9000000-0000-4000-8000-000000000101' from public.expenses where voucher_number='EXP-INS-RUNTIME'));

insert into public.expenses(id,tenant_id,voucher_number,date,amount,subtotal,vat_amount,total,description,expense_scope,department_id,expense_category_id,payment_method)
select 'e9000000-0000-4000-8000-000000000109','e9000000-0000-4000-8000-000000000001','EXP-OPERATING-RUNTIME',current_date,30,30,0,30,'office expense',
 'operating',d.id,c.id,'cash'
from public.expense_categories d join public.expense_categories c on c.parent_id=d.id where d.code='ADMIN' and c.code='ADMIN_OTHER';
select pg_temp.assert_true('operating_without_work_order',(select work_order_id is null and vehicle_id is null and claim_id is null and work_order_channel is null from public.expenses where voucher_number='EXP-OPERATING-RUNTIME'));
select pg_temp.assert_true('vehicle_pnl_cash_and_insurance',(select count(*)=2 from public.reports_expense_facts_v1 where tenant_id='e9000000-0000-4000-8000-000000000001' and vehicle_id='e9000000-0000-4000-8000-000000000102' and expense_scope='work_order'));
select pg_temp.assert_true('vehicle_pnl_excludes_operating',(select count(*)=0 from public.reports_expense_facts_v1 where tenant_id='e9000000-0000-4000-8000-000000000001' and voucher_number='EXP-OPERATING-RUNTIME' and vehicle_id is not null));

insert into public.expenses(id,tenant_id,voucher_number,amount,category_name,payment_method) values('e9000000-0000-4000-8000-000000000105','e9000000-0000-4000-8000-000000000001','EXP-LEGACY',50,'Legacy','cash');
select pg_temp.assert_true('legacy_needs_classification',(select classification_status='needs_classification' and expense_scope is null from public.expenses where voucher_number='EXP-LEGACY'));
insert into public.expenses(id,tenant_id,voucher_number,date,amount,subtotal,vat_amount,total,category_name,expense_type,payment_method,linked_work_order_id,vehicle_id,meta)
values('e9000000-0000-4000-8000-000000000112','e9000000-0000-4000-8000-000000000001','EXP-LEGACY-WO',current_date,75,75,3.75,78.75,'قطع غيار المركبات','cash_vehicle_parts','cash','WO-EXP-RUNTIME','e9000000-0000-4000-8000-000000000102','{"sourceWorkOrderId":"e9000000-0000-4000-8000-000000000103","partName":"Legacy Part"}'::jsonb);
select pg_temp.assert_true('legacy_work_order_row_not_mutated',(select classification_status='needs_classification' and expense_scope is null from public.expenses where voucher_number='EXP-LEGACY-WO'));
select pg_temp.assert_true('legacy_work_order_cost_restored_in_read_model',(select expense_scope='work_order' and work_order_id='e9000000-0000-4000-8000-000000000103' and vehicle_id='e9000000-0000-4000-8000-000000000102' and expense_type='cash_vehicle_parts' from public.reports_expense_facts_v1 where voucher_number='EXP-LEGACY-WO'));
update public.job_orders set archived_at=now() where id='e9000000-0000-4000-8000-000000000103';
select pg_temp.assert_true('archived_work_order_cost_remains_reportable',(select count(*)=1 from public.reports_expense_facts_v1 where voucher_number='EXP-LEGACY-WO'));
update public.job_orders set archived_at=null where id='e9000000-0000-4000-8000-000000000103';
select pg_temp.expect_error('operating_rejects_work_order',$q$insert into public.expenses(tenant_id,voucher_number,amount,expense_scope,work_order_id,linked_work_order_id,department_id,expense_category_id,description) select 'e9000000-0000-4000-8000-000000000001','BAD-OP',1,'operating','e9000000-0000-4000-8000-000000000103','WO-EXP-RUNTIME',d.id,c.id,'bad' from public.expense_categories d join public.expense_categories c on c.parent_id=d.id where d.code='ADMIN' and c.code='ADMIN_OTHER'$q$,'OPERATING_EXPENSE_WORK_ORDER_NOT_ALLOWED');
select pg_temp.expect_error('cycle_blocked',$q$update public.expense_categories set parent_id=(select id from public.expense_categories where code='PARTS_NEW') where code='PARTS'$q$,'EXPENSE_CATEGORY_CYCLE');
select pg_temp.expect_error('used_category_delete_blocked',$q$delete from public.expense_categories where code='PARTS_NEW'$q$,'EXPENSE_CATEGORY_IN_USE_DISABLE_INSTEAD');
select pg_temp.assert_true('server_summary',(public.expense_management_rpc(1,50,'{"scope":"work_order"}'::jsonb)->'aggregates'->>'total')::numeric=315);
select pg_temp.assert_true('export_all_page_count',(public.expense_management_rpc(1,500,'{}'::jsonb)->'pagination'->>'totalRows')::integer=5);

insert into public.expenses(id,tenant_id,voucher_number,date,amount,subtotal,vat_amount,total,description,expense_scope,work_order_id,department_id,expense_category_id,payment_method,status)
select 'e9000000-0000-4000-8000-000000000110','e9000000-0000-4000-8000-000000000001','EXP-CANCELLED',current_date,40,40,2,42,'cancelled expense',
 'work_order','e9000000-0000-4000-8000-000000000103',d.id,c.id,'cash','cancelled'
from public.expense_categories d join public.expense_categories c on c.parent_id=d.id where d.code='PARTS' and c.code='PARTS_NEW';
select pg_temp.assert_true('cancelled_expense_excluded',(select count(*)=0 from public.reports_expense_facts_v1 where voucher_number='EXP-CANCELLED'));

insert into public.expenses(id,tenant_id,voucher_number,date,amount,subtotal,vat_amount,total,description,expense_scope,work_order_id,department_id,expense_category_id,payment_method,deleted_at)
select 'e9000000-0000-4000-8000-000000000111','e9000000-0000-4000-8000-000000000001','EXP-DELETED',current_date,50,50,2.5,52.5,'deleted expense',
 'work_order','e9000000-0000-4000-8000-000000000103',d.id,c.id,'cash',now()
from public.expense_categories d join public.expense_categories c on c.parent_id=d.id where d.code='PARTS' and c.code='PARTS_NEW';
select pg_temp.assert_true('deleted_expense_excluded',(select count(*)=0 from public.reports_expense_facts_v1 where voucher_number='EXP-DELETED'));

update public.insurance_claims set status='cancelled' where id='e9000000-0000-4000-8000-000000000106';
select pg_temp.assert_true('cancelled_claim_expense_excluded',(select count(*)=0 from public.reports_expense_facts_v1 where voucher_number='EXP-INS-RUNTIME'));
update public.insurance_claims set status='approved' where id='e9000000-0000-4000-8000-000000000106';

update public.job_orders set deleted_at=now() where id='e9000000-0000-4000-8000-000000000103';
select pg_temp.assert_true('deleted_work_order_expense_excluded',(select count(*)=0 from public.reports_expense_facts_v1 where voucher_number='EXP-RUNTIME-1'));
update public.job_orders set deleted_at=null where id='e9000000-0000-4000-8000-000000000103';

select pg_temp.assert_true('ineligible_rows_absent_from_server_export',(public.expense_management_rpc(1,500,'{}'::jsonb)->'pagination'->>'totalRows')::integer=5);

select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000012","role":"authenticated"}',true);
select pg_temp.assert_true('manager_can_read',(select count(*)=7 from public.expenses));
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000013","role":"authenticated"}',true);
select pg_temp.assert_true('unauthorized_hidden',(select count(*)=0 from public.expenses));
select pg_temp.expect_error('unauthorized_category_manage',$q$insert into public.expense_categories(tenant_id,code,name,name_ar,name_en,category_type,expense_scope) values('e9000000-0000-4000-8000-000000000001','NOPE','لا','لا','No','category','both')$q$,'row-level security');
select set_config('request.jwt.claims','{"sub":"e9000000-0000-4000-8000-000000000021","role":"authenticated"}',true);
select pg_temp.assert_true('wrong_tenant_hidden',(select count(*)=0 from public.expenses));
reset role; set local role anon;
select pg_temp.expect_error('anonymous_denied',$q$select public.expense_management_rpc(1,50,'{}')$q$,'permission denied');
reset role;

select count(*) as passed_tests,jsonb_agg(test_name order by test_name) as tests from expense_runtime_results;
rollback;
