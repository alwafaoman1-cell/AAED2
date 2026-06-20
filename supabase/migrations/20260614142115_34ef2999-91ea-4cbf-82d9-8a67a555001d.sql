-- ====== 1) أعمدة استلام المركبة في job_orders ======
ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS odometer_km integer,
  ADD COLUMN IF NOT EXISTS fuel_level_pct integer CHECK (fuel_level_pct IS NULL OR (fuel_level_pct >= 0 AND fuel_level_pct <= 100)),
  ADD COLUMN IF NOT EXISTS reception_notes text,
  ADD COLUMN IF NOT EXISTS reception_photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS vehicle_belongings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS received_at timestamptz;

-- ====== 2) جدول الأعمال الإضافية ======
CREATE TABLE IF NOT EXISTS public.work_order_supplements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  description text NOT NULL,
  quantity numeric NOT NULL DEFAULT 1,
  unit_price numeric NOT NULL DEFAULT 0,
  notes text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'pending_customer' CHECK (status IN ('pending_customer','approved','rejected','executed')),
  approval_request_id uuid,
  customer_decision_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wos_job_order ON public.work_order_supplements(job_order_id);
CREATE INDEX IF NOT EXISTS idx_wos_tenant_status ON public.work_order_supplements(tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_order_supplements TO authenticated;
GRANT ALL ON public.work_order_supplements TO service_role;
ALTER TABLE public.work_order_supplements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read supplements" ON public.work_order_supplements
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert supplements" ON public.work_order_supplements
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant update supplements" ON public.work_order_supplements
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete supplements" ON public.work_order_supplements
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER trg_wos_updated_at BEFORE UPDATE ON public.work_order_supplements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- منع تنفيذ بند غير معتمد
CREATE OR REPLACE FUNCTION public.enforce_supplement_execution_rule()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'executed' AND (OLD.status IS DISTINCT FROM 'approved' AND OLD.status IS DISTINCT FROM 'executed') THEN
    RAISE EXCEPTION 'لا يمكن تنفيذ بند غير معتمد من العميل' USING ERRCODE='check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_wos_enforce_exec BEFORE UPDATE ON public.work_order_supplements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_supplement_execution_rule();

-- ====== 3) جدول طلبات الموافقة ======
CREATE TABLE IF NOT EXISTS public.supplement_approval_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid NOT NULL REFERENCES public.job_orders(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '24 hours'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','signed','expired','cancelled')),
  supplement_ids uuid[] NOT NULL DEFAULT '{}',
  customer_name_snapshot text,
  customer_phone_snapshot text,
  signature_data_url text,
  signed_at timestamptz,
  signer_ip text,
  signer_user_agent text,
  decisions jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_approved numeric DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sar_job_order ON public.supplement_approval_requests(job_order_id);
CREATE INDEX IF NOT EXISTS idx_sar_token ON public.supplement_approval_requests(token);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.supplement_approval_requests TO authenticated;
GRANT ALL ON public.supplement_approval_requests TO service_role;
ALTER TABLE public.supplement_approval_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read sar" ON public.supplement_approval_requests
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert sar" ON public.supplement_approval_requests
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant update sar" ON public.supplement_approval_requests
  FOR UPDATE TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete sar" ON public.supplement_approval_requests
  FOR DELETE TO authenticated USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER trg_sar_updated_at BEFORE UPDATE ON public.supplement_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- منع تعديل طلبات موقّعة (للسلامة القانونية)
CREATE OR REPLACE FUNCTION public.protect_signed_supplement_request()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.status = 'signed' THEN
    -- نسمح فقط بتغيير expires_at أو updated_at، نمنع تغيير القرارات/التوقيع/IP
    IF NEW.signature_data_url IS DISTINCT FROM OLD.signature_data_url
       OR NEW.signer_ip IS DISTINCT FROM OLD.signer_ip
       OR NEW.signer_user_agent IS DISTINCT FROM OLD.signer_user_agent
       OR NEW.decisions::text IS DISTINCT FROM OLD.decisions::text
       OR NEW.signed_at IS DISTINCT FROM OLD.signed_at THEN
      RAISE EXCEPTION 'لا يمكن تعديل بيانات موافقة موقّعة قانونياً' USING ERRCODE='check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER trg_sar_protect BEFORE UPDATE ON public.supplement_approval_requests
  FOR EACH ROW EXECUTE FUNCTION public.protect_signed_supplement_request();

-- ====== 4) سجل التدقيق ======
CREATE TABLE IF NOT EXISTS public.supplement_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid REFERENCES public.job_orders(id) ON DELETE CASCADE,
  request_id uuid REFERENCES public.supplement_approval_requests(id) ON DELETE SET NULL,
  action text NOT NULL,
  actor text NOT NULL DEFAULT 'staff' CHECK (actor IN ('staff','customer','system')),
  user_id uuid,
  ip text,
  user_agent text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_sal_job_order ON public.supplement_audit_logs(job_order_id);
CREATE INDEX IF NOT EXISTS idx_sal_request ON public.supplement_audit_logs(request_id);

GRANT SELECT, INSERT ON public.supplement_audit_logs TO authenticated;
GRANT ALL ON public.supplement_audit_logs TO service_role;
ALTER TABLE public.supplement_audit_logs ENABLE ROW LEVEL SECURITY;

-- append-only: لا UPDATE ولا DELETE policy
CREATE POLICY "tenant read audit" ON public.supplement_audit_logs
  FOR SELECT TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert audit" ON public.supplement_audit_logs
  FOR INSERT TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());

-- ====== 5) إعدادات المقتنيات ======
CREATE TABLE IF NOT EXISTS public.workshop_belongings_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  items jsonb NOT NULL DEFAULT '[
    {"key":"main_key","label_ar":"مفتاح رئيسي","label_en":"Main Key"},
    {"key":"spare_key","label_ar":"مفتاح احتياطي","label_en":"Spare Key"},
    {"key":"spare_tire","label_ar":"استبنة","label_en":"Spare Tire"},
    {"key":"tool_kit","label_ar":"عدة السيارة","label_en":"Tool Kit"},
    {"key":"fire_extinguisher","label_ar":"طفاية حريق","label_en":"Fire Extinguisher"},
    {"key":"warning_triangle","label_ar":"مثلث تحذير","label_en":"Warning Triangle"},
    {"key":"trunk_cover","label_ar":"غطاء صندوق الأمتعة","label_en":"Trunk Cover"},
    {"key":"manual","label_ar":"كتيب المركبة","label_en":"Owner Manual"}
  ]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workshop_belongings_settings TO authenticated;
GRANT ALL ON public.workshop_belongings_settings TO service_role;
ALTER TABLE public.workshop_belongings_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant rw belongings" ON public.workshop_belongings_settings
  FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER trg_wbs_updated_at BEFORE UPDATE ON public.workshop_belongings_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ====== 6) الدوال الآمنة العامة (لصفحة موافقة العميل) ======

-- جلب بيانات الطلب بواسطة token (لا يتطلب تسجيل دخول؛ تُستدعى من edge function)
CREATE OR REPLACE FUNCTION public.get_supplement_request_by_token(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req public.supplement_approval_requests%ROWTYPE;
  v_jo  public.job_orders%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_veh public.vehicles%ROWTYPE;
  v_items jsonb;
  v_expired boolean;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_req FROM public.supplement_approval_requests WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;

  v_expired := (v_req.expires_at < now());

  SELECT * INTO v_jo FROM public.job_orders WHERE id = v_req.job_order_id;
  SELECT * INTO v_cust FROM public.customers WHERE id = v_jo.customer_id;
  SELECT * INTO v_veh FROM public.vehicles WHERE id = v_jo.vehicle_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', s.id,
    'description', s.description,
    'quantity', s.quantity,
    'unit_price', s.unit_price,
    'notes', s.notes,
    'photos', s.photos,
    'status', s.status,
    'total', (s.quantity * s.unit_price)
  ) ORDER BY s.created_at), '[]'::jsonb) INTO v_items
  FROM public.work_order_supplements s
  WHERE s.id = ANY(v_req.supplement_ids);

  RETURN jsonb_build_object(
    'request', jsonb_build_object(
      'id', v_req.id,
      'status', v_req.status,
      'expires_at', v_req.expires_at,
      'expired', v_expired,
      'signed_at', v_req.signed_at,
      'created_at', v_req.created_at
    ),
    'work_order', jsonb_build_object(
      'order_number', v_jo.order_number,
      'description', v_jo.description
    ),
    'customer', jsonb_build_object(
      'name', COALESCE(v_req.customer_name_snapshot, v_cust.name),
      'phone', COALESCE(v_req.customer_phone_snapshot, v_cust.phone)
    ),
    'vehicle', jsonb_build_object(
      'plate', v_veh.plate_number,
      'brand', v_veh.brand,
      'model', v_veh.model,
      'year', v_veh.year,
      'color', v_veh.color
    ),
    'items', v_items
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_supplement_request_by_token(text) TO anon, authenticated, service_role;

-- تقديم القرار + التوقيع
CREATE OR REPLACE FUNCTION public.submit_supplement_decision(
  p_token text,
  p_decisions jsonb,         -- [{supplement_id, decision: 'approved'|'rejected'}]
  p_signature text,
  p_ip text,
  p_user_agent text,
  p_signer_name text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_req public.supplement_approval_requests%ROWTYPE;
  v_dec jsonb;
  v_sup_id uuid;
  v_decision text;
  v_total numeric := 0;
  v_now timestamptz := now();
  v_enriched jsonb := '[]'::jsonb;
BEGIN
  IF p_token IS NULL OR p_signature IS NULL OR p_decisions IS NULL THEN
    RAISE EXCEPTION 'missing_fields';
  END IF;

  SELECT * INTO v_req FROM public.supplement_approval_requests WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_req.status = 'signed' THEN RAISE EXCEPTION 'already_signed'; END IF;
  IF v_req.expires_at < v_now THEN
    UPDATE public.supplement_approval_requests SET status='expired' WHERE id = v_req.id;
    RAISE EXCEPTION 'expired';
  END IF;

  -- معالجة كل قرار
  FOR v_dec IN SELECT * FROM jsonb_array_elements(p_decisions) LOOP
    v_sup_id := (v_dec->>'supplement_id')::uuid;
    v_decision := v_dec->>'decision';
    IF v_decision NOT IN ('approved','rejected') THEN CONTINUE; END IF;
    IF NOT (v_sup_id = ANY(v_req.supplement_ids)) THEN CONTINUE; END IF;

    UPDATE public.work_order_supplements
       SET status = v_decision,
           customer_decision_at = v_now,
           approval_request_id = v_req.id,
           updated_at = v_now
     WHERE id = v_sup_id;

    IF v_decision = 'approved' THEN
      SELECT v_total + (quantity * unit_price) INTO v_total
        FROM public.work_order_supplements WHERE id = v_sup_id;
    END IF;

    v_enriched := v_enriched || jsonb_build_array(jsonb_build_object(
      'supplement_id', v_sup_id, 'decision', v_decision, 'decided_at', v_now
    ));
  END LOOP;

  UPDATE public.supplement_approval_requests
     SET status = 'signed',
         signature_data_url = p_signature,
         signed_at = v_now,
         signer_ip = p_ip,
         signer_user_agent = p_user_agent,
         decisions = v_enriched,
         total_approved = v_total,
         customer_name_snapshot = COALESCE(p_signer_name, customer_name_snapshot),
         updated_at = v_now
   WHERE id = v_req.id;

  -- سجل قانوني
  INSERT INTO public.supplement_audit_logs (tenant_id, job_order_id, request_id, action, actor, ip, user_agent, details)
  VALUES (v_req.tenant_id, v_req.job_order_id, v_req.id, 'customer_signed', 'customer', p_ip, p_user_agent,
    jsonb_build_object('decisions', v_enriched, 'total_approved', v_total, 'signer_name', p_signer_name));

  RETURN jsonb_build_object('ok', true, 'total_approved', v_total);
END $$;

GRANT EXECUTE ON FUNCTION public.submit_supplement_decision(text, jsonb, text, text, text, text) TO anon, authenticated, service_role;
