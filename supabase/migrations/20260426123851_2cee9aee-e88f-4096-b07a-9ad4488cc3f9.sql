-- ============================================
-- 1. مكتبة ماركات السيارات
-- ============================================
CREATE TABLE IF NOT EXISTS public.vehicle_makes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  name_ar text,
  tenant_id uuid,
  is_global boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, tenant_id)
);

CREATE TABLE IF NOT EXISTS public.vehicle_models (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  make_id uuid NOT NULL REFERENCES public.vehicle_makes(id) ON DELETE CASCADE,
  name text NOT NULL,
  name_ar text,
  tenant_id uuid,
  is_global boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (make_id, name, tenant_id)
);

CREATE INDEX idx_vehicle_models_make ON public.vehicle_models(make_id);

ALTER TABLE public.vehicle_makes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_models ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads global or own makes"
  ON public.vehicle_makes FOR SELECT TO authenticated
  USING (is_global = true OR tenant_id = get_user_tenant_id());

CREATE POLICY "staff insert own makes"
  ON public.vehicle_makes FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'technician'::app_role,'insurance'::app_role])
  );

CREATE POLICY "admin update own makes"
  ON public.vehicle_makes FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "admin delete own makes"
  ON public.vehicle_makes FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "anyone reads global or own models"
  ON public.vehicle_models FOR SELECT TO authenticated
  USING (is_global = true OR tenant_id = get_user_tenant_id());

CREATE POLICY "staff insert own models"
  ON public.vehicle_models FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'technician'::app_role,'insurance'::app_role])
  );

CREATE POLICY "admin update own models"
  ON public.vehicle_models FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

CREATE POLICY "admin delete own models"
  ON public.vehicle_models FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));

-- ============================================
-- 2. تعبئة المكتبة الجاهزة
-- ============================================
INSERT INTO public.vehicle_makes (name, name_ar, is_global) VALUES
('Toyota','تويوتا',true),('Nissan','نيسان',true),('Hyundai','هيونداي',true),
('Kia','كيا',true),('Honda','هوندا',true),('Lexus','لكزس',true),
('Mitsubishi','ميتسوبيشي',true),('Mazda','مازدا',true),('Ford','فورد',true),
('Chevrolet','شيفروليه',true),('GMC','جي إم سي',true),('Cadillac','كاديلاك',true),
('Mercedes-Benz','مرسيدس',true),('BMW','بي إم دبليو',true),('Audi','أودي',true),
('Volkswagen','فولكس فاجن',true),('Porsche','بورش',true),('Land Rover','لاند روفر',true),
('Range Rover','رينج روفر',true),('Jaguar','جاكوار',true),('MG','إم جي جي',true),
('Geely','جيلي',true),('Chery','شيري',true),('Changan',' تشانجان',true),
('Haval','هافال',true),('Suzuki','سوزوكي',true),('Subaru','سوبارو',true),
('Infiniti','إنفينيتي',true),('Genesis','جينيسيس',true),('Renault','رينو',true),
('Peugeot','بيجو',true),('Jeep','جيب',true),('Dodge','دودج',true),
('Isuzu','إيسوزو',true),('Volvo','فولفو',true)
ON CONFLICT DO NOTHING;

-- موديلات شائعة
DO $$
DECLARE
  m_id uuid;
BEGIN
  -- Toyota
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Toyota' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Camry',true),(m_id,'Corolla',true),(m_id,'Land Cruiser',true),(m_id,'Prado',true),
    (m_id,'Hilux',true),(m_id,'Fortuner',true),(m_id,'Yaris',true),(m_id,'Avalon',true),
    (m_id,'Innova',true),(m_id,'Rav4',true),(m_id,'Highlander',true),(m_id,'Hiace',true),
    (m_id,'Coaster',true),(m_id,'FJ Cruiser',true),(m_id,'Rush',true)
  ON CONFLICT DO NOTHING;

  -- Nissan
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Nissan' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Patrol',true),(m_id,'Altima',true),(m_id,'Sunny',true),(m_id,'Sentra',true),
    (m_id,'Maxima',true),(m_id,'X-Trail',true),(m_id,'Pathfinder',true),(m_id,'Navara',true),
    (m_id,'Urvan',true),(m_id,'Kicks',true),(m_id,'Juke',true),(m_id,'Armada',true)
  ON CONFLICT DO NOTHING;

  -- Hyundai
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Hyundai' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Sonata',true),(m_id,'Elantra',true),(m_id,'Accent',true),(m_id,'Tucson',true),
    (m_id,'Santa Fe',true),(m_id,'Creta',true),(m_id,'H1',true),(m_id,'Azera',true),
    (m_id,'Palisade',true),(m_id,'Staria',true),(m_id,'Kona',true),(m_id,'Veloster',true)
  ON CONFLICT DO NOTHING;

  -- Kia
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Kia' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Cerato',true),(m_id,'Optima',true),(m_id,'Sportage',true),(m_id,'Sorento',true),
    (m_id,'Picanto',true),(m_id,'Rio',true),(m_id,'Carnival',true),(m_id,'Telluride',true),
    (m_id,'Seltos',true),(m_id,'K5',true),(m_id,'Mohave',true)
  ON CONFLICT DO NOTHING;

  -- Honda
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Honda' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Accord',true),(m_id,'Civic',true),(m_id,'CR-V',true),(m_id,'Pilot',true),
    (m_id,'Odyssey',true),(m_id,'HR-V',true),(m_id,'City',true)
  ON CONFLICT DO NOTHING;

  -- Lexus
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Lexus' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'ES',true),(m_id,'LS',true),(m_id,'LX',true),(m_id,'GX',true),
    (m_id,'RX',true),(m_id,'NX',true),(m_id,'IS',true),(m_id,'LC',true)
  ON CONFLICT DO NOTHING;

  -- Mitsubishi
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Mitsubishi' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Pajero',true),(m_id,'L200',true),(m_id,'Lancer',true),(m_id,'Outlander',true),
    (m_id,'ASX',true),(m_id,'Montero Sport',true),(m_id,'Attrage',true)
  ON CONFLICT DO NOTHING;

  -- Mazda
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Mazda' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'CX-5',true),(m_id,'CX-9',true),(m_id,'CX-30',true),(m_id,'Mazda 3',true),
    (m_id,'Mazda 6',true),(m_id,'BT-50',true)
  ON CONFLICT DO NOTHING;

  -- Ford
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Ford' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'F-150',true),(m_id,'Ranger',true),(m_id,'Explorer',true),(m_id,'Edge',true),
    (m_id,'Expedition',true),(m_id,'Mustang',true),(m_id,'Escape',true),(m_id,'Territory',true)
  ON CONFLICT DO NOTHING;

  -- Chevrolet
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Chevrolet' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Tahoe',true),(m_id,'Suburban',true),(m_id,'Silverado',true),(m_id,'Captiva',true),
    (m_id,'Malibu',true),(m_id,'Camaro',true),(m_id,'Cruze',true),(m_id,'Trailblazer',true)
  ON CONFLICT DO NOTHING;

  -- GMC
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='GMC' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Yukon',true),(m_id,'Sierra',true),(m_id,'Acadia',true),(m_id,'Terrain',true)
  ON CONFLICT DO NOTHING;

  -- Mercedes
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Mercedes-Benz' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'C-Class',true),(m_id,'E-Class',true),(m_id,'S-Class',true),(m_id,'G-Class',true),
    (m_id,'GLE',true),(m_id,'GLS',true),(m_id,'GLC',true),(m_id,'GLA',true),(m_id,'A-Class',true)
  ON CONFLICT DO NOTHING;

  -- BMW
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='BMW' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'3 Series',true),(m_id,'5 Series',true),(m_id,'7 Series',true),(m_id,'X1',true),
    (m_id,'X3',true),(m_id,'X5',true),(m_id,'X6',true),(m_id,'X7',true)
  ON CONFLICT DO NOTHING;

  -- MG
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='MG' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'ZS',true),(m_id,'HS',true),(m_id,'RX5',true),(m_id,'RX8',true),(m_id,'5',true),(m_id,'6',true)
  ON CONFLICT DO NOTHING;

  -- Geely
  SELECT id INTO m_id FROM public.vehicle_makes WHERE name='Geely' AND is_global=true LIMIT 1;
  INSERT INTO public.vehicle_models (make_id, name, is_global) VALUES
    (m_id,'Emgrand',true),(m_id,'Coolray',true),(m_id,'Tugella',true),(m_id,'Azkarra',true),(m_id,'Okavango',true)
  ON CONFLICT DO NOTHING;
END $$;

-- ============================================
-- 3. حقول جديدة في insurance_claims
-- ============================================
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS vehicle_make text,
  ADD COLUMN IF NOT EXISTS vehicle_model text,
  ADD COLUMN IF NOT EXISTS vehicle_plate text,
  ADD COLUMN IF NOT EXISTS vehicle_year integer,
  ADD COLUMN IF NOT EXISTS vehicle_color text,
  ADD COLUMN IF NOT EXISTS estimation_type text NOT NULL DEFAULT 'lump_sum',
  ADD COLUMN IF NOT EXISTS upl_items jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS auto_job_order_id uuid;

-- ============================================
-- 4. سلسلة ترقيم فواتير التأمين + جدول الفواتير
-- ============================================
CREATE SEQUENCE IF NOT EXISTS public.insurance_invoice_seq START 1;

CREATE TABLE IF NOT EXISTS public.insurance_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  invoice_number text NOT NULL UNIQUE,
  claim_id uuid NOT NULL,
  insurance_company_id uuid,
  insurance_company_name text NOT NULL,
  subtotal numeric NOT NULL DEFAULT 0,
  vat numeric NOT NULL DEFAULT 0,
  total numeric NOT NULL DEFAULT 0,
  paid_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'issued', -- issued / partially_paid / paid / cancelled
  issued_at timestamptz NOT NULL DEFAULT now(),
  due_date date,
  pdf_url text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ins_invoices_tenant ON public.insurance_invoices(tenant_id);
CREATE INDEX idx_ins_invoices_claim ON public.insurance_invoices(claim_id);
CREATE INDEX idx_ins_invoices_company ON public.insurance_invoices(insurance_company_id);

ALTER TABLE public.insurance_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant access ins invoices"
  ON public.insurance_invoices FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert ins invoices"
  ON public.insurance_invoices FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Staff update ins invoices"
  ON public.insurance_invoices FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  );

CREATE POLICY "Admin delete ins invoices"
  ON public.insurance_invoices FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  );

CREATE OR REPLACE FUNCTION public.generate_insurance_invoice_number()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := 'INS-INV-' || lpad(nextval('public.insurance_invoice_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_ins_invoice_number
  BEFORE INSERT ON public.insurance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.generate_insurance_invoice_number();

CREATE TRIGGER trg_ins_invoice_updated
  BEFORE UPDATE ON public.insurance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ============================================
-- 5. سجل التدقيق (Audit Log) للمطالبات
-- ============================================
CREATE TABLE IF NOT EXISTS public.claim_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  claim_id uuid NOT NULL,
  user_id uuid,
  action text NOT NULL, -- upload_photo / delete_photo / status_change / invoice_created / job_order_created
  category text, -- damage / delivery / satisfaction / receiver_id / document
  file_path text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_claim_audit_claim ON public.claim_audit_logs(claim_id);
CREATE INDEX idx_claim_audit_tenant ON public.claim_audit_logs(tenant_id);

ALTER TABLE public.claim_audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read audit logs"
  ON public.claim_audit_logs FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Authed insert audit logs"
  ON public.claim_audit_logs FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

-- ============================================
-- 6. تريغر إنشاء أمر العمل تلقائياً عند الاعتماد
-- ============================================
CREATE OR REPLACE FUNCTION public.auto_create_job_order_on_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_order_id uuid;
  v_vehicle_id uuid;
BEGIN
  -- نُنشئ فقط عند الانتقال إلى approved ولم يُنشأ من قبل
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') AND NEW.auto_job_order_id IS NULL THEN
    v_vehicle_id := NEW.vehicle_id;

    -- نُنشئ أمر عمل
    INSERT INTO public.job_orders (
      tenant_id, customer_id, vehicle_id,
      description, diagnosis,
      labor_cost, parts_cost,
      status,
      insurance_claim_number,
      insurance_approved
    ) VALUES (
      NEW.tenant_id,
      NEW.customer_id,
      v_vehicle_id,
      COALESCE(NEW.incident_description, 'مطالبة تأمين معتمدة #' || NEW.claim_number),
      'وارد من المطالبة ' || NEW.claim_number || ' - ' || COALESCE(NEW.insurance_company,'') ||
        CASE WHEN NEW.vehicle_make IS NOT NULL
          THEN ' | المركبة: ' || COALESCE(NEW.vehicle_make,'') || ' ' || COALESCE(NEW.vehicle_model,'') || ' - ' || COALESCE(NEW.vehicle_plate,'')
          ELSE ''
        END,
      0,
      COALESCE(NEW.approved_amount, NEW.estimated_amount, 0),
      'received'::job_status,
      NEW.claim_number,
      true
    )
    RETURNING id INTO v_order_id;

    -- نحدّث المطالبة بمعرّف أمر العمل
    NEW.auto_job_order_id := v_order_id;
    NEW.job_order_id := COALESCE(NEW.job_order_id, v_order_id);

    -- نسجّل الحدث
    INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, details)
    VALUES (NEW.tenant_id, NEW.id, auth.uid(), 'job_order_created',
      jsonb_build_object('job_order_id', v_order_id, 'auto', true));
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_create_job_order ON public.insurance_claims;
CREATE TRIGGER trg_auto_create_job_order
  BEFORE UPDATE ON public.insurance_claims
  FOR EACH ROW EXECUTE FUNCTION public.auto_create_job_order_on_approval();

-- ============================================
-- 7. سياسات الـ Storage - حصر مسار claims/{claim_id}/
-- ============================================
-- نُلغي السياسات القديمة على insurance-docs ونعيدها أكثر صرامة
DROP POLICY IF EXISTS "Public read insurance-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload insurance-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth update insurance-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete insurance-docs" ON storage.objects;

-- قراءة عامة (لظهور الصور في الـ PDFs والمعاينات)
CREATE POLICY "Public read insurance-docs"
  ON storage.objects FOR SELECT TO public
  USING (bucket_id = 'insurance-docs');

-- الرفع: مسار يجب أن يبدأ بـ claims/{claim_id_موجود}/
CREATE POLICY "Auth upload insurance-docs scoped"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'insurance-docs'
    AND (
      -- المسار يبدأ بـ claims/<uuid>/ ويوجد مطالبة بنفس الـ tenant
      (storage.foldername(name))[1] = 'claims'
      AND EXISTS (
        SELECT 1 FROM public.insurance_claims c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND c.tenant_id = get_user_tenant_id()
      )
      -- نسمح أيضاً بمسارات قديمة photos/ docs/ لتوافق رجعي مؤقت
      OR (storage.foldername(name))[1] IN ('photos','docs')
    )
  );

CREATE POLICY "Auth update insurance-docs scoped"
  ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'insurance-docs');

CREATE POLICY "Auth delete insurance-docs scoped"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'insurance-docs'
    AND (
      (storage.foldername(name))[1] = 'claims'
      AND EXISTS (
        SELECT 1 FROM public.insurance_claims c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND c.tenant_id = get_user_tenant_id()
          AND get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
      )
      OR (storage.foldername(name))[1] IN ('photos','docs')
    )
  );

-- ============================================
-- 8. إضافة foreign key مفقود لإصلاح خطأ claim_payments
-- ============================================
ALTER TABLE public.claim_payments
  DROP CONSTRAINT IF EXISTS claim_payments_claim_id_fkey;
ALTER TABLE public.claim_payments
  ADD CONSTRAINT claim_payments_claim_id_fkey
  FOREIGN KEY (claim_id) REFERENCES public.insurance_claims(id) ON DELETE CASCADE;