
DROP POLICY IF EXISTS "Avatars public read" ON storage.objects;

CREATE INDEX IF NOT EXISTS idx_invoices_tenant_status_date
  ON public.invoices (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_job_orders_tenant_status_date
  ON public.job_orders (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_claims_tenant_status_date
  ON public.insurance_claims (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_je_tenant_source_type
  ON public.journal_entries (tenant_id, source_type, source_id);
