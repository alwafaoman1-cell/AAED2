
-- 1) Work-order invoices: idempotency + single active invoice per work order
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_invoice_idempotency
  ON public.invoices(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_invoice_per_workorder
  ON public.invoices(job_order_id)
  WHERE status <> 'cancelled'::invoice_status;

-- 2) Insurance invoices: idempotency (active-per-claim guard already exists)
ALTER TABLE public.insurance_invoices
  ADD COLUMN IF NOT EXISTS idempotency_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_ins_invoice_idempotency
  ON public.insurance_invoices(tenant_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
