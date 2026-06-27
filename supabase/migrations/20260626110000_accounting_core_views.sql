-- Accounting Core views/RPCs.
-- Non-destructive: no data mutation, no constraints, no deletes.
-- Revenue excludes VAT. VAT is reported separately and never treated as profit.

CREATE OR REPLACE VIEW public.accounting_work_order_profit_view AS
WITH sales_invoice_totals AS (
  SELECT
    tenant_id,
    work_order_id,
    sum(subtotal)::numeric AS revenue_ex_vat,
    sum(tax_total)::numeric AS vat_output,
    sum(total)::numeric AS invoice_total,
    sum(paid_amount)::numeric AS paid_amount,
    array_agg(id) AS invoice_ids
  FROM public.sales_documents
  WHERE doc_type = 'invoice'
    AND status NOT IN ('draft', 'cancelled')
    AND work_order_id IS NOT NULL
  GROUP BY tenant_id, work_order_id
),
expense_totals AS (
  SELECT
    tenant_id,
    linked_work_order_id AS work_order_id,
    sum(
      CASE
        WHEN lower(coalesce(category_name, '') || ' ' || coalesce(description, '')) ~ '(part|spare|قطع|غيار)'
        THEN amount ELSE 0
      END
    )::numeric AS actual_spare_parts_cost,
    sum(
      CASE
        WHEN lower(coalesce(category_name, '') || ' ' || coalesce(description, '')) ~ '(labou?r|wage|عمال|أجر|اجور|أجور)'
        THEN amount ELSE 0
      END
    )::numeric AS actual_labour_cost,
    sum(
      CASE
        WHEN lower(coalesce(category_name, '') || ' ' || coalesce(description, '')) !~ '(part|spare|قطع|غيار|labou?r|wage|عمال|أجر|اجور|أجور)'
        THEN amount ELSE 0
      END
    )::numeric AS other_expenses
  FROM public.expenses
  WHERE linked_work_order_id IS NOT NULL
  GROUP BY tenant_id, linked_work_order_id
)
SELECT
  jo.tenant_id,
  jo.id AS work_order_id,
  jo.order_number AS work_order_number,
  jo.customer_id,
  jo.vehicle_id,
  CASE WHEN jo.insurance_claim_number IS NULL OR jo.insurance_claim_number = '' THEN 'general' ELSE 'insurance' END AS order_type,
  jo.status::text AS status,
  coalesce(si.revenue_ex_vat, jo.subtotal, 0)::numeric AS revenue_ex_vat,
  coalesce(si.vat_output, 0)::numeric AS vat_output,
  coalesce(si.invoice_total, coalesce(si.revenue_ex_vat, jo.subtotal, 0) + coalesce(si.vat_output, 0))::numeric AS invoice_total,
  coalesce(si.paid_amount, 0)::numeric AS paid_amount,
  greatest(coalesce(si.invoice_total, 0) - coalesce(si.paid_amount, 0), 0)::numeric AS outstanding_amount,
  CASE WHEN coalesce(et.actual_spare_parts_cost, 0) > 0 THEN et.actual_spare_parts_cost ELSE coalesce(jo.parts_cost, 0) END::numeric AS spare_parts_cost,
  CASE WHEN coalesce(et.actual_labour_cost, 0) > 0 THEN et.actual_labour_cost ELSE coalesce(jo.labor_cost, 0) END::numeric AS labour_cost,
  coalesce(et.other_expenses, 0)::numeric AS other_expenses,
  (
    CASE WHEN coalesce(et.actual_spare_parts_cost, 0) > 0 THEN et.actual_spare_parts_cost ELSE coalesce(jo.parts_cost, 0) END
    + CASE WHEN coalesce(et.actual_labour_cost, 0) > 0 THEN et.actual_labour_cost ELSE coalesce(jo.labor_cost, 0) END
    + coalesce(et.other_expenses, 0)
  )::numeric AS total_cost,
  (
    coalesce(si.revenue_ex_vat, jo.subtotal, 0)
    - (
      CASE WHEN coalesce(et.actual_spare_parts_cost, 0) > 0 THEN et.actual_spare_parts_cost ELSE coalesce(jo.parts_cost, 0) END
      + CASE WHEN coalesce(et.actual_labour_cost, 0) > 0 THEN et.actual_labour_cost ELSE coalesce(jo.labor_cost, 0) END
      + coalesce(et.other_expenses, 0)
    )
  )::numeric AS net_profit,
  CASE
    WHEN coalesce(si.revenue_ex_vat, jo.subtotal, 0) > 0 THEN
      (
        (
          coalesce(si.revenue_ex_vat, jo.subtotal, 0)
          - (
            CASE WHEN coalesce(et.actual_spare_parts_cost, 0) > 0 THEN et.actual_spare_parts_cost ELSE coalesce(jo.parts_cost, 0) END
            + CASE WHEN coalesce(et.actual_labour_cost, 0) > 0 THEN et.actual_labour_cost ELSE coalesce(jo.labor_cost, 0) END
            + coalesce(et.other_expenses, 0)
          )
        ) / coalesce(si.revenue_ex_vat, jo.subtotal, 0) * 100
      )::numeric
    ELSE NULL
  END AS profit_margin,
  CASE
    WHEN coalesce(et.actual_spare_parts_cost, 0) > 0 OR coalesce(et.actual_labour_cost, 0) > 0 OR coalesce(et.other_expenses, 0) > 0 THEN 'Actual Expenses'
    ELSE 'Estimated Costs'
  END AS final_cost_source
FROM public.job_orders jo
LEFT JOIN sales_invoice_totals si
  ON si.tenant_id = jo.tenant_id
 AND si.work_order_id = jo.id::text
LEFT JOIN expense_totals et
  ON et.tenant_id = jo.tenant_id
 AND et.work_order_id = jo.id::text
WHERE jo.tenant_id = public.get_user_tenant_id();

CREATE OR REPLACE VIEW public.accounting_claims_summary_view AS
WITH payments AS (
  SELECT tenant_id, claim_id, sum(amount)::numeric AS paid_amount
  FROM public.claim_payments
  GROUP BY tenant_id, claim_id
),
invoices AS (
  SELECT
    tenant_id,
    claim_id,
    sum(subtotal)::numeric AS invoice_subtotal,
    sum(vat)::numeric AS invoice_vat,
    sum(total)::numeric AS invoice_total,
    sum(paid_amount)::numeric AS invoice_paid_amount
  FROM public.insurance_invoices
  WHERE status NOT IN ('draft', 'cancelled')
  GROUP BY tenant_id, claim_id
),
expenses AS (
  SELECT tenant_id, linked_work_order_id AS work_order_id, sum(amount)::numeric AS expenses_total
  FROM public.expenses
  WHERE linked_work_order_id IS NOT NULL
  GROUP BY tenant_id, linked_work_order_id
)
SELECT
  c.tenant_id,
  c.id AS claim_id,
  c.claim_number,
  c.insurance_company_id,
  c.customer_id,
  c.vehicle_id,
  coalesce(c.approved_amount, 0)::numeric AS approved_amount,
  coalesce(i.invoice_subtotal, 0)::numeric AS invoice_subtotal,
  coalesce(i.invoice_vat, 0)::numeric AS invoice_vat,
  coalesce(i.invoice_total, 0)::numeric AS invoice_total,
  coalesce(p.paid_amount, i.invoice_paid_amount, 0)::numeric AS paid_amount,
  greatest(coalesce(i.invoice_total, 0) - coalesce(p.paid_amount, i.invoice_paid_amount, 0), 0)::numeric AS outstanding_amount,
  coalesce(e.expenses_total, 0)::numeric AS expenses_total,
  (coalesce(i.invoice_subtotal, 0) - coalesce(e.expenses_total, 0))::numeric AS net_profit,
  c.status::text AS status
FROM public.insurance_claims c
LEFT JOIN invoices i ON i.tenant_id = c.tenant_id AND i.claim_id = c.id
LEFT JOIN payments p ON p.tenant_id = c.tenant_id AND p.claim_id = c.id
LEFT JOIN expenses e ON e.tenant_id = c.tenant_id AND e.work_order_id = c.job_order_id::text
WHERE c.tenant_id = public.get_user_tenant_id()
  AND c.status::text NOT IN ('rejected', 'cancelled');

CREATE OR REPLACE FUNCTION public.accounting_dashboard_summary_rpc(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_work_type text DEFAULT NULL,
  p_insurance_company_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  WITH rows AS (
    SELECT *
    FROM public.accounting_work_order_profit_view
    WHERE (p_from_date IS NULL OR work_order_id IN (
      SELECT id FROM public.job_orders WHERE created_at::date >= p_from_date
    ))
      AND (p_to_date IS NULL OR work_order_id IN (
      SELECT id FROM public.job_orders WHERE created_at::date <= p_to_date
    ))
      AND (p_work_type IS NULL OR order_type = p_work_type)
  )
  SELECT jsonb_build_object(
    'total_revenue_ex_vat', coalesce(sum(revenue_ex_vat), 0),
    'total_vat_output', coalesce(sum(vat_output), 0),
    'total_invoice_amount', coalesce(sum(invoice_total), 0),
    'total_paid_amount', coalesce(sum(paid_amount), 0),
    'total_outstanding', coalesce(sum(outstanding_amount), 0),
    'total_expenses', coalesce(sum(total_cost), 0),
    'net_profit', coalesce(sum(net_profit), 0),
    'total_work_orders', count(*),
    'open_work_orders', count(*) FILTER (WHERE status NOT IN ('delivered', 'closed', 'cancelled')),
    'delivered_work_orders', count(*) FILTER (WHERE status IN ('delivered', 'closed'))
  )
  FROM rows;
$$;

CREATE OR REPLACE FUNCTION public.accounting_reports_summary_rpc(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT public.accounting_dashboard_summary_rpc(p_from_date, p_to_date, NULL, NULL);
$$;

GRANT SELECT ON public.accounting_work_order_profit_view TO authenticated;
GRANT SELECT ON public.accounting_claims_summary_view TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_dashboard_summary_rpc(date, date, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accounting_reports_summary_rpc(date, date) TO authenticated;
