-- Non-destructive accounting metadata for expense classification and VAT reporting.
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS expense_type text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS cost_center text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS subtotal numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_amount numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total numeric(12,3) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_vat_applicable boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS supplier_tax_number text,
  ADD COLUMN IF NOT EXISTS supplier_invoice_number text;

UPDATE public.expenses
SET
  expense_type = COALESCE(NULLIF(expense_type, ''), COALESCE(meta->>'expenseType', 'unassigned')),
  cost_center = COALESCE(NULLIF(cost_center, ''), COALESCE(meta->>'costCenter', 'unassigned')),
  subtotal = CASE WHEN subtotal = 0 THEN ROUND(COALESCE(amount, 0)::numeric, 3) ELSE subtotal END,
  vat_amount = CASE WHEN vat_amount = 0 THEN ROUND((COALESCE(amount, 0) * 0.05)::numeric, 3) ELSE vat_amount END,
  total = CASE WHEN total = 0 THEN ROUND((COALESCE(amount, 0) * 1.05)::numeric, 3) ELSE total END,
  is_vat_applicable = COALESCE(is_vat_applicable, true),
  supplier_tax_number = COALESCE(supplier_tax_number, meta->>'supplierTaxNumber'),
  supplier_invoice_number = COALESCE(supplier_invoice_number, meta->>'supplierInvoiceNumber')
WHERE true;

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_type_date
  ON public.expenses(tenant_id, expense_type, date DESC);

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_cost_center
  ON public.expenses(tenant_id, cost_center);
