ALTER TABLE public.insurance_invoices
  ADD COLUMN IF NOT EXISTS lpo_number text,
  ADD COLUMN IF NOT EXISTS items jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE INDEX IF NOT EXISTS idx_insurance_invoices_lpo ON public.insurance_invoices(lpo_number);