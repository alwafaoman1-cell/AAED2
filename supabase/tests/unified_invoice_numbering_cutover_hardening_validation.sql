begin;

create temporary table uin_hardening_results (
  test_name text primary key,
  passed boolean not null,
  details text
) on commit drop;
grant all on uin_hardening_results to authenticated, anon;

create or replace function pg_temp.uin_ok(p_name text, p_condition boolean, p_details text default null)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'TEST_FAILED: % (%)', p_name, coalesce(p_details, 'condition is false');
  end if;
  insert into uin_hardening_results values (p_name, true, p_details);
end;
$$;

create or replace function pg_temp.uin_error(p_name text, p_sql text, p_expected text)
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
  insert into uin_hardening_results values (p_name, true, p_expected);
end;
$$;

insert into public.tenants(id, name, slug) values
  ('fb000000-0000-4000-8000-000000000001', 'UIN Hardening A', 'uin-hardening-a'),
  ('fb000000-0000-4000-8000-000000000002', 'UIN Hardening B', 'uin-hardening-b');
insert into auth.users(id, email, raw_user_meta_data) values
  ('fb000000-0000-4000-8000-000000000011', 'uin-hardening-admin-a@runtime.invalid',
   '{"tenant_id":"fb000000-0000-4000-8000-000000000001","full_name":"UIN Admin A","role":"admin"}'),
  ('fb000000-0000-4000-8000-000000000012', 'uin-hardening-user-a@runtime.invalid',
   '{"tenant_id":"fb000000-0000-4000-8000-000000000001","full_name":"UIN User A","role":"technician"}'),
  ('fb000000-0000-4000-8000-000000000021', 'uin-hardening-admin-b@runtime.invalid',
   '{"tenant_id":"fb000000-0000-4000-8000-000000000002","full_name":"UIN Admin B","role":"admin"}');

insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total,
  status, invoice_status, created_at
) values
  ('fb100000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
   'INV-2026-00020', 'invoice', '2026-01-10', 100, 5, 105, 'paid', 'draft', '2026-01-10T08:00:00Z'),
  ('fb100000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000001',
   'INV-2026-00020', 'invoice', '2026-01-11', 200, 10, 210, 'cancelled', 'draft', '2026-01-11T08:00:00Z');
insert into public.insurance_invoices(
  id, tenant_id, claim_id, invoice_number, insurance_company_name,
  invoice_date, subtotal, vat, total, status, issued_at, created_at
) values (
  'fb200000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000001', '139', 'Historical Insurer',
  '2026-01-12', 2850, 142.5, 2992.5, 'paid', '2026-01-12T08:00:00Z', '2026-01-12T08:00:00Z'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fb000000-0000-4000-8000-000000000011","role":"authenticated"}', true);

select pg_temp.uin_error('start_139_rejected',
  $$select public.activate_unified_invoice_numbering(2026::smallint,139::bigint,6::smallint)$$,
  'INVOICE_SEQUENCE_START_COLLIDES_WITH_HISTORY');
select pg_temp.uin_ok('rejected_activation_created_no_settings',
  not exists(select 1 from public.invoice_numbering_settings where tenant_id='fb000000-0000-4000-8000-000000000001'));

select public.activate_unified_invoice_numbering(2026::smallint,140::bigint,6::smallint);
select pg_temp.uin_ok('start_140_accepted',
  (select next_value=140 from public.invoice_number_sequences where tenant_id='fb000000-0000-4000-8000-000000000001' and invoice_year=2026));
select pg_temp.uin_ok('activation_metadata',
  (select start_year=2026 and starting_sequence=140 and first_invoice_number='INV-2026-000140'
     and numbering_format='INV-YYYY-NNNNNN' and activated_by=auth.uid()
   from public.invoice_numbering_settings where tenant_id='fb000000-0000-4000-8000-000000000001'));

select * from public.issue_sales_document_invoice('fb100000-0000-4000-8000-000000000001','2026-08-23');
select pg_temp.uin_ok('historical_draft_number_locked',
  (select doc_number='INV-2026-00020' from public.sales_documents where id='fb100000-0000-4000-8000-000000000001'));
select pg_temp.uin_ok('historical_draft_status_unchanged',
  (select invoice_status='draft' and status='paid' and date='2026-01-10'
   from public.sales_documents where id='fb100000-0000-4000-8000-000000000001'));
select pg_temp.uin_ok('historical_issue_consumed_no_sequence',
  (select next_value=140 from public.invoice_number_sequences where tenant_id='fb000000-0000-4000-8000-000000000001' and invoice_year=2026));
select pg_temp.uin_ok('historical_issue_created_no_registry',
  not exists(select 1 from public.invoice_number_registry where source_id='fb100000-0000-4000-8000-000000000001'));

update public.insurance_invoices set status='cancelled'
where id='fb200000-0000-4000-8000-000000000001';
select pg_temp.uin_ok('historical_insurance_number_locked',
  (select invoice_number='139' from public.insurance_invoices where id='fb200000-0000-4000-8000-000000000001'));

select pg_temp.uin_ok('historical_sales_search_ambiguous',
  (select count(*)=2 and bool_and(ambiguous_historical_number) and bool_and(is_historical)
   from public.find_unified_invoice_number('INV-2026-00020')));
select pg_temp.uin_ok('historical_insurance_search',
  (select count(*)=1 and bool_and(source_type='insurance_invoices') and bool_and(is_historical)
   from public.find_unified_invoice_number('139')));

insert into public.sales_documents(
  id,tenant_id,doc_number,doc_type,date,subtotal,tax_total,total,status,invoice_status,created_at
) values ('fb100000-0000-4000-8000-000000000010','fb000000-0000-4000-8000-000000000001',
  'CLIENT-DRAFT','invoice','2026-08-23',100,5,105,'draft','draft',clock_timestamp());
select pg_temp.uin_ok('new_draft_number_blank',
  (select doc_number='' from public.sales_documents where id='fb100000-0000-4000-8000-000000000010'));
select * from public.issue_sales_document_invoice('fb100000-0000-4000-8000-000000000010','2026-08-23');
select pg_temp.uin_ok('new_cash_140',
  (select doc_number='INV-2026-000140' from public.sales_documents where id='fb100000-0000-4000-8000-000000000010'));

reset role;
insert into public.insurance_invoices(
  id,tenant_id,claim_id,invoice_number,insurance_company_name,invoice_date,subtotal,vat,total,status,created_at
) values ('fb200000-0000-4000-8000-000000000010','fb000000-0000-4000-8000-000000000001',
  'fb300000-0000-4000-8000-000000000010','','Insurer','2026-08-23',1200,60,1260,'issued',clock_timestamp());

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"fb000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select pg_temp.uin_ok('new_insurance_141',
  (select invoice_number='INV-2026-000141' from public.insurance_invoices where id='fb200000-0000-4000-8000-000000000010'));
select pg_temp.uin_ok('shared_sequence_cash_insurance',
  (select string_agg(invoice_type,',' order by sequence_number)='cash,insurance'
   from public.invoice_number_registry where tenant_id='fb000000-0000-4000-8000-000000000001'));

select * from public.issue_sales_document_invoice('fb100000-0000-4000-8000-000000000010','2026-08-23');
select pg_temp.uin_ok('retry_idempotent',
  (select next_value=142 from public.invoice_number_sequences where tenant_id='fb000000-0000-4000-8000-000000000001' and invoice_year=2026));
select pg_temp.uin_ok('registry_search_new_cash',
  (select count(*)=1 and bool_and(source_type='sales_documents') and bool_and(not is_historical)
   from public.find_unified_invoice_number('inv-2026-000140')));

update public.sales_documents set doc_number='ILLEGAL-CHANGE',status='cancelled'
where id='fb100000-0000-4000-8000-000000000010';
select pg_temp.uin_ok('cancel_retains_registry_number',
  (select doc_number='INV-2026-000140' from public.sales_documents where id='fb100000-0000-4000-8000-000000000010'));
update public.insurance_invoices set invoice_number='ILLEGAL-CHANGE',status='reversed'
where id='fb200000-0000-4000-8000-000000000010';
select pg_temp.uin_ok('reversal_retains_registry_number',
  (select invoice_number='INV-2026-000141' from public.insurance_invoices where id='fb200000-0000-4000-8000-000000000010'));

insert into public.sales_documents(
  id,tenant_id,doc_number,doc_type,date,subtotal,tax_total,total,status,invoice_status,created_at
) values ('fb100000-0000-4000-8000-000000000011','fb000000-0000-4000-8000-000000000001',
  '','invoice','2027-01-02',10,.5,10.5,'draft','draft',clock_timestamp());
select * from public.issue_sales_document_invoice('fb100000-0000-4000-8000-000000000011','2027-01-02');
select pg_temp.uin_ok('year_rollover_starts_one',
  (select doc_number='INV-2027-000001' from public.sales_documents where id='fb100000-0000-4000-8000-000000000011'));

select set_config('request.jwt.claims',
  '{"sub":"fb000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
select pg_temp.uin_ok('cross_tenant_search_denied',
  not exists(select 1 from public.find_unified_invoice_number('INV-2026-000140')));
select pg_temp.uin_error('wrong_tenant_issue_denied',
  $$select * from public.issue_sales_document_invoice('fb100000-0000-4000-8000-000000000010','2026-08-23')$$,
  'sales invoice not found');

select set_config('request.jwt.claims',
  '{"sub":"fb000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
select pg_temp.uin_error('unauthorized_issue_denied',
  $$select * from public.issue_sales_document_invoice('fb100000-0000-4000-8000-000000000010','2026-08-23')$$,
  'invoice issue permission required');

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.uin_error('anonymous_search_denied',
  $$select * from public.find_unified_invoice_number('INV-2026-000140')$$,
  'permission denied');

reset role;
select pg_temp.uin_ok('historical_amounts_vat_unchanged',
  (select subtotal=100 and tax_total=5 and total=105 from public.sales_documents where id='fb100000-0000-4000-8000-000000000001')
  and (select subtotal=2850 and vat=142.5 and total=2992.5 from public.insurance_invoices where id='fb200000-0000-4000-8000-000000000001'));
select pg_temp.uin_ok('no_historical_registry_backfill',
  not exists(select 1 from public.invoice_number_registry where source_id in (
    'fb100000-0000-4000-8000-000000000001','fb100000-0000-4000-8000-000000000002','fb200000-0000-4000-8000-000000000001'
  )));

select jsonb_build_object(
  'total',count(*),'passed',count(*) filter(where passed),'failed',count(*) filter(where not passed),
  'tests',jsonb_agg(jsonb_build_object('name',test_name,'passed',passed,'details',details) order by test_name)
) as unified_invoice_numbering_cutover_hardening_validation
from uin_hardening_results;

rollback;
