
-- ============================================================
-- المرحلة 1: توسيع جداول قائمة + إنشاء جداول جديدة
-- ============================================================

-- 1) إضافة أعمدة على جداول قائمة
ALTER TABLE public.customers
  ADD COLUMN IF NOT EXISTS type text NOT NULL DEFAULT 'individual',
  ADD COLUMN IF NOT EXISTS contact_person text,
  ADD COLUMN IF NOT EXISTS commercial_registration text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_type text,
  ADD COLUMN IF NOT EXISTS mileage integer,
  ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_reason text;

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS entry_date date DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS technician_name text,
  ADD COLUMN IF NOT EXISTS diagnosis_notes text,
  ADD COLUMN IF NOT EXISTS insurance_company text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS parts_needed jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS stages jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE public.inventory
  ADD COLUMN IF NOT EXISTS cost_price numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS unit text DEFAULT 'قطعة',
  ADD COLUMN IF NOT EXISTS barcode text,
  ADD COLUMN IF NOT EXISTS supplier_id uuid,
  ADD COLUMN IF NOT EXISTS notes text;

-- ============================================================
-- 2) جدول المصروفات
-- ============================================================
CREATE TABLE IF NOT EXISTS public.expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  voucher_number text NOT NULL,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  category_id text,
  category_name text,
  cashbox_id text,
  cashbox_name text,
  payment_method text NOT NULL DEFAULT 'cash',
  beneficiary text,
  description text,
  linked_work_order_id text,
  linked_vehicle_plate text,
  linked_vehicle_name text,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.expenses TO authenticated;
GRANT ALL ON public.expenses TO service_role;

ALTER TABLE public.expenses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access expenses"
  ON public.expenses FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert expenses"
  ON public.expenses FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Staff update expenses"
  ON public.expenses FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE POLICY "Admin delete expenses"
  ON public.expenses FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON public.expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_expenses_tenant_date ON public.expenses(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_expenses_wo ON public.expenses(linked_work_order_id);

-- ============================================================
-- 3) دفتر اليومية + سطور القيد
-- ============================================================
CREATE TABLE IF NOT EXISTS public.journal_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entry_number text NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  source_type text,
  source_id text,
  source_reference text,
  total_debit numeric NOT NULL DEFAULT 0,
  total_credit numeric NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_entries TO authenticated;
GRANT ALL ON public.journal_entries TO service_role;

ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read journal"
  ON public.journal_entries FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert journal"
  ON public.journal_entries FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Admin update journal"
  ON public.journal_entries FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE POLICY "Admin delete journal"
  ON public.journal_entries FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = 'admin'::app_role
  );

CREATE TRIGGER trg_journal_entries_updated_at
  BEFORE UPDATE ON public.journal_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_je_tenant_date ON public.journal_entries(tenant_id, entry_date DESC);
CREATE INDEX IF NOT EXISTS idx_je_source ON public.journal_entries(source_type, source_id);

CREATE TABLE IF NOT EXISTS public.journal_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  entry_id uuid NOT NULL REFERENCES public.journal_entries(id) ON DELETE CASCADE,
  account_code text NOT NULL,
  account_name text NOT NULL,
  debit numeric NOT NULL DEFAULT 0,
  credit numeric NOT NULL DEFAULT 0,
  memo text,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.journal_lines TO authenticated;
GRANT ALL ON public.journal_lines TO service_role;

ALTER TABLE public.journal_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read journal_lines"
  ON public.journal_lines FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert journal_lines"
  ON public.journal_lines FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Admin manage journal_lines"
  ON public.journal_lines FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE INDEX IF NOT EXISTS idx_jl_entry ON public.journal_lines(entry_id);
CREATE INDEX IF NOT EXISTS idx_jl_account ON public.journal_lines(tenant_id, account_code);

-- ============================================================
-- 4) مستندات المبيعات (فواتير وعروض أسعار عامة)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  doc_number text NOT NULL,
  doc_type text NOT NULL DEFAULT 'invoice',
  date date NOT NULL DEFAULT CURRENT_DATE,
  due_date date,
  customer_id uuid,
  customer_name text,
  customer_phone text,
  vehicle_plate text,
  vehicle_make text,
  vehicle_model text,
  work_order_id text,
  items jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal numeric NOT NULL DEFAULT 0,
  discount_total numeric NOT NULL DEFAULT 0,
  tax_total numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  balance_due numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'draft',
  converted_invoice_id uuid,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_documents TO authenticated;
GRANT ALL ON public.sales_documents TO service_role;

ALTER TABLE public.sales_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access sales_documents"
  ON public.sales_documents FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert sales_documents"
  ON public.sales_documents FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role,'technician'::app_role])
  );

CREATE POLICY "Staff update sales_documents"
  ON public.sales_documents FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Admin delete sales_documents"
  ON public.sales_documents FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE TRIGGER trg_sales_documents_updated_at
  BEFORE UPDATE ON public.sales_documents
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX IF NOT EXISTS idx_sd_tenant_date ON public.sales_documents(tenant_id, date DESC);
CREATE INDEX IF NOT EXISTS idx_sd_type ON public.sales_documents(tenant_id, doc_type);
CREATE INDEX IF NOT EXISTS idx_sd_customer ON public.sales_documents(customer_id);

-- ============================================================
-- 5) دفعات المبيعات
-- ============================================================
CREATE TABLE IF NOT EXISTS public.sales_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  payment_number text NOT NULL,
  sales_document_id uuid NOT NULL REFERENCES public.sales_documents(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric NOT NULL DEFAULT 0,
  method text NOT NULL DEFAULT 'cash',
  reference text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sales_payments TO authenticated;
GRANT ALL ON public.sales_payments TO service_role;

ALTER TABLE public.sales_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access sales_payments"
  ON public.sales_payments FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert sales_payments"
  ON public.sales_payments FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Admin delete sales_payments"
  ON public.sales_payments FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE INDEX IF NOT EXISTS idx_sp_doc ON public.sales_payments(sales_document_id);
CREATE INDEX IF NOT EXISTS idx_sp_tenant_date ON public.sales_payments(tenant_id, date DESC);

-- ============================================================
-- 6) تفعيل Realtime على الجداول الجديدة + الحرجة
-- ============================================================
ALTER PUBLICATION supabase_realtime ADD TABLE public.expenses;
ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_entries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.journal_lines;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_documents;
ALTER PUBLICATION supabase_realtime ADD TABLE public.sales_payments;
