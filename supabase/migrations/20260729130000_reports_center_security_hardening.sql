-- Reports Center security hardening.
-- The project grants functions to `anon` through existing default privileges,
-- so revoking only from PUBLIC is not sufficient.

revoke all on function public.reports_classify_business_type(uuid, text, text) from anon;
revoke all on function public.reports_center_summary_rpc(uuid, date, date, text, uuid) from anon;
revoke all on function public.reports_center_query_rpc(uuid, text, date, date, text, jsonb, text, text, text, integer, integer) from anon;

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'reports_claims_register_rpc',
    'reports_work_orders_rpc',
    'reports_invoices_rpc',
    'reports_payments_rpc',
    'reports_expenses_rpc',
    'reports_vehicles_in_workshop_rpc',
    'reports_completed_without_invoice_rpc',
    'reports_delivered_awaiting_collection_rpc',
    'reports_insurance_company_statement_rpc',
    'reports_aging_rpc',
    'reports_profitability_rpc'
  ]
  loop
    execute format(
      'revoke all on function public.%I(uuid,date,date,text,jsonb,text,text,text,integer,integer) from anon',
      fn
    );
  end loop;
end
$$;

revoke all on public.reports_work_order_facts_v1 from anon;
revoke all on public.reports_invoice_facts_v1 from anon;
revoke all on public.reports_payment_facts_v1 from anon;
revoke all on public.reports_expense_facts_v1 from anon;
revoke all on public.reports_insurance_statement_facts_v1 from anon;
revoke all on public.reports_center_rows_v1 from anon;
