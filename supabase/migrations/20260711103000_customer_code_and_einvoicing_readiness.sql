-- Non-destructive readiness foundation:
-- 1) customer_code display identifier while keeping customers.id as internal UUID.
-- 2) invoice locking/snapshot fields for e-invoicing readiness.
-- 3) tenant integration compatibility columns used by AI provider functions.

ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS customer_code text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS cr_number text,
  ADD COLUMN IF NOT EXISTS buyer_type text NOT NULL DEFAULT 'individual';

CREATE UNIQUE INDEX IF NOT EXISTS uq_customers_tenant_customer_code
  ON public.customers (tenant_id, lower(customer_code))
  WHERE customer_code IS NOT NULL AND nullif(trim(customer_code), '') IS NOT NULL;

CREATE OR REPLACE FUNCTION public.next_customer_code(p_tenant_id uuid, p_year int DEFAULT EXTRACT(YEAR FROM now())::int)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text := 'CUST-' || p_year::text || '-';
  v_next int;
BEGIN
  SELECT COALESCE(MAX(NULLIF(regexp_replace(customer_code, '^CUST-[0-9]{4}-', ''), '')::int), 0) + 1
    INTO v_next
  FROM public.customers
  WHERE tenant_id = p_tenant_id
    AND customer_code ~ ('^CUST-' || p_year::text || '-[0-9]+$');

  RETURN v_prefix || lpad(v_next::text, 4, '0');
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_customer_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.customer_code IS NULL OR trim(NEW.customer_code) = '' THEN
    NEW.customer_code := public.next_customer_code(
      NEW.tenant_id,
      COALESCE(EXTRACT(YEAR FROM NEW.created_at)::int, EXTRACT(YEAR FROM now())::int)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_customer_code ON public.customers;
CREATE TRIGGER trg_assign_customer_code
  BEFORE INSERT ON public.customers
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_customer_code();

WITH ranked AS (
  SELECT
    id,
    tenant_id,
    COALESCE(EXTRACT(YEAR FROM created_at)::int, EXTRACT(YEAR FROM now())::int) AS code_year,
    ROW_NUMBER() OVER (
      PARTITION BY tenant_id, COALESCE(EXTRACT(YEAR FROM created_at)::int, EXTRACT(YEAR FROM now())::int)
      ORDER BY created_at NULLS LAST, id
    ) AS seq
  FROM public.customers
  WHERE customer_code IS NULL OR trim(customer_code) = ''
)
UPDATE public.customers c
SET customer_code = 'CUST-' || ranked.code_year::text || '-' || lpad(ranked.seq::text, 4, '0')
FROM ranked
WHERE c.id = ranked.id;

ALTER TABLE public.insurance_companies
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS vat_number text,
  ADD COLUMN IF NOT EXISTS cr_number text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS contact_person text;

ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS invoice_status text NOT NULL DEFAULT 'draft',
  ADD COLUMN IF NOT EXISTS issued_at timestamptz,
  ADD COLUMN IF NOT EXISTS issued_by uuid,
  ADD COLUMN IF NOT EXISTS locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS locked_by uuid,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS credit_note_id uuid,
  ADD COLUMN IF NOT EXISTS invoice_snapshot_json jsonb,
  ADD COLUMN IF NOT EXISTS invoice_hash text,
  ADD COLUMN IF NOT EXISTS pdf_snapshot_url text;

CREATE INDEX IF NOT EXISTS idx_sales_documents_invoice_status
  ON public.sales_documents (tenant_id, invoice_status);

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS status text,
  ADD COLUMN IF NOT EXISTS last_error text;

