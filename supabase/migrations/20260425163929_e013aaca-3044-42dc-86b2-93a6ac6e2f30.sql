
-- 1. جدول شركات التأمين
CREATE TABLE public.insurance_companies (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  contact_person TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  default_deductible_percent NUMERIC NOT NULL DEFAULT 0,
  payment_terms_days INTEGER NOT NULL DEFAULT 30,
  notes TEXT,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.insurance_companies ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access insurance_companies"
  ON public.insurance_companies FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert insurance_companies"
  ON public.insurance_companies FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role]));

CREATE POLICY "Staff update insurance_companies"
  ON public.insurance_companies FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]));

CREATE POLICY "Admin delete insurance_companies"
  ON public.insurance_companies FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE TRIGGER update_insurance_companies_updated_at
  BEFORE UPDATE ON public.insurance_companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_insurance_companies_tenant ON public.insurance_companies(tenant_id);

-- 2. تسلسل لرقم الدفعة
CREATE SEQUENCE IF NOT EXISTS public.claim_payment_seq START 1;

-- 3. جدول دفعات المطالبات
CREATE TYPE public.claim_payment_method AS ENUM ('bank_transfer', 'cheque', 'offset', 'cash');
CREATE TYPE public.claim_payment_status AS ENUM ('pending', 'cleared', 'bounced');

CREATE TABLE public.claim_payments (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  claim_id UUID NOT NULL,
  insurance_company_id UUID,
  payment_number TEXT NOT NULL,
  amount NUMERIC NOT NULL DEFAULT 0,
  payment_method public.claim_payment_method NOT NULL DEFAULT 'bank_transfer',
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  reference_number TEXT,
  bank_name TEXT,
  cheque_due_date DATE,
  offset_against_invoice_id UUID,
  status public.claim_payment_status NOT NULL DEFAULT 'cleared',
  notes TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.claim_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access claim_payments"
  ON public.claim_payments FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert claim_payments"
  ON public.claim_payments FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]));

CREATE POLICY "Staff update claim_payments"
  ON public.claim_payments FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]));

CREATE POLICY "Admin delete claim_payments"
  ON public.claim_payments FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE TRIGGER update_claim_payments_updated_at
  BEFORE UPDATE ON public.claim_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX idx_claim_payments_tenant ON public.claim_payments(tenant_id);
CREATE INDEX idx_claim_payments_claim ON public.claim_payments(claim_id);
CREATE INDEX idx_claim_payments_company ON public.claim_payments(insurance_company_id);

-- 4. توليد رقم الدفعة تلقائياً
CREATE OR REPLACE FUNCTION public.generate_claim_payment_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.payment_number IS NULL OR NEW.payment_number = '' THEN
    NEW.payment_number = 'IP-' || lpad(nextval('public.claim_payment_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_claim_payment_number
  BEFORE INSERT ON public.claim_payments
  FOR EACH ROW EXECUTE FUNCTION public.generate_claim_payment_number();

-- 5. ربط المطالبات بشركات التأمين
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS insurance_company_id UUID;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_company ON public.insurance_claims(insurance_company_id);
