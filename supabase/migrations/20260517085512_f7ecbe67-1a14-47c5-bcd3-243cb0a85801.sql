
-- Independent insurance estimates (not yet tied to a claim)
CREATE TABLE IF NOT EXISTS public.insurance_estimates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  estimate_number text NOT NULL,
  status text NOT NULL DEFAULT 'draft', -- draft | sent | approved | converted | cancelled
  customer_name text,
  customer_phone text,
  insurance_company text,
  insurance_company_id uuid,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  vehicle_year integer,
  vehicle_color text,
  incident_date date,
  incident_description text,
  estimation_type text NOT NULL DEFAULT 'lump_sum', -- lump_sum | upl
  lump_sum_amount numeric NOT NULL DEFAULT 0,
  upl_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  deductible_amount numeric NOT NULL DEFAULT 0,
  damage_photos text[] DEFAULT '{}',
  notes text,
  converted_claim_id uuid,
  converted_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE SEQUENCE IF NOT EXISTS public.insurance_estimate_seq;

CREATE OR REPLACE FUNCTION public.generate_insurance_estimate_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.estimate_number IS NULL OR NEW.estimate_number = '' THEN
    NEW.estimate_number := 'EST-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.insurance_estimate_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_insurance_estimate_number ON public.insurance_estimates;
CREATE TRIGGER trg_insurance_estimate_number
BEFORE INSERT ON public.insurance_estimates
FOR EACH ROW EXECUTE FUNCTION public.generate_insurance_estimate_number();

DROP TRIGGER IF EXISTS trg_insurance_estimate_updated ON public.insurance_estimates;
CREATE TRIGGER trg_insurance_estimate_updated
BEFORE UPDATE ON public.insurance_estimates
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.insurance_estimates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access insurance_estimates"
ON public.insurance_estimates FOR SELECT TO authenticated
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert insurance_estimates"
ON public.insurance_estimates FOR INSERT TO authenticated
WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role,'technician'::app_role]));

CREATE POLICY "Staff update insurance_estimates"
ON public.insurance_estimates FOR UPDATE TO authenticated
USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role]));

CREATE POLICY "Admin delete insurance_estimates"
ON public.insurance_estimates FOR DELETE TO authenticated
USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE INDEX IF NOT EXISTS idx_insurance_estimates_tenant ON public.insurance_estimates(tenant_id, created_at DESC);
