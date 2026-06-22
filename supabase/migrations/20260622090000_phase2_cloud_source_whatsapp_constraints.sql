-- Phase 2: cloud source of truth, WhatsApp audit log, safe uniqueness, and sync.
-- This migration intentionally aborts before creating unique indexes if duplicates exist.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM public.insurance_claims
    WHERE nullif(trim(claim_number), '') IS NOT NULL
    GROUP BY tenant_id, lower(trim(claim_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PHASE2_DUPLICATES: duplicate insurance claim numbers exist; resolve them before applying this migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.job_orders
    WHERE nullif(trim(order_number), '') IS NOT NULL
    GROUP BY tenant_id, lower(trim(order_number))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PHASE2_DUPLICATES: duplicate job order numbers exist; resolve them before applying this migration';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.vehicles
    WHERE nullif(regexp_replace(coalesce(vin, vin_number, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL
    GROUP BY tenant_id, upper(regexp_replace(coalesce(vin, vin_number), '[^A-Za-z0-9]', '', 'g'))
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'PHASE2_DUPLICATES: duplicate VIN values exist; resolve them before applying this migration';
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_claims_tenant_claim_number
  ON public.insurance_claims (tenant_id, lower(trim(claim_number)))
  WHERE nullif(trim(claim_number), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_orders_tenant_order_number
  ON public.job_orders (tenant_id, lower(trim(order_number)))
  WHERE nullif(trim(order_number), '') IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_vehicles_tenant_normalized_vin
  ON public.vehicles (
    tenant_id,
    upper(regexp_replace(coalesce(vin, vin_number), '[^A-Za-z0-9]', '', 'g'))
  )
  WHERE nullif(regexp_replace(coalesce(vin, vin_number, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL;

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS estimate_date date,
  ADD COLUMN IF NOT EXISTS workshop_arrival_date timestamptz,
  ADD COLUMN IF NOT EXISTS work_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS work_completed_at timestamptz;

CREATE TABLE IF NOT EXISTS public.whatsapp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  insurance_claim_id uuid REFERENCES public.insurance_claims(id) ON DELETE SET NULL,
  job_order_id uuid REFERENCES public.job_orders(id) ON DELETE SET NULL,
  recipient_type text NOT NULL DEFAULT 'customer'
    CHECK (recipient_type IN ('customer', 'supplier', 'insurance', 'other')),
  recipient_name text,
  recipient_phone text NOT NULL,
  message_kind text NOT NULL DEFAULT 'custom',
  message_body text NOT NULL,
  media_url text,
  provider_message_id text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sent', 'failed', 'delivered', 'read')),
  error_message text,
  sent_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_tenant_created
  ON public.whatsapp_logs (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_job_order
  ON public.whatsapp_logs (job_order_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_claim
  ON public.whatsapp_logs (insurance_claim_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_logs_provider_message
  ON public.whatsapp_logs (provider_message_id)
  WHERE provider_message_id IS NOT NULL;

ALTER TABLE public.whatsapp_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant read whatsapp logs" ON public.whatsapp_logs;
CREATE POLICY "Tenant read whatsapp logs"
  ON public.whatsapp_logs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Staff insert whatsapp logs" ON public.whatsapp_logs;
CREATE POLICY "Staff insert whatsapp logs"
  ON public.whatsapp_logs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role()::text IN ('admin', 'manager', 'supervisor', 'accountant', 'insurance')
  );

DROP POLICY IF EXISTS "Staff update whatsapp logs" ON public.whatsapp_logs;
CREATE POLICY "Staff update whatsapp logs"
  ON public.whatsapp_logs FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role()::text IN ('admin', 'manager', 'supervisor', 'accountant', 'insurance')
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "Admin delete whatsapp logs" ON public.whatsapp_logs;
CREATE POLICY "Admin delete whatsapp logs"
  ON public.whatsapp_logs FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role()::text IN ('admin', 'manager')
  );

CREATE OR REPLACE FUNCTION public.sync_claim_from_job_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.insurance_claim_number IS NULL OR trim(NEW.insurance_claim_number) = '' THEN
    RETURN NEW;
  END IF;

  UPDATE public.insurance_claims
  SET
    job_order_id = COALESCE(job_order_id, NEW.id),
    auto_job_order_id = COALESCE(auto_job_order_id, NEW.id),
    work_started_at = CASE
      WHEN NEW.status = 'in_progress' AND work_started_at IS NULL THEN now()
      ELSE work_started_at
    END,
    work_completed_at = CASE
      WHEN NEW.status IN ('completed', 'delivered') AND work_completed_at IS NULL THEN now()
      ELSE work_completed_at
    END,
    delivered_at = CASE
      WHEN NEW.status = 'delivered' AND delivered_at IS NULL THEN now()
      ELSE delivered_at
    END,
    updated_at = now()
  WHERE tenant_id = NEW.tenant_id
    AND lower(trim(claim_number)) = lower(trim(NEW.insurance_claim_number));

  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_sync_claim_from_job_order ON public.job_orders;
CREATE TRIGGER trg_sync_claim_from_job_order
AFTER INSERT OR UPDATE OF status, insurance_claim_number
ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.sync_claim_from_job_order();

CREATE OR REPLACE FUNCTION public.touch_job_order_for_expense()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE(NEW.linked_work_order_id, OLD.linked_work_order_id) IS NOT NULL THEN
    UPDATE public.job_orders
    SET updated_at = now()
    WHERE tenant_id = COALESCE(NEW.tenant_id, OLD.tenant_id)
      AND (
        id::text = COALESCE(NEW.linked_work_order_id, OLD.linked_work_order_id)
        OR order_number = COALESCE(NEW.linked_work_order_id, OLD.linked_work_order_id)
      );
  END IF;
  RETURN COALESCE(NEW, OLD);
END
$$;

DROP TRIGGER IF EXISTS trg_touch_job_order_for_expense ON public.expenses;
CREATE TRIGGER trg_touch_job_order_for_expense
AFTER INSERT OR UPDATE OR DELETE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.touch_job_order_for_expense();

-- Ensure realtime invalidation can observe operational changes.
DO $$
BEGIN
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_logs; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.job_orders; EXCEPTION WHEN duplicate_object THEN NULL; END;
  BEGIN ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_claims; EXCEPTION WHEN duplicate_object THEN NULL; END;
END
$$;

-- Cloud-only reporting views. security_invoker keeps the caller's RLS constraints.
CREATE OR REPLACE VIEW public.workshop_operations_report
WITH (security_invoker = true)
AS
SELECT
  jo.tenant_id,
  jo.id AS job_order_id,
  jo.order_number,
  jo.status,
  jo.entry_date,
  jo.completed_at,
  jo.updated_at,
  jo.customer_id,
  c.name AS customer_name,
  c.phone AS customer_phone,
  jo.vehicle_id,
  concat_ws(' ', v.plate_letters, v.plate_number) AS vehicle_plate,
  v.brand AS vehicle_make,
  v.model AS vehicle_model,
  jo.insurance_claim_number,
  jo.insurance_company,
  jo.labor_cost,
  jo.parts_cost,
  jo.final_total,
  COALESCE((
    SELECT sum(e.amount)
    FROM public.expenses e
    WHERE e.tenant_id = jo.tenant_id
      AND (e.linked_work_order_id = jo.id::text OR e.linked_work_order_id = jo.order_number)
  ), 0) AS expenses_total
FROM public.job_orders jo
JOIN public.customers c ON c.id = jo.customer_id
JOIN public.vehicles v ON v.id = jo.vehicle_id;

GRANT SELECT ON public.workshop_operations_report TO authenticated;

CREATE OR REPLACE VIEW public.delivered_vehicles_report
WITH (security_invoker = true)
AS
SELECT *
FROM public.workshop_operations_report
WHERE status = 'delivered';

GRANT SELECT ON public.delivered_vehicles_report TO authenticated;

CREATE OR REPLACE VIEW public.claims_archive_report
WITH (security_invoker = true)
AS
SELECT
  ic.tenant_id,
  ic.id AS claim_id,
  ic.claim_number,
  ic.status,
  ic.insurance_company,
  ic.insurance_company_id,
  ic.customer_id,
  c.name AS customer_name,
  c.phone AS customer_phone,
  ic.vehicle_id,
  COALESCE(ic.vehicle_plate, concat_ws(' ', v.plate_letters, v.plate_number)) AS vehicle_plate,
  COALESCE(ic.vehicle_make, v.brand) AS vehicle_make,
  COALESCE(ic.vehicle_model, v.model) AS vehicle_model,
  ic.estimated_amount,
  ic.approved_amount,
  ic.workshop_arrival_date,
  ic.work_started_at,
  ic.work_completed_at,
  ic.delivered_at,
  ic.job_order_id,
  jo.order_number,
  ic.created_at,
  ic.updated_at
FROM public.insurance_claims ic
JOIN public.customers c ON c.id = ic.customer_id
LEFT JOIN public.vehicles v ON v.id = ic.vehicle_id
LEFT JOIN public.job_orders jo ON jo.id = ic.job_order_id;

GRANT SELECT ON public.claims_archive_report TO authenticated;

CREATE OR REPLACE VIEW public.insurance_statement_report
WITH (security_invoker = true)
AS
SELECT
  ii.tenant_id,
  ii.id AS invoice_id,
  ii.invoice_number,
  ii.insurance_company_id,
  ii.insurance_company_name,
  ii.claim_id,
  ic.claim_number,
  ii.issued_at,
  ii.due_date,
  ii.status,
  ii.subtotal,
  ii.vat,
  ii.total,
  ii.paid_amount,
  greatest(ii.total - ii.paid_amount, 0) AS balance_due,
  ii.last_payment_date,
  ii.vehicle_plate,
  ii.pdf_url
FROM public.insurance_invoices ii
JOIN public.insurance_claims ic ON ic.id = ii.claim_id;

GRANT SELECT ON public.insurance_statement_report TO authenticated;

CREATE OR REPLACE VIEW public.sales_invoices_archive_report
WITH (security_invoker = true)
AS
SELECT
  sd.tenant_id,
  sd.id AS invoice_id,
  sd.doc_number AS invoice_number,
  sd.customer_id,
  sd.customer_name,
  sd.date,
  sd.due_date,
  sd.status,
  sd.subtotal,
  sd.tax_total AS vat,
  sd.total,
  sd.paid_amount,
  sd.balance_due,
  sd.vehicle_plate,
  sd.work_order_id,
  sd.created_at,
  sd.updated_at
FROM public.sales_documents sd
WHERE sd.doc_type = 'invoice';

GRANT SELECT ON public.sales_invoices_archive_report TO authenticated;
