
-- جدول الدفعات المقدمة من العملاء (Customer Advances / Payments Received)
-- مفصول تماماً عن المصروفات والقطع
CREATE TABLE IF NOT EXISTS public.customer_advances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  receipt_number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL CHECK (amount > 0),
  scope text NOT NULL CHECK (scope IN ('customer','vehicle')),
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  customer_name text NOT NULL,
  customer_phone text,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  vehicle_plate text,
  job_order_id uuid REFERENCES public.job_orders(id) ON DELETE SET NULL,
  payment_method text NOT NULL DEFAULT 'cash',
  cashbox_id text,
  cashbox_name text,
  notes text,
  consumed numeric NOT NULL DEFAULT 0 CHECK (consumed >= 0),
  applied_to_work_order_id uuid REFERENCES public.job_orders(id) ON DELETE SET NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_customer_advances_tenant_date ON public.customer_advances(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_customer_advances_customer ON public.customer_advances(customer_id);
CREATE INDEX IF NOT EXISTS idx_customer_advances_vehicle ON public.customer_advances(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_customer_advances_wo ON public.customer_advances(job_order_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_advances TO authenticated;
GRANT ALL ON public.customer_advances TO service_role;

ALTER TABLE public.customer_advances ENABLE ROW LEVEL SECURITY;

-- قراءة: كل أدوار الورشة عدا الفني والعميل
CREATE POLICY "Staff read customer advances"
ON public.customer_advances FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() NOT IN ('technician','customer')
);

-- إدخال: admin/manager/insurance
CREATE POLICY "Staff insert customer advances"
ON public.customer_advances FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() IN ('admin','manager','insurance')
);

-- تعديل: admin/manager
CREATE POLICY "Manager update customer advances"
ON public.customer_advances FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() IN ('admin','manager')
);

-- حذف: admin فقط
CREATE POLICY "Admin delete customer advances"
ON public.customer_advances FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = 'admin'
);

CREATE TRIGGER trg_customer_advances_updated_at
BEFORE UPDATE ON public.customer_advances
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ===== حماية المصروفات من التصنيف الخاطئ =====
-- منع إدخال أي مصروف بفئة "دفعة عميل" أو "Payment Received" (يجب استخدام customer_advances)
CREATE OR REPLACE FUNCTION public.block_payment_in_expenses()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat text;
BEGIN
  v_cat := lower(trim(COALESCE(NEW.category_name, NEW.category_id, '')));
  IF v_cat ~ '(دفعة|دفعات|عربون|advance|payment received|customer payment)' THEN
    RAISE EXCEPTION 'لا يمكن تسجيل دفعة عميل ضمن المصروفات. استخدم شاشة الدفعات المقدمة (Customer Advances).'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_payment_in_expenses ON public.expenses;
CREATE TRIGGER trg_block_payment_in_expenses
BEFORE INSERT OR UPDATE ON public.expenses
FOR EACH ROW EXECUTE FUNCTION public.block_payment_in_expenses();
