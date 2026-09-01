begin;

create temporary table unified_invoice_numbering_results (
  test_name text primary key,
  passed boolean not null,
  details text
) on commit drop;
grant all on unified_invoice_numbering_results to authenticated, anon;

create or replace function pg_temp.uin_assert(p_name text, p_condition boolean, p_details text default null)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'TEST_FAILED: % (%)', p_name, coalesce(p_details, 'condition is false');
  end if;
  insert into unified_invoice_numbering_results values (p_name, true, p_details)
  on conflict (test_name) do update set passed = excluded.passed, details = excluded.details;
end;
$$;

create or replace function pg_temp.uin_expect_error(p_name text, p_sql text, p_expected text)
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
  insert into unified_invoice_numbering_results values (p_name, true, p_expected)
  on conflict (test_name) do update set passed = excluded.passed, details = excluded.details;
end;
$$;

insert into public.tenants(id, name, slug) values
  ('f1000000-0000-4000-8000-000000000001', 'Unified Invoice Tenant A', 'uin-runtime-a'),
  ('f1000000-0000-4000-8000-000000000002', 'Unified Invoice Tenant B', 'uin-runtime-b');

insert into auth.users(id, email, raw_user_meta_data) values
  ('f1000000-0000-4000-8000-000000000011', 'uin-admin-a@runtime.invalid',
   '{"tenant_id":"f1000000-0000-4000-8000-000000000001","full_name":"UIN Admin A","role":"admin"}'),
  ('f1000000-0000-4000-8000-000000000012', 'uin-user-a@runtime.invalid',
   '{"tenant_id":"f1000000-0000-4000-8000-000000000001","full_name":"UIN User A","role":"technician"}'),
  ('f1000000-0000-4000-8000-000000000021', 'uin-admin-b@runtime.invalid',
   '{"tenant_id":"f1000000-0000-4000-8000-000000000002","full_name":"UIN Admin B","role":"admin"}');

-- Historical fixtures are deliberately created before cutover.
insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total,
  status, invoice_status, issued_at
) values (
  'f2000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'INV-OLD-CASH-77', 'invoice', '2026-01-10', 100, 5, 105, 'unpaid', 'issued', '2026-01-10T08:00:00Z'
);
insert into public.insurance_invoices(
  id, tenant_id, claim_id, invoice_number, insurance_company_name,
  invoice_date, subtotal, vat, total, status, issued_at
) values (
  'f3000000-0000-4000-8000-000000000001', 'f1000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000001', 'INS-OLD-88', 'Historical Insurer',
  '2026-01-11', 200, 10, 210, 'issued', '2026-01-11T08:00:00Z'
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000011","role":"authenticated"}', true);

select public.activate_unified_invoice_numbering(2026::smallint, 50::bigint, 6::smallint);

-- Draft does not consume or display a number.
insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total, status, invoice_status, created_at
) values (
  'f2000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000001',
  'CLIENT-PREVIEW-1', 'invoice', '2026-08-23', 100, 5, 105, 'draft', 'draft', clock_timestamp()
);
select pg_temp.uin_assert('draft_has_no_official_number',
  (select doc_number = '' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000010'));
select pg_temp.uin_assert('draft_has_no_registry',
  not exists (select 1 from public.invoice_number_registry where source_id = 'f2000000-0000-4000-8000-000000000010'));
select pg_temp.uin_assert('draft_did_not_consume_sequence',
  (select next_value = 50 from public.invoice_number_sequences
   where tenant_id = 'f1000000-0000-4000-8000-000000000001' and invoice_year = 2026));

-- Cash #50, Insurance #51, Cash #52 prove the shared sequence.
select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000010', '2026-08-23');
select pg_temp.uin_assert('first_cash_number',
  (select doc_number = 'INV-26-000050' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000010'));

reset role;
insert into public.insurance_invoices(
  id, tenant_id, claim_id, invoice_number, insurance_company_name,
  invoice_date, subtotal, vat, total, status, created_at
) values (
  'f3000000-0000-4000-8000-000000000010', 'f1000000-0000-4000-8000-000000000001',
  'f4000000-0000-4000-8000-000000000010', '', 'Future Insurer',
  '2026-08-23', 1200, 60, 1260, 'issued', clock_timestamp()
);

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select pg_temp.uin_assert('second_insurance_number',
  (select invoice_number = 'INV-26-000051' from public.insurance_invoices where id = 'f3000000-0000-4000-8000-000000000010'));

insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total, status, invoice_status, created_at
) values (
  'f2000000-0000-4000-8000-000000000011', 'f1000000-0000-4000-8000-000000000001',
  '', 'invoice', '2026-08-23', 2850, 142.5, 2992.5, 'draft', 'draft', clock_timestamp()
);
select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000011', '2026-08-23');
select pg_temp.uin_assert('third_cash_number',
  (select doc_number = 'INV-26-000052' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000011'));
select pg_temp.uin_assert('shared_sequence_types',
  (select string_agg(invoice_type, ',' order by sequence_number) = 'cash,insurance,cash'
   from public.invoice_number_registry
   where tenant_id = 'f1000000-0000-4000-8000-000000000001' and invoice_year = 2026));
select pg_temp.uin_assert('registry_unique_count',
  (select count(*) = count(distinct invoice_number)
   and count(*) = count(distinct (invoice_year, sequence_number))
   from public.invoice_number_registry
   where tenant_id = 'f1000000-0000-4000-8000-000000000001'));

-- Retry is idempotent and consumes no second number.
select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000010', '2026-08-23');
select pg_temp.uin_assert('retry_same_number',
  (select doc_number = 'INV-26-000050' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000010'));
select pg_temp.uin_assert('retry_did_not_consume_number',
  (select next_value = 53 from public.invoice_number_sequences
   where tenant_id = 'f1000000-0000-4000-8000-000000000001' and invoice_year = 2026));

-- Cancelled/void semantics: number stays in the immutable registry.
update public.sales_documents set status = 'cancelled'
where id = 'f2000000-0000-4000-8000-000000000010';
select pg_temp.uin_assert('cancelled_number_retained',
  (select doc_number = 'INV-26-000050' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000010'));
select pg_temp.uin_assert('cancelled_number_registry_retained',
  exists (select 1 from public.invoice_number_registry where invoice_number = 'INV-26-000050'));
select pg_temp.uin_assert('cancelled_event_audited',
  exists (select 1 from public.invoice_number_audit_events
          where source_id = 'f2000000-0000-4000-8000-000000000010' and event_type = 'cancelled'));

update public.sales_documents set status = 'void'
where id = 'f2000000-0000-4000-8000-000000000011';
select pg_temp.uin_assert('void_number_retained',
  (select doc_number = 'INV-26-000052' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000011'));
select pg_temp.uin_assert('void_event_audited',
  exists (select 1 from public.invoice_number_audit_events
          where source_id = 'f2000000-0000-4000-8000-000000000011' and event_type = 'void'));

update public.insurance_invoices set status = 'reversed'
where id = 'f3000000-0000-4000-8000-000000000010';
select pg_temp.uin_assert('reversed_insurance_number_retained',
  (select invoice_number = 'INV-26-000051' from public.insurance_invoices where id = 'f3000000-0000-4000-8000-000000000010'));
select pg_temp.uin_assert('reversal_event_audited',
  exists (select 1 from public.invoice_number_audit_events
          where source_id = 'f3000000-0000-4000-8000-000000000010' and event_type = 'reversed'));

insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total, status, invoice_status, created_at
) values (
  'f2000000-0000-4000-8000-000000000013', 'f1000000-0000-4000-8000-000000000001',
  '', 'invoice', '2026-08-24', 30, 1.5, 31.5, 'draft', 'draft', clock_timestamp()
);
select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000013', '2026-08-24');
select pg_temp.uin_assert('terminal_numbers_never_reused',
  (select doc_number = 'INV-26-000053' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000013'));

-- Year resets from issue date, not browser time.
insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total, status, invoice_status, created_at
) values (
  'f2000000-0000-4000-8000-000000000012', 'f1000000-0000-4000-8000-000000000001',
  '', 'invoice', '2027-01-02', 10, .5, 10.5, 'draft', 'draft', clock_timestamp()
);
select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000012', '2027-01-02');
select pg_temp.uin_assert('year_rollover',
  (select doc_number = 'INV-27-000001' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000012'));

-- Tenant B has its own sequence and cannot see Tenant A's registry.
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000021","role":"authenticated"}', true);
select public.activate_unified_invoice_numbering(2026::smallint, 1::bigint, 6::smallint);
insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total, status, invoice_status
) values (
  'f2000000-0000-4000-8000-000000000021', 'f1000000-0000-4000-8000-000000000002',
  '', 'invoice', '2026-08-23', 20, 1, 21, 'draft', 'draft'
);
select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000021', '2026-08-23');
select pg_temp.uin_assert('tenant_b_own_sequence',
  (select doc_number = 'INV-26-000001' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000021'));
select pg_temp.uin_assert('tenant_b_cannot_read_tenant_a_registry',
  not exists (select 1 from public.invoice_number_registry where tenant_id = 'f1000000-0000-4000-8000-000000000001'));
select pg_temp.uin_expect_error('wrong_tenant_issue_denied',
  $$select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000010','2026-08-23')$$,
  'sales invoice not found');

-- Ordinary user cannot activate or issue; internal allocator is not callable.
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000012","role":"authenticated"}', true);
select pg_temp.uin_expect_error('unauthorized_issue_denied',
  $$select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000011','2026-08-23')$$,
  'invoice issue permission required');
select pg_temp.uin_expect_error('internal_allocator_denied',
  $$select public.allocate_invoice_number_internal(
    'f1000000-0000-4000-8000-000000000001','sales_documents',gen_random_uuid(),
    'cash','2026-08-23',now(),auth.uid())$$,
  'permission denied');

reset role;
set local role anon;
select set_config('request.jwt.claims','{"role":"anon"}',true);
select pg_temp.uin_expect_error('anonymous_issue_denied',
  $$select * from public.issue_sales_document_invoice('f2000000-0000-4000-8000-000000000011','2026-08-23')$$,
  'permission denied');

reset role;
select pg_temp.uin_expect_error('registry_is_immutable',
  $$delete from public.invoice_number_registry where invoice_number = 'INV-26-000050'$$,
  'official invoice number registry records are immutable');
select pg_temp.uin_assert('historical_cash_number_unchanged',
  (select doc_number = 'INV-OLD-CASH-77' from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000001'));
select pg_temp.uin_assert('historical_insurance_number_unchanged',
  (select invoice_number = 'INS-OLD-88' from public.insurance_invoices where id = 'f3000000-0000-4000-8000-000000000001'));
select pg_temp.uin_assert('historical_amounts_unchanged',
  (select subtotal = 100 and tax_total = 5 and total = 105
   from public.sales_documents where id = 'f2000000-0000-4000-8000-000000000001')
  and
  (select subtotal = 200 and vat = 10 and total = 210
   from public.insurance_invoices where id = 'f3000000-0000-4000-8000-000000000001'));

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"f1000000-0000-4000-8000-000000000011","role":"authenticated"}', true);
select pg_temp.uin_assert('search_returns_cash_source',
  (select source_type = 'sales_documents' and invoice_type = 'cash'
   from public.find_unified_invoice_number('inv-2026-000052')));
select pg_temp.uin_assert('search_returns_insurance_source',
  (select source_type = 'insurance_invoices' and invoice_type = 'insurance'
   from public.find_unified_invoice_number('INV-26-000051')));

reset role;
select jsonb_build_object(
  'total', count(*),
  'passed', count(*) filter (where passed),
  'failed', count(*) filter (where not passed),
  'tests', jsonb_agg(jsonb_build_object('name', test_name, 'passed', passed, 'details', details) order by test_name)
) as unified_invoice_numbering_runtime_validation
from unified_invoice_numbering_results;

rollback;
