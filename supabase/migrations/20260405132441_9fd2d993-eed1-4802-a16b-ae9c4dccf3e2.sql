
-- =============================================
-- ENUMS
-- =============================================
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'technician', 'insurance', 'customer');
CREATE TYPE public.job_status AS ENUM ('received', 'inspection', 'waiting_parts', 'in_progress', 'completed', 'delivered');
CREATE TYPE public.subscription_plan AS ENUM ('free', 'basic', 'pro', 'enterprise');
CREATE TYPE public.invoice_status AS ENUM ('draft', 'sent', 'paid', 'overdue', 'cancelled');

-- =============================================
-- HELPER: updated_at trigger
-- =============================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =============================================
-- 1. TENANTS
-- =============================================
CREATE TABLE public.tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  subscription_plan public.subscription_plan NOT NULL DEFAULT 'free',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER update_tenants_updated_at BEFORE UPDATE ON public.tenants FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 2. PROFILES (linked to auth.users)
-- =============================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  role public.app_role NOT NULL DEFAULT 'technician',
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_profiles_tenant ON public.profiles(tenant_id);
CREATE INDEX idx_profiles_user ON public.profiles(user_id);
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 3. CUSTOMERS
-- =============================================
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  address TEXT,
  id_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_customers_tenant ON public.customers(tenant_id);
CREATE INDEX idx_customers_phone ON public.customers(phone);
CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 4. VEHICLES
-- =============================================
CREATE TABLE public.vehicles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  plate_number TEXT NOT NULL,
  vin_number TEXT,
  brand TEXT NOT NULL,
  model TEXT NOT NULL,
  year INTEGER,
  color TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_vehicles_tenant ON public.vehicles(tenant_id);
CREATE INDEX idx_vehicles_plate ON public.vehicles(plate_number);
CREATE INDEX idx_vehicles_customer ON public.vehicles(customer_id);
CREATE TRIGGER update_vehicles_updated_at BEFORE UPDATE ON public.vehicles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 5. JOB ORDERS
-- =============================================
CREATE TABLE public.job_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  vehicle_id UUID NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  customer_id UUID NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  technician_id UUID REFERENCES public.profiles(id),
  order_number TEXT NOT NULL,
  status public.job_status NOT NULL DEFAULT 'received',
  description TEXT,
  diagnosis TEXT,
  labor_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  parts_cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  subtotal NUMERIC(12,2) GENERATED ALWAYS AS (labor_cost + parts_cost) STORED,
  vat NUMERIC(12,2) GENERATED ALWAYS AS ((labor_cost + parts_cost) * 0.05) STORED,
  final_total NUMERIC(12,2) GENERATED ALWAYS AS ((labor_cost + parts_cost) * 1.05) STORED,
  insurance_claim_number TEXT,
  insurance_approved BOOLEAN DEFAULT false,
  estimated_completion TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_orders_tenant ON public.job_orders(tenant_id);
CREATE INDEX idx_job_orders_status ON public.job_orders(status);
CREATE INDEX idx_job_orders_vehicle ON public.job_orders(vehicle_id);
CREATE INDEX idx_job_orders_customer ON public.job_orders(customer_id);
CREATE INDEX idx_job_orders_number ON public.job_orders(order_number);
CREATE TRIGGER update_job_orders_updated_at BEFORE UPDATE ON public.job_orders FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 6. JOB ORDER LOGS (Audit)
-- =============================================
CREATE TABLE public.job_order_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,
  details JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_order_logs_order ON public.job_order_logs(job_order_id);

-- =============================================
-- 7. INVENTORY
-- =============================================
CREATE TABLE public.inventory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  part_number TEXT,
  category TEXT,
  quantity INTEGER NOT NULL DEFAULT 0,
  min_quantity INTEGER NOT NULL DEFAULT 5,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  location TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inventory_tenant ON public.inventory(tenant_id);
CREATE INDEX idx_inventory_part_number ON public.inventory(part_number);
CREATE TRIGGER update_inventory_updated_at BEFORE UPDATE ON public.inventory FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 8. JOB ORDER PARTS (links inventory to orders)
-- =============================================
CREATE TABLE public.job_order_parts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  inventory_id UUID NOT NULL REFERENCES public.inventory(id) ON DELETE CASCADE,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_price NUMERIC(12,2) GENERATED ALWAYS AS (quantity * unit_price) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_job_order_parts_order ON public.job_order_parts(job_order_id);

-- Auto-deduct inventory when parts are used
CREATE OR REPLACE FUNCTION public.deduct_inventory_on_part_insert()
RETURNS TRIGGER AS $$
BEGIN
  UPDATE public.inventory SET quantity = quantity - NEW.quantity WHERE id = NEW.inventory_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_deduct_inventory AFTER INSERT ON public.job_order_parts FOR EACH ROW EXECUTE FUNCTION public.deduct_inventory_on_part_insert();

-- =============================================
-- 9. INVOICES
-- =============================================
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  invoice_number TEXT NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL DEFAULT 0,
  vat NUMERIC(12,2) NOT NULL DEFAULT 0,
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  status public.invoice_status NOT NULL DEFAULT 'draft',
  due_date TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_invoices_tenant ON public.invoices(tenant_id);
CREATE INDEX idx_invoices_order ON public.invoices(job_order_id);
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON public.invoices FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 10. INSPECTIONS
-- =============================================
CREATE TABLE public.inspections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  job_order_id UUID NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  inspector_id UUID REFERENCES public.profiles(id),
  damage_type TEXT,
  notes TEXT,
  photos TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_inspections_order ON public.inspections(job_order_id);
CREATE TRIGGER update_inspections_updated_at BEFORE UPDATE ON public.inspections FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================
-- 11. DAMAGE MARKERS (SVG coordinates)
-- =============================================
CREATE TABLE public.damage_markers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  inspection_id UUID NOT NULL REFERENCES public.inspections(id) ON DELETE CASCADE,
  x NUMERIC NOT NULL,
  y NUMERIC NOT NULL,
  damage_type TEXT NOT NULL DEFAULT 'scratch',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_damage_markers_inspection ON public.damage_markers(inspection_id);

-- =============================================
-- SECURITY DEFINER FUNCTIONS
-- =============================================

-- Get current user's tenant_id
CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- Check user role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.profiles WHERE user_id = auth.uid() LIMIT 1
$$;

-- =============================================
-- RLS POLICIES
-- =============================================

-- TENANTS
ALTER TABLE public.tenants ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see own tenant" ON public.tenants FOR SELECT TO authenticated
  USING (id = public.get_user_tenant_id());
CREATE POLICY "Admins update tenant" ON public.tenants FOR UPDATE TO authenticated
  USING (id = public.get_user_tenant_id() AND public.get_user_role() = 'admin');

-- PROFILES
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users see profiles in tenant" ON public.profiles FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE TO authenticated
  USING (user_id = auth.uid());
CREATE POLICY "Admins insert profiles" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));

-- CUSTOMERS
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access customers" ON public.customers FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert customers" ON public.customers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Staff update customers" ON public.customers FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Admin delete customers" ON public.customers FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));

-- VEHICLES
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access vehicles" ON public.vehicles FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert vehicles" ON public.vehicles FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Staff update vehicles" ON public.vehicles FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Admin delete vehicles" ON public.vehicles FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));

-- JOB ORDERS
ALTER TABLE public.job_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access job_orders" ON public.job_orders FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert job_orders" ON public.job_orders FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Staff update job_orders" ON public.job_orders FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Admin delete job_orders" ON public.job_orders FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));

-- JOB ORDER LOGS
ALTER TABLE public.job_order_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access logs" ON public.job_order_logs FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "System insert logs" ON public.job_order_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

-- INVENTORY
ALTER TABLE public.inventory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access inventory" ON public.inventory FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff manage inventory" ON public.inventory FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));
CREATE POLICY "Staff update inventory" ON public.inventory FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));
CREATE POLICY "Admin delete inventory" ON public.inventory FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));

-- JOB ORDER PARTS
ALTER TABLE public.job_order_parts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access parts" ON public.job_order_parts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert parts" ON public.job_order_parts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));

-- INVOICES
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access invoices" ON public.invoices FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert invoices" ON public.invoices FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));
CREATE POLICY "Staff update invoices" ON public.invoices FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager'));

-- INSPECTIONS
ALTER TABLE public.inspections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access inspections" ON public.inspections FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert inspections" ON public.inspections FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));
CREATE POLICY "Staff update inspections" ON public.inspections FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));

-- DAMAGE MARKERS
ALTER TABLE public.damage_markers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Tenant access damage_markers" ON public.damage_markers FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "Staff insert damage_markers" ON public.damage_markers FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() IN ('admin', 'manager', 'technician'));

-- =============================================
-- STORAGE BUCKETS
-- =============================================
INSERT INTO storage.buckets (id, name, public) VALUES ('damage-photos', 'damage-photos', true);
INSERT INTO storage.buckets (id, name, public) VALUES ('invoices-pdf', 'invoices-pdf', false);

CREATE POLICY "Authenticated upload damage photos" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'damage-photos');
CREATE POLICY "Public view damage photos" ON storage.objects FOR SELECT
  USING (bucket_id = 'damage-photos');
CREATE POLICY "Authenticated upload invoices" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'invoices-pdf');
CREATE POLICY "Authenticated view invoices" ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'invoices-pdf');

-- =============================================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =============================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (user_id, tenant_id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE((NEW.raw_user_meta_data->>'tenant_id')::uuid, gen_random_uuid()),
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'admin')
  );
  -- If no tenant_id was provided, create one
  INSERT INTO public.tenants (id, name)
  SELECT p.tenant_id, COALESCE(NEW.raw_user_meta_data->>'company_name', 'ورشتي')
  FROM public.profiles p WHERE p.user_id = NEW.id
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =============================================
-- ORDER NUMBER GENERATOR
-- =============================================
CREATE SEQUENCE public.job_order_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_order_number()
RETURNS TRIGGER AS $$
BEGIN
  NEW.order_number = 'WO-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.job_order_seq')::text, 4, '0');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

CREATE TRIGGER trg_generate_order_number BEFORE INSERT ON public.job_orders FOR EACH ROW EXECUTE FUNCTION public.generate_order_number();
