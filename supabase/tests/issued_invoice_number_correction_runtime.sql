-- Development only. Creates numbered and pre-cutover invoices inside one
-- transaction, tests correction/aliases/access, and rolls every fixture back.
begin;

create temporary table correction_runtime_context on commit drop as
select p.user_id, p.tenant_id, c.id as claim_id,
  gen_random_uuid() as cash_id, gen_random_uuid() as insurance_id,
  gen_random_uuid() as historic_id, gen_random_uuid() as historic_claim_id,
  gen_random_uuid() as historic_cash_id,
  gen_random_uuid() as posted_claim_id, gen_random_uuid() as posted_insurance_id,
  gen_random_uuid() as closed_claim_id, gen_random_uuid() as closed_insurance_id
from public.profiles p
join public.insurance_claims c on c.tenant_id = p.tenant_id
limit 1;
grant all on correction_runtime_context to authenticated;
alter table correction_runtime_context add column foreign_id uuid default gen_random_uuid();

do $$ begin
  if (select count(*) from correction_runtime_context) <> 1 then
    raise exception 'TEST_SETUP_REQUIRES_DEV_USER_AND_CLAIM';
  end if;
end $$;

update public.user_roles r set role = 'admin'
where r.user_id = (select user_id from correction_runtime_context);
select set_config('request.jwt.claims',
  (select json_build_object('sub', user_id, 'role', 'authenticated')::text
   from correction_runtime_context), true);

insert into public.insurance_claims
  (id, tenant_id, customer_id, claim_number, insurance_company)
select x.historic_claim_id, c.tenant_id, c.customer_id,
  'RUNTIME-CORRECTION-' || left(x.historic_claim_id::text, 8),
  c.insurance_company
from correction_runtime_context x
join public.insurance_claims c on c.id = x.claim_id;
insert into public.insurance_claims
  (id, tenant_id, customer_id, claim_number, insurance_company)
select x.posted_claim_id, c.tenant_id, c.customer_id,
  'RUNTIME-POSTED-' || left(x.posted_claim_id::text, 8),
  c.insurance_company
from correction_runtime_context x
join public.insurance_claims c on c.id = x.claim_id;
insert into public.insurance_claims
  (id, tenant_id, customer_id, claim_number, insurance_company)
select x.closed_claim_id, c.tenant_id, c.customer_id,
  'RUNTIME-CLOSED-' || left(x.closed_claim_id::text, 8),
  c.insurance_company
from correction_runtime_context x
join public.insurance_claims c on c.id = x.claim_id;

insert into public.insurance_invoices
  (id, tenant_id, claim_id, invoice_number, insurance_company_name,
   invoice_date, subtotal, vat, total, status, issued_at, created_at)
select historic_id, tenant_id, historic_claim_id, '00073', 'Runtime insurer',
  '2026-10-25', 50, 2.5, 52.5, 'issued',
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '2 hours'
from correction_runtime_context;
insert into public.insurance_invoices
  (id, tenant_id, claim_id, invoice_number, insurance_company_name,
   invoice_date, subtotal, vat, total, status, issued_at, created_at)
select posted_insurance_id, tenant_id, posted_claim_id, '00076', 'Runtime insurer',
  '2026-10-25', 60, 3, 63, 'paid',
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '2 hours'
from correction_runtime_context;
insert into public.insurance_invoices
  (id, tenant_id, claim_id, invoice_number, insurance_company_name,
   invoice_date, subtotal, vat, total, status, issued_at, created_at)
select closed_insurance_id, tenant_id, closed_claim_id, '00075', 'Runtime insurer',
  '2026-10-25', 30, 1.5, 31.5, 'issued',
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '2 hours'
from correction_runtime_context;
insert into public.sales_documents
  (id, tenant_id, doc_number, doc_type, date, customer_name,
   items, subtotal, tax_total, total, status, invoice_status, issued_at, created_at)
select historic_cash_id, tenant_id, '00074', 'invoice', '2026-10-25',
  'Runtime customer',
  '[{"description":"Runtime service","quantity":1,"unitPrice":40}]'::jsonb,
  40, 2, 42, 'unpaid', 'issued',
  clock_timestamp() - interval '2 hours',
  clock_timestamp() - interval '2 hours'
from correction_runtime_context;

insert into public.invoice_numbering_settings
  (tenant_id, activated_at, activated_by, cutover_year, first_sequence)
select tenant_id, clock_timestamp() - interval '1 hour', user_id, 2026, 100
from correction_runtime_context;
insert into public.invoice_number_sequences (tenant_id, invoice_year, next_value)
select tenant_id, 2026, 100 from correction_runtime_context;

insert into public.sales_documents
  (id, tenant_id, doc_number, doc_type, date, customer_name,
   items, subtotal, tax_total, total, status, invoice_status, issued_at)
select cash_id, tenant_id, '', 'invoice', '2026-10-25', 'Runtime customer',
  '[{"description":"Runtime service","quantity":1,"unitPrice":100}]'::jsonb,
  100, 5, 105, 'unpaid', 'issued', clock_timestamp()
from correction_runtime_context;

insert into public.insurance_invoices
  (id, tenant_id, claim_id, invoice_number, insurance_company_name,
   invoice_date, subtotal, vat, total, status, issued_at)
select insurance_id, tenant_id, claim_id, '', 'Runtime insurer',
  '2026-10-25', 200, 10, 210, 'issued', clock_timestamp()
from correction_runtime_context;

insert into public.sales_documents
  (id, tenant_id, doc_number, doc_type, date, invoice_status, status)
select x.foreign_id, t.id, 'OTHER-TENANT-RUNTIME', 'invoice',
  '2026-10-25', 'issued', 'unpaid'
from correction_runtime_context x
join public.tenants t on t.id <> x.tenant_id
limit 1;

set local role authenticated;
do $$
declare
  x correction_runtime_context%rowtype;
  got text;
  n bigint;
  fiscal_id uuid;
  period_id uuid;
  journal_id uuid;
  posted_journal_id uuid;
  debit_account_id uuid;
  credit_account_id uuid;
  closed_fiscal_id uuid;
  closed_period_id uuid;
begin
  select * into x from correction_runtime_context;
  if (select d.doc_number from public.sales_documents d where d.id = x.cash_id)
      <> 'INV-26-000100'
     or (select i.invoice_number from public.insurance_invoices i where i.id = x.insurance_id)
      <> 'INV-26-000101' then
    raise exception 'TEST_ISSUANCE_PRECONDITION_FAILED';
  end if;

  begin
    perform public.correct_issued_invoice_number('sales_documents', x.cash_id,
      'INV-26-000100', 'INV-26-000050', 'Runtime gap correction');
    raise exception 'TEST_WINDOW_GATE_BYPASSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED' then raise; end if;
  end;
  begin
    perform public.correct_historical_insurance_invoice_number(
      x.historic_id, '00073', 'INV-26-000073', 'Window must be open');
    raise exception 'TEST_HISTORICAL_WINDOW_GATE_BYPASSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED' then raise; end if;
  end;
  begin
    perform public.correct_historical_cash_invoice_number(
      x.historic_cash_id, '00074', 'INV-26-000074', 'Window must be open');
    raise exception 'TEST_HISTORICAL_CASH_WINDOW_GATE_BYPASSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED' then raise; end if;
  end;

  perform public.set_invoice_number_correction_window(30, 'Runtime authorized correction');
  begin
    perform public.correct_issued_invoice_number('sales_documents', x.cash_id,
      'INV-26-000100', 'INV-26-000073', 'Legacy numeric slot is reserved');
    raise exception 'TEST_LEGACY_NUMERIC_SLOT_REUSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_ALREADY_USED' then raise; end if;
  end;
  select invoice_number into got from public.correct_historical_insurance_invoice_number(
    x.historic_id, '00073', 'INV-26-000073', 'Runtime historical correction');
  if got <> 'INV-26-000073' then raise exception 'TEST_HISTORICAL_CORRECTION_FAILED'; end if;
  select invoice_number into got from public.correct_historical_cash_invoice_number(
    x.historic_cash_id, '00074', 'INV-26-000074', 'Runtime historical cash correction');
  if got <> 'INV-26-000074' then raise exception 'TEST_HISTORICAL_CASH_CORRECTION_FAILED'; end if;
  select invoice_number into got from public.correct_issued_invoice_number(
    'sales_documents', x.cash_id, 'INV-26-000100', 'INV-26-000050', 'Runtime cash correction');
  if got <> 'INV-26-000050' then raise exception 'TEST_CASH_CORRECTION_FAILED'; end if;

  select invoice_number into got from public.correct_issued_invoice_number(
    'insurance_invoices', x.insurance_id, 'INV-26-000101', 'INV-26-000051', 'Runtime insurance correction');
  if got <> 'INV-26-000051' then raise exception 'TEST_INSURANCE_CORRECTION_FAILED'; end if;

  select invoice_number into got from public.correct_issued_invoice_number(
    'sales_documents', x.cash_id, 'INV-26-000050', 'INV-26-000052', 'Runtime second correction');
  if got <> 'INV-26-000052' then raise exception 'TEST_SECOND_CORRECTION_FAILED'; end if;

  -- A financial link with a different historic source_type must still block
  -- renumbering; the original RPC filter alone would miss this record.
  insert into public.accounting_fiscal_years
    (tenant_id, name, start_date, end_date)
  values (x.tenant_id, 'Correction runtime ' || x.cash_id::text,
    '2020-01-01', '2020-12-31') returning id into fiscal_id;
  insert into public.accounting_periods
    (tenant_id, fiscal_year_id, name, sequence, start_date, end_date)
  values (x.tenant_id, fiscal_id, 'Correction runtime', 1,
    '2020-01-01', '2020-12-31') returning id into period_id;
  insert into public.accounting_journal_entries
    (tenant_id, entry_number, accounting_date, fiscal_year_id,
     accounting_period_id, status)
  values (x.tenant_id, 'JE-CORRECTION-' || left(x.cash_id::text, 8),
    '2020-01-01', fiscal_id, period_id, 'draft') returning id into journal_id;
  insert into public.accounting_source_links
    (tenant_id, journal_entry_id, source_type, source_id)
  values (x.tenant_id, journal_id, 'manual_journal', x.cash_id);

  -- Post through the same approve/post RPCs used by the accounting workflow.
  insert into public.accounting_accounts
    (tenant_id, code, name_ar, name_en, account_type, normal_balance)
  values (x.tenant_id, 'RUNTIME-DR-' || left(x.posted_insurance_id::text, 8),
    'حساب اختبار مدين', 'Runtime debit', 'asset', 'debit')
  returning id into debit_account_id;
  insert into public.accounting_accounts
    (tenant_id, code, name_ar, name_en, account_type, normal_balance)
  values (x.tenant_id, 'RUNTIME-CR-' || left(x.posted_insurance_id::text, 8),
    'حساب اختبار دائن', 'Runtime credit', 'revenue', 'credit')
  returning id into credit_account_id;
  insert into public.accounting_journal_entries
    (tenant_id, entry_number, accounting_date, fiscal_year_id,
     accounting_period_id, reference, source_type, source_identifier)
  values (x.tenant_id, 'JE-POSTED-' || left(x.posted_insurance_id::text, 8),
    '2020-01-01', fiscal_id, period_id, '00076',
    'insurance_invoice', x.posted_insurance_id::text)
  returning id into posted_journal_id;
  insert into public.accounting_journal_lines
    (tenant_id, journal_entry_id, account_id, line_number, debit, credit)
  values (x.tenant_id, posted_journal_id, debit_account_id, 1, 63, 0),
    (x.tenant_id, posted_journal_id, credit_account_id, 2, 0, 63);
  insert into public.accounting_source_links
    (tenant_id, journal_entry_id, source_type, source_id,
     source_number_snapshot, is_primary)
  values (x.tenant_id, posted_journal_id, 'insurance_invoice',
    x.posted_insurance_id, '00076', true);
  perform public.approve_accounting_journal_entry(posted_journal_id);
  perform public.post_accounting_journal_entry(posted_journal_id);
  begin
    update public.insurance_invoices i set invoice_number = 'INV-26-000076'
    where i.id = x.posted_insurance_id;
    raise exception 'TEST_POSTED_DIRECT_NUMBER_CHANGE_ALLOWED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED' then raise; end if;
  end;
  select invoice_number into got from public.correct_historical_insurance_invoice_number(
    x.posted_insurance_id, '00076', 'INV-26-000076',
    'Preserve posted historical journal reference');
  if got <> 'INV-26-000076'
     or (select i.total from public.insurance_invoices i
         where i.id = x.posted_insurance_id) <> 63
     or (select l.source_number_snapshot from public.accounting_source_links l
         where l.journal_entry_id = posted_journal_id) <> '00076'
     or (select e.reference from public.accounting_journal_entries e
         where e.id = posted_journal_id) <> '00076'
     or (select e.status from public.accounting_journal_entries e
         where e.id = posted_journal_id) <> 'posted'
     or (select count(*) from public.find_unified_invoice_number('00076')
         where source_id = x.posted_insurance_id
           and invoice_number = 'INV-26-000076') <> 1
     or (select count(*) from public.invoice_number_audit_events a
         where a.source_id = x.posted_insurance_id
           and a.event_type = 'renumbered'
           and a.details->>'old_invoice_number' = '00076') <> 1 then
    raise exception 'TEST_POSTED_HISTORICAL_FORMAT_CORRECTION_FAILED';
  end if;
  begin
    perform public.correct_issued_invoice_number('sales_documents', x.cash_id,
      'INV-26-000052', 'INV-26-000053', 'Linked journal must block correction');
    raise exception 'TEST_ACCOUNTING_LINKED_NUMBER_CHANGED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED' then raise; end if;
  end;

  if (select count(*) from public.find_unified_invoice_number('INV-26-000100')
      where source_id = x.cash_id and invoice_number = 'INV-26-000052') <> 1
     or (select count(*) from public.find_unified_invoice_number('INV-26-000050')
      where source_id = x.cash_id and invoice_number = 'INV-26-000052') <> 1
     or (select count(*) from public.find_unified_invoice_number('INV-26-000101')
      where source_id = x.insurance_id and invoice_number = 'INV-26-000051') <> 1 then
    raise exception 'TEST_RETIRED_NUMBER_LOOKUP_FAILED';
  end if;
  if (select count(*) from public.find_unified_invoice_number('00074')
      where source_id = x.historic_cash_id and invoice_number = 'INV-26-000074') <> 1 then
    raise exception 'TEST_HISTORICAL_CASH_ALIAS_FAILED';
  end if;
  if (select d.total from public.sales_documents d where d.id = x.cash_id) <> 105
     or (select i.total from public.insurance_invoices i where i.id = x.insurance_id) <> 210 then
    raise exception 'TEST_FINANCIAL_TOTAL_CHANGED';
  end if;

  begin
    perform public.correct_issued_invoice_number('sales_documents', x.foreign_id,
      'OTHER-TENANT-RUNTIME', 'INV-26-000053', 'Wrong tenant probe');
    raise exception 'TEST_WRONG_TENANT_ALLOWED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_NOT_FOUND' then raise; end if;
  end;

  update public.insurance_invoices i set invoice_number = 'INV-26-000053'
  where i.id = x.insurance_id;
  if (select i.invoice_number from public.insurance_invoices i
      where i.id = x.insurance_id) <> 'INV-26-000051' then
    raise exception 'TEST_DIRECT_INSURANCE_RENUMBER_ALLOWED';
  end if;
  begin
    update public.sales_documents d set doc_number = 'INV-26-000053'
    where d.id = x.cash_id;
    raise exception 'TEST_DIRECT_CASH_RENUMBER_ALLOWED';
  exception when others then
    if sqlerrm <> 'ISSUED_CASH_INVOICE_NUMBER_IMMUTABLE' then raise; end if;
  end;

  update public.insurance_invoices i set pdf_url = 'runtime://archived-pdf'
  where i.id = x.insurance_id;
  begin
    perform public.correct_issued_invoice_number('insurance_invoices', x.insurance_id,
      'INV-26-000051', 'INV-26-000053', 'Archived PDF must be immutable');
    raise exception 'TEST_ARCHIVED_PDF_NUMBER_CHANGED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_FINALIZED' then raise; end if;
  end;

  begin
    perform public.correct_issued_invoice_number('insurance_invoices', x.insurance_id,
      'INV-26-000051', 'INV-26-000050', 'Must reject retired number');
    raise exception 'TEST_RETIRED_NUMBER_REUSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_ALREADY_USED' then raise; end if;
  end;
  begin
    perform public.correct_issued_invoice_number('insurance_invoices', x.insurance_id,
      'INV-26-000051', 'INV-26-000052', 'Must reject active number');
    raise exception 'TEST_ACTIVE_NUMBER_REUSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_ALREADY_USED' then raise; end if;
  end;

  select s.next_value into n from public.invoice_number_sequences s
  where s.tenant_id = x.tenant_id and s.invoice_year = 2026;
  if n <> 102 then raise exception 'TEST_ISSUANCE_COUNTER_CHANGED'; end if;
  if (select count(*) from public.invoice_number_audit_events a
      where a.tenant_id = x.tenant_id and a.source_id = x.cash_id
        and a.event_type = 'renumbered') <> 2 then
    raise exception 'TEST_MULTIPLE_AUDIT_EVENTS_MISSING';
  end if;

  insert into public.accounting_fiscal_years
    (tenant_id, name, start_date, end_date)
  values (x.tenant_id, 'Closed correction runtime ' || x.closed_claim_id::text,
    '2026-01-01', '2026-12-31') returning id into closed_fiscal_id;
  insert into public.accounting_periods
    (tenant_id, fiscal_year_id, name, sequence, start_date, end_date, status)
  values (x.tenant_id, closed_fiscal_id, 'Closed correction runtime', 1,
    '2026-10-01', '2026-10-31', 'closed') returning id into closed_period_id;
  begin
    perform public.correct_historical_insurance_invoice_number(
      x.closed_insurance_id, '00075', 'INV-26-000075',
      'Closed accounting period must block');
    raise exception 'TEST_HISTORICAL_INSURANCE_CLOSED_PERIOD_CHANGED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED' then raise; end if;
  end;

  perform public.set_invoice_number_correction_window(0, 'Runtime window closed');
  begin
    perform public.correct_issued_invoice_number('insurance_invoices', x.insurance_id,
      'INV-26-000051', 'INV-26-000053', 'Must reject after close');
    raise exception 'TEST_CLOSED_WINDOW_BYPASSED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED' then raise; end if;
  end;
  update public.sales_documents d set status = 'cancelled' where d.id = x.cash_id;
  update public.sales_documents d set status = 'unpaid' where d.id = x.cash_id;
  update public.sales_documents d set status = 'cancelled' where d.id = x.cash_id;
  if (select count(*) from public.invoice_number_audit_events a
      where a.tenant_id = x.tenant_id and a.source_id = x.cash_id
        and a.event_type = 'cancelled') <> 1 then
    raise exception 'TEST_TERMINAL_EVENT_IDEMPOTENCY_REGRESSED';
  end if;
end $$;

reset role;
update public.user_roles r set role = 'manager'
where r.user_id = (select user_id from correction_runtime_context);
set local role authenticated;
do $$
declare x correction_runtime_context%rowtype;
begin
  select * into x from correction_runtime_context;
  begin
    perform public.set_invoice_number_correction_window(30, 'Manager must be denied');
    raise exception 'TEST_MANAGER_ALLOWED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' then raise; end if;
  end;
  begin
    perform public.correct_issued_invoice_number('sales_documents', x.cash_id,
      'INV-26-000052', 'INV-26-000054', 'Manager must be denied');
    raise exception 'TEST_MANAGER_CORRECTION_ALLOWED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' then raise; end if;
  end;
  begin
    perform public.correct_historical_cash_invoice_number(x.historic_cash_id,
      '00074', 'INV-26-000074', 'Manager must be denied');
    raise exception 'TEST_MANAGER_HISTORICAL_CASH_ALLOWED';
  exception when others then
    if sqlerrm <> 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' then raise; end if;
  end;
end $$;

reset role;
do $$ begin
  if has_function_privilege('anon',
    'public.correct_issued_invoice_number(text,uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon',
    'public.set_invoice_number_correction_window(integer,text)', 'EXECUTE')
     or has_function_privilege('anon',
    'public.correct_historical_cash_invoice_number(uuid,text,text,text)', 'EXECUTE') then
    raise exception 'TEST_ANONYMOUS_EXECUTE_ALLOWED';
  end if;
end $$;

rollback;
select 'PASS: cash + insurance + historical cash/insurance, posted historical format correction with immutable journal snapshot, temporary gate, aliases, accounting link, closed period, legacy slot, repeat correction, collision, direct-write guards, PDF snapshot, tenant/admin/anon, counter, audit, terminal idempotency, close; fixtures rolled back' as result;
