-- ===== Suppliers =====
CREATE TABLE public.suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  name text NOT NULL,
  contact_person text,
  phone text,
  email text,
  tax_number text,
  commercial_registration text,
  address text,
  bank_name text,
  iban text,
  payment_terms_days integer NOT NULL DEFAULT 30,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.suppliers TO authenticated;
GRANT ALL ON public.suppliers TO service_role;
ALTER TABLE public.suppliers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant read suppliers" ON public.suppliers FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Staff insert suppliers" ON public.suppliers FOR INSERT TO authenticated WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE POLICY "Staff update suppliers" ON public.suppliers FOR UPDATE TO authenticated USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE POLICY "Admin delete suppliers" ON public.suppliers FOR DELETE TO authenticated USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE TRIGGER update_suppliers_updated_at BEFORE UPDATE ON public.suppliers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== Purchase invoices =====
CREATE SEQUENCE IF NOT EXISTS public.purchase_invoice_seq START 1;
CREATE TABLE public.purchase_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_number text NOT NULL,
  supplier_invoice_number text,
  supplier_id uuid,
  supplier_name text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  subtotal numeric NOT NULL DEFAULT 0,
  vat numeric NOT NULL DEFAULT 0,
  discount numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_due numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'unpaid',
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.purchase_invoices TO authenticated;
GRANT ALL ON public.purchase_invoices TO service_role;
ALTER TABLE public.purchase_invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant read purchase_invoices" ON public.purchase_invoices FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Staff insert purchase_invoices" ON public.purchase_invoices FOR INSERT TO authenticated WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE POLICY "Staff update purchase_invoices" ON public.purchase_invoices FOR UPDATE TO authenticated USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE POLICY "Admin delete purchase_invoices" ON public.purchase_invoices FOR DELETE TO authenticated USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE TRIGGER update_purchase_invoices_updated_at BEFORE UPDATE ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE OR REPLACE FUNCTION public.generate_purchase_invoice_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := 'PI-' || lpad(nextval('public.purchase_invoice_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER set_purchase_invoice_number BEFORE INSERT ON public.purchase_invoices FOR EACH ROW EXECUTE FUNCTION public.generate_purchase_invoice_number();
CREATE INDEX idx_purchase_invoices_tenant_date ON public.purchase_invoices(tenant_id, date DESC);
CREATE INDEX idx_purchase_invoices_supplier ON public.purchase_invoices(supplier_id);

-- ===== Supplier payments =====
CREATE SEQUENCE IF NOT EXISTS public.supplier_payment_seq START 1;
CREATE TABLE public.supplier_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  payment_number text NOT NULL,
  supplier_id uuid,
  supplier_name text NOT NULL,
  purchase_invoice_id uuid,
  amount numeric NOT NULL DEFAULT 0,
  payment_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_method text NOT NULL DEFAULT 'bank_transfer',
  reference_number text,
  bank_name text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplier_payments TO authenticated;
GRANT ALL ON public.supplier_payments TO service_role;
ALTER TABLE public.supplier_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant read supplier_payments" ON public.supplier_payments FOR SELECT TO authenticated USING (tenant_id = get_user_tenant_id());
CREATE POLICY "Staff insert supplier_payments" ON public.supplier_payments FOR INSERT TO authenticated WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE POLICY "Staff update supplier_payments" ON public.supplier_payments FOR UPDATE TO authenticated USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE POLICY "Admin delete supplier_payments" ON public.supplier_payments FOR DELETE TO authenticated USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));
CREATE OR REPLACE FUNCTION public.generate_supplier_payment_number() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.payment_number IS NULL OR NEW.payment_number = '' THEN
    NEW.payment_number := 'SP-' || lpad(nextval('public.supplier_payment_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER set_supplier_payment_number BEFORE INSERT ON public.supplier_payments FOR EACH ROW EXECUTE FUNCTION public.generate_supplier_payment_number();
CREATE INDEX idx_supplier_payments_tenant_date ON public.supplier_payments(tenant_id, payment_date DESC);