-- Development-only transaction. The complete fixture and invoice-number
-- allocation roll back; never run this against Production.
-- Important: the real payment-creation RPC calls PostgreSQL nextval(). Its
-- Development payment sequence can consume numbers even after ROLLBACK.
-- Invoice registry/table counters and operational rows roll back. Never reset
-- or reuse the payment sequence to hide these test-only gaps.
begin;
set local statement_timeout = '20s';

do $$
declare
  v_tenant uuid;
  v_manager uuid;
begin
  select p.tenant_id, p.user_id into v_tenant, v_manager
  from public.profiles p
  where p.role::text = 'manager'
  limit 1;
  if v_tenant is null or v_manager is null then
    raise exception 'DEVELOPMENT_MANAGER_FIXTURE_REQUIRED';
  end if;
  perform set_config('app.reports_receivable_test_tenant', v_tenant::text, true);
  perform set_config('app.reports_receivable_test_manager', v_manager::text, true);
  insert into public.accounting_role_permissions(tenant_id, role, permission_key, granted)
  values (v_tenant, 'manager', 'accounting.admin', true);

  insert into public.customers(id, tenant_id, name)
  values ('b9000000-0000-0000-0000-000000000004', v_tenant, 'Development Rollback Customer');

  insert into public.vehicles(id, tenant_id, customer_id, plate_number, plate_letters, plate_country, brand, model)
  values ('b9000000-0000-0000-0000-000000000005', v_tenant,
          'b9000000-0000-0000-0000-000000000004', '999999', 'DEV', 'OM', 'Test', 'Rollback');

  insert into public.insurance_claims
    (id, tenant_id, customer_id, vehicle_id, claim_number, insurance_company, estimated_amount, status)
  values
    ('b9000000-0000-0000-0000-000000000001', v_tenant,
     'b9000000-0000-0000-0000-000000000004',
     'b9000000-0000-0000-0000-000000000005',
     'DEV-REPORTS-SETTLEMENT-ROLLBACK', 'Development Test Insurer', 100, 'approved');

  insert into public.job_orders
    (id, tenant_id, vehicle_id, customer_id, order_number, claim_id, work_order_type)
  values
    ('b9000000-0000-0000-0000-000000000006', v_tenant,
     'b9000000-0000-0000-0000-000000000005',
     'b9000000-0000-0000-0000-000000000004',
     'WO-I-26-9999', 'b9000000-0000-0000-0000-000000000001', 'insurance');
  update public.insurance_claims
  set job_order_id = 'b9000000-0000-0000-0000-000000000006'
  where id = 'b9000000-0000-0000-0000-000000000001';

  insert into public.expense_categories
    (id, tenant_id, name, name_ar, name_en, code, expense_scope, accounting_mapping_key, is_active)
  values
    ('b9000000-0000-0000-0000-000000000007', v_tenant,
     'Development test parts', 'قطع تجريبية', 'Development test parts',
     'DEV_PARTS', 'work_order', 'parts', true);
  insert into public.expenses
    (id, tenant_id, voucher_number, date, amount, subtotal, total, description,
     expense_scope, work_order_id, expense_category_id)
  values
    ('b9000000-0000-0000-0000-000000000008', v_tenant,
     'DEV-REPORTS-SETTLEMENT-ROLLBACK',
     (date_trunc('month', current_date) - interval '1 day')::date,
     50, 50, 50, 'Development test parts',
     'work_order', 'b9000000-0000-0000-0000-000000000006',
     'b9000000-0000-0000-0000-000000000007');

  insert into public.insurance_invoices
    (id, tenant_id, invoice_number, claim_id, insurance_company_name,
     invoice_date, due_date, subtotal, vat, total, status)
  values
    ('b9000000-0000-0000-0000-000000000002', v_tenant, '',
     'b9000000-0000-0000-0000-000000000001', 'Development Test Insurer',
     (date_trunc('month', current_date) - interval '1 day')::date,
     (date_trunc('month', current_date) - interval '1 day')::date,
     95.238, 4.762, 100, 'issued');

  -- A separate cash invoice verifies channel isolation and actual receipt dates.
  insert into public.sales_documents
    (id, tenant_id, doc_number, doc_type, date, due_date, customer_id,
     customer_name, subtotal, tax_total, total, status)
  values
    ('b9000000-0000-0000-0000-000000000010', v_tenant, '', 'invoice',
     (date_trunc('month', current_date) - interval '1 day')::date,
     (date_trunc('month', current_date) - interval '1 day')::date,
     'b9000000-0000-0000-0000-000000000004', 'Development Rollback Customer',
     100, 0, 100, 'issued');
  insert into public.sales_payments
    (id, tenant_id, payment_number, sales_document_id, date, amount, method)
  values
    ('b9000000-0000-0000-0000-000000000011', v_tenant, 'DEV-CASH-ROLLBACK',
     'b9000000-0000-0000-0000-000000000010', current_date, 25, 'cash');
end;
$$;

do $$ begin perform set_config('request.jwt.claims',
  jsonb_build_object(
    'sub', current_setting('app.reports_receivable_test_manager'),
    'role', 'authenticated'
  )::text, true); end $$;
set local role authenticated;

do $$
declare
  v_tenant uuid := current_setting('app.reports_receivable_test_tenant')::uuid;
  v_invoice record;
  v_statement record;
  v_report jsonb;
  v_summary_before jsonb;
  v_summary_after jsonb;
  v_vehicle_report jsonb;
  v_previous_report jsonb;
  v_period_summary jsonb;
  v_wrong_tenant_denied boolean := false;
begin
  begin
    perform public.reports_center_secure_summary_rpc(
      'b9000000-0000-0000-0000-000000000099', null, null, 'insurance'
    );
  exception when insufficient_privilege then
    if sqlerrm <> 'reports_tenant_access_denied' then raise; end if;
    v_wrong_tenant_denied := true;
  end;
  if not v_wrong_tenant_denied then
    raise exception 'REPORT_SUMMARY_WRONG_TENANT_ALLOWED';
  end if;

  v_summary_before := public.reports_center_secure_summary_rpc(v_tenant, null, null, 'insurance');
  perform public.create_insurance_payment_with_settlement(
    'b9000000-0000-0000-0000-000000000001', 20, 'bank_transfer',
    (date_trunc('month', current_date) - interval '1 day')::date,
    'b9000000-0000-0000-0000-000000000002', null, 'DEV-REPORTS-ROLLBACK-1',
    null, null, 'cleared', 'Development rollback test', 0,
    null, 'b9000000-0000-0000-0000-000000000003'
  );
  -- Cancellation eligibility on a partially collected synthetic claim. A paid
  -- claim is intentionally immutable; do not disable that production safeguard.
  update public.insurance_claims set status = 'cancelled'
  where id = 'b9000000-0000-0000-0000-000000000001' and tenant_id = v_tenant;
  v_previous_report := public.monthly_vehicle_profitability_v3_rpc(
    (date_trunc('month', current_date) - interval '1 day')::date,
    (date_trunc('month', current_date) - interval '1 day')::date,
    'insurance', 'DEV-REPORTS-SETTLEMENT-ROLLBACK', 1, 50);
  if (v_previous_report#>>'{pagination,totalRows}')::integer is distinct from 0 then
    raise exception 'CANCELLED_CLAIM_LEAKED_INTO_VEHICLE_PNL: %', v_previous_report;
  end if;
  update public.insurance_claims set status = 'approved'
  where id = 'b9000000-0000-0000-0000-000000000001' and tenant_id = v_tenant;
  update public.job_orders set deleted_at = now()
  where id = 'b9000000-0000-0000-0000-000000000006' and tenant_id = v_tenant;
  v_previous_report := public.monthly_vehicle_profitability_v3_rpc(
    (date_trunc('month', current_date) - interval '1 day')::date,
    (date_trunc('month', current_date) - interval '1 day')::date,
    'insurance', 'DEV-REPORTS-SETTLEMENT-ROLLBACK', 1, 50);
  if (v_previous_report#>>'{pagination,totalRows}')::integer is distinct from 0 then
    raise exception 'DELETED_WORK_ORDER_LEAKED_INTO_VEHICLE_PNL: %', v_previous_report;
  end if;
  update public.job_orders set deleted_at = null
  where id = 'b9000000-0000-0000-0000-000000000006' and tenant_id = v_tenant;
  perform public.create_insurance_payment_with_settlement(
    'b9000000-0000-0000-0000-000000000001', 65, 'bank_transfer', current_date,
    'b9000000-0000-0000-0000-000000000002', null, 'DEV-REPORTS-ROLLBACK',
    null, null, 'cleared', 'Development rollback test', 15,
    'Approved early settlement test', 'b9000000-0000-0000-0000-000000000009'
  );

  select source_type, business_type, paid, outstanding, total
    into v_invoice
  from public.reports_invoice_facts_v1
  where tenant_id = v_tenant and id = 'b9000000-0000-0000-0000-000000000002';

  if not found then raise exception 'REPORT_INVOICE_NOT_VISIBLE_TO_MANAGER'; end if;
  if v_invoice.source_type is distinct from 'insurance_invoice'
     or v_invoice.business_type is distinct from 'insurance'
     or v_invoice.total is distinct from 100::numeric
     or v_invoice.paid is distinct from 85::numeric
     or v_invoice.outstanding is distinct from 0::numeric then
    raise exception 'SETTLEMENT_RECEIVABLE_MISMATCH: %', row_to_json(v_invoice);
  end if;

  select count(*) row_count, sum(paid) cash_collected,
         sum(coalesce(extra->>'settlementDiscount', '0')::numeric) discount_total
    into v_statement
  from public.reports_center_rows_v1
  where tenant_id = v_tenant
    and report_key = 'insurance_company_statement'
    and claim_id = 'b9000000-0000-0000-0000-000000000001';
  if v_statement.row_count is distinct from 4::bigint
     or v_statement.cash_collected is distinct from 85::numeric
     or v_statement.discount_total is distinct from 15::numeric then
    raise exception 'INSURER_STATEMENT_CASH_DISCOUNT_MIXED: %', row_to_json(v_statement);
  end if;

  if not exists (
    select 1 from public.reports_center_rows_v1
    where tenant_id = v_tenant
      and report_key = 'insurance_company_statement'
      and claim_id = 'b9000000-0000-0000-0000-000000000001'
      and status = 'settlement_discount'
      and outstanding = 0
      and paid = 0
  ) then raise exception 'INSURER_STATEMENT_DISCOUNT_DOES_NOT_CLOSE_BALANCE'; end if;

  v_report := public.reports_insurance_company_statement_rpc(
    v_tenant, null, null, 'insurance',
    jsonb_build_object('claimNumber', 'DEV-REPORTS-SETTLEMENT-ROLLBACK')
  );
  if (v_report->'aggregates'->>'paid')::numeric is distinct from 85::numeric
     or (v_report->'aggregates'->>'settlementDiscount')::numeric is distinct from 15::numeric
     or (v_report->'aggregates'->>'outstanding')::numeric is distinct from 0::numeric then
    raise exception 'INSURER_STATEMENT_RPC_TOTALS_MISMATCH: %', v_report->'aggregates';
  end if;

  v_summary_after := public.reports_center_secure_summary_rpc(v_tenant, null, null, 'insurance');
  if ((v_summary_after->>'paid')::numeric - (v_summary_before->>'paid')::numeric) is distinct from 85::numeric
     or ((v_summary_before->>'outstanding')::numeric - (v_summary_after->>'outstanding')::numeric) is distinct from 100::numeric
     or ((v_summary_before->>'claims_awaiting_collection')::integer
        - (v_summary_after->>'claims_awaiting_collection')::integer) is distinct from 1 then
    raise exception 'REPORT_SUMMARY_SETTLEMENT_MISMATCH: before %, after %',
      v_summary_before, v_summary_after;
  end if;

  v_vehicle_report := public.monthly_vehicle_profitability_v3_rpc(
    current_date, current_date, 'insurance', 'DEV-REPORTS-SETTLEMENT-ROLLBACK', 1, 50
  );
  if (v_vehicle_report#>>'{pagination,totalRows}')::integer is distinct from 1
     or round((v_vehicle_report#>>'{aggregates,direct_cost}')::numeric, 3) is distinct from 40.000::numeric
     or round((v_vehicle_report#>>'{aggregates,collected}')::numeric, 3) is distinct from 65.000::numeric then
    raise exception 'MONTHLY_SETTLEMENT_COST_RELEASE_MISMATCH: %', v_vehicle_report;
  end if;
  v_previous_report := public.monthly_vehicle_profitability_v3_rpc(
    (date_trunc('month', current_date) - interval '1 day')::date,
    (date_trunc('month', current_date) - interval '1 day')::date,
    'insurance', 'DEV-REPORTS-SETTLEMENT-ROLLBACK', 1, 50
  );
  if (v_previous_report#>>'{pagination,totalRows}')::integer is distinct from 1
     or round((v_previous_report#>>'{aggregates,direct_cost}')::numeric, 3) is distinct from 10.000::numeric
     or round((v_previous_report#>>'{aggregates,collected}')::numeric, 3) is distinct from 20.000::numeric then
    raise exception 'PREVIOUS_MONTH_COST_RELEASE_MISMATCH: %', v_previous_report;
  end if;

  -- Payment activity follows its actual month even when the invoice was issued
  -- earlier. Outstanding must agree with the selected invoices' canonical facts,
  -- not recreate a paid receivable by subtracting only that month's payments.
  v_period_summary := public.reports_center_secure_summary_rpc(v_tenant,
    (date_trunc('month', current_date) - interval '1 day')::date,
    (date_trunc('month', current_date) - interval '1 day')::date, 'insurance');
  if (v_period_summary->>'paid')::numeric is distinct from 20::numeric
     or (v_period_summary->>'outstanding')::numeric is distinct from 0::numeric then
    raise exception 'SUMMARY_INVOICE_COHORT_BALANCE_MISMATCH: %', v_period_summary;
  end if;
  v_period_summary := public.reports_center_secure_summary_rpc(v_tenant, current_date, current_date, 'insurance');
  if (v_period_summary->>'paid')::numeric is distinct from 65::numeric
     or (v_period_summary->>'invoice_total')::numeric is distinct from 0::numeric then
    raise exception 'SUMMARY_PAYMENT_MONTH_LOST: %', v_period_summary;
  end if;

  if (v_summary_after->>'overdue_invoices')::integer is distinct from 0 then
    raise exception 'SETTLED_INSURANCE_INVOICE_STILL_OVERDUE: %', v_summary_after;
  end if;
  v_period_summary := public.reports_center_secure_summary_rpc(v_tenant,
    (date_trunc('month', current_date) - interval '1 day')::date,
    (date_trunc('month', current_date) - interval '1 day')::date, 'cash');
  if (v_period_summary->>'paid')::numeric is distinct from 0::numeric
     or (v_period_summary->>'invoice_total')::numeric is distinct from 100::numeric
     or (v_period_summary->>'outstanding')::numeric is distinct from 75::numeric
     or (v_period_summary->>'overdue_invoices')::integer is distinct from 1 then
    raise exception 'CASH_INVOICE_COHORT_MISMATCH: %', v_period_summary;
  end if;
  v_period_summary := public.reports_center_secure_summary_rpc(v_tenant, current_date, current_date, 'cash');
  if (v_period_summary->>'paid')::numeric is distinct from 25::numeric
     or (v_period_summary->>'invoice_total')::numeric is distinct from 0::numeric
     or (v_period_summary->>'outstanding')::numeric is distinct from 0::numeric then
    raise exception 'CASH_PAYMENT_MONTH_MISMATCH: %', v_period_summary;
  end if;
  v_period_summary := public.reports_center_secure_summary_rpc(v_tenant, current_date, current_date, 'all');
  if (v_period_summary->>'paid')::numeric is distinct from 90::numeric then
    raise exception 'CASH_INSURANCE_RECEIPTS_MIXED_OR_DUPLICATED: %', v_period_summary;
  end if;
end;
$$;

set local role anon;
do $$
declare v_denied boolean := false;
begin
  begin
    perform public.reports_center_secure_summary_rpc(
      current_setting('app.reports_receivable_test_tenant')::uuid, null, null, 'all');
  exception when insufficient_privilege then v_denied := true;
  end;
  if not v_denied then raise exception 'ANONYMOUS_FINANCIAL_SUMMARY_ACCESS_ALLOWED'; end if;
end $$;
reset role;

select jsonb_build_object('passed', true, 'scope', 'Development rollback fixture',
  'checks', jsonb_build_array('tenant denial', 'invoice paid 85 balance 0 discount 15',
    'statement cash separated from discount', 'summary invoice-cohort parity',
    'actual payment month', 'cash/insurance separation', 'paid invoices not overdue',
    'monthly direct-cost release without duplication', 'cancelled claim excluded',
    'deleted work order excluded', 'anonymous summary denied')) as verification;
rollback;

