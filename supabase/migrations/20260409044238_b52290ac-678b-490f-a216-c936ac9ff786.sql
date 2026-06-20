
-- Create insurance claim status enum
CREATE TYPE public.claim_status AS ENUM ('pending', 'approved', 'rejected', 'paid');

-- Create insurance_claims table
CREATE TABLE public.insurance_claims (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id),
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id),
  customer_id UUID NOT NULL REFERENCES public.customers(id),
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id),
  claim_number TEXT NOT NULL,
  insurance_company TEXT NOT NULL,
  estimated_amount NUMERIC NOT NULL DEFAULT 0,
  approved_amount NUMERIC DEFAULT 0,
  status claim_status NOT NULL DEFAULT 'pending',
  notes TEXT,
  rejection_reason TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  paid_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.insurance_claims ENABLE ROW LEVEL SECURITY;

-- RLS policies
CREATE POLICY "Tenant access insurance_claims"
ON public.insurance_claims FOR SELECT
TO authenticated
USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert insurance_claims"
ON public.insurance_claims FOR INSERT
TO authenticated
WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY(ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role, 'insurance'::app_role]));

CREATE POLICY "Staff update insurance_claims"
ON public.insurance_claims FOR UPDATE
TO authenticated
USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY(ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]));

CREATE POLICY "Admin delete insurance_claims"
ON public.insurance_claims FOR DELETE
TO authenticated
USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY(ARRAY['admin'::app_role, 'manager'::app_role]));

-- Updated_at trigger
CREATE TRIGGER update_insurance_claims_updated_at
BEFORE UPDATE ON public.insurance_claims
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Index for performance
CREATE INDEX idx_insurance_claims_tenant ON public.insurance_claims(tenant_id);
CREATE INDEX idx_insurance_claims_status ON public.insurance_claims(status);
CREATE INDEX idx_insurance_claims_company ON public.insurance_claims(insurance_company);

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_claims;
