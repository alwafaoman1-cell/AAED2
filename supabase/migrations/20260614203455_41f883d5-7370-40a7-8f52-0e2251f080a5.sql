
-- 1) Settings table per tenant
CREATE TABLE public.customer_notification_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  event_type text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  auto_send boolean NOT NULL DEFAULT false,
  default_channel text NOT NULL DEFAULT 'whatsapp',
  template_ar text,
  template_en text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(tenant_id, event_type)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_notification_settings TO authenticated;
GRANT ALL ON public.customer_notification_settings TO service_role;
ALTER TABLE public.customer_notification_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read settings" ON public.customer_notification_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant manage settings" ON public.customer_notification_settings FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER trg_customer_notif_settings_updated
BEFORE UPDATE ON public.customer_notification_settings
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- 2) Notifications log/queue
CREATE TABLE public.customer_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid REFERENCES public.job_orders(id) ON DELETE SET NULL,
  customer_id uuid,
  event_type text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  status text NOT NULL DEFAULT 'queued',
  recipient text,
  subject text,
  body text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  error text,
  sent_at timestamptz,
  delivered_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_cust_notif_tenant_created ON public.customer_notifications(tenant_id, created_at DESC);
CREATE INDEX idx_cust_notif_job_order ON public.customer_notifications(job_order_id);
CREATE INDEX idx_cust_notif_status ON public.customer_notifications(tenant_id, status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_notifications TO authenticated;
GRANT ALL ON public.customer_notifications TO service_role;
ALTER TABLE public.customer_notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read notif" ON public.customer_notifications FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert notif" ON public.customer_notifications FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant update notif" ON public.customer_notifications FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete notif" ON public.customer_notifications FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE TRIGGER trg_customer_notif_updated
BEFORE UPDATE ON public.customer_notifications
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.customer_notifications;

-- 3) Helper: enqueue customer notification (queues only; sending is done by edge function or client invoke)
CREATE OR REPLACE FUNCTION public.enqueue_customer_notification(
  p_tenant_id uuid,
  p_job_order_id uuid,
  p_event_type text,
  p_body text,
  p_channel text DEFAULT NULL,
  p_force boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_settings public.customer_notification_settings%ROWTYPE;
  v_jo public.job_orders%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_token text;
  v_channel text;
  v_recipient text;
  v_id uuid;
  v_body text;
BEGIN
  SELECT * INTO v_settings FROM public.customer_notification_settings
    WHERE tenant_id = p_tenant_id AND event_type = p_event_type LIMIT 1;

  -- if disabled and not forced, skip
  IF NOT p_force AND v_settings.id IS NOT NULL AND v_settings.enabled = false THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_jo FROM public.job_orders WHERE id = p_job_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT * INTO v_cust FROM public.customers WHERE id = v_jo.customer_id;

  v_channel := COALESCE(p_channel, v_settings.default_channel, 'whatsapp');
  v_recipient := CASE WHEN v_channel = 'email' THEN v_cust.email ELSE v_cust.phone END;

  SELECT token INTO v_token FROM public.customer_portal_tokens WHERE job_order_id = v_jo.id LIMIT 1;

  v_body := COALESCE(p_body, v_settings.template_ar, '');
  v_body := replace(v_body, '{name}', COALESCE(v_cust.name, ''));
  v_body := replace(v_body, '{order}', COALESCE(v_jo.order_number, ''));
  v_body := replace(v_body, '{link}', CASE WHEN v_token IS NOT NULL THEN '/p/' || v_token ELSE '' END);

  INSERT INTO public.customer_notifications(
    tenant_id, job_order_id, customer_id, event_type, channel, status, recipient, body, payload
  ) VALUES (
    p_tenant_id, p_job_order_id, v_jo.customer_id, p_event_type, v_channel, 'queued',
    v_recipient, v_body, jsonb_build_object('order_number', v_jo.order_number, 'token', v_token)
  ) RETURNING id INTO v_id;

  RETURN v_id;
END $$;

-- 4) Trigger on job_orders status changes
CREATE OR REPLACE FUNCTION public.notify_on_job_order_status()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_event text; v_settings public.customer_notification_settings%ROWTYPE;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_event := 'received';
  ELSIF NEW.status IS DISTINCT FROM OLD.status THEN
    v_event := CASE NEW.status::text
      WHEN 'received' THEN 'received'
      WHEN 'inspection' THEN 'inspection_started'
      WHEN 'waiting_parts' THEN 'waiting_parts'
      WHEN 'in_progress' THEN 'repair_started'
      WHEN 'completed' THEN 'ready_for_pickup'
      WHEN 'delivered' THEN 'delivered'
      ELSE NULL
    END;
  ELSE
    RETURN NEW;
  END IF;

  IF v_event IS NULL THEN RETURN NEW; END IF;

  SELECT * INTO v_settings FROM public.customer_notification_settings
    WHERE tenant_id = NEW.tenant_id AND event_type = v_event LIMIT 1;

  -- only auto-create when auto_send enabled
  IF v_settings.id IS NOT NULL AND v_settings.auto_send = true AND v_settings.enabled = true THEN
    PERFORM public.enqueue_customer_notification(NEW.tenant_id, NEW.id, v_event, NULL, NULL, false);
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_job_order_status
AFTER INSERT OR UPDATE OF status ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_on_job_order_status();

-- 5) Trigger on insurance approval (job_orders.insurance_approved flips to true)
CREATE OR REPLACE FUNCTION public.notify_on_insurance_approved()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settings public.customer_notification_settings%ROWTYPE;
BEGIN
  IF NEW.insurance_approved IS TRUE AND (OLD.insurance_approved IS DISTINCT FROM true) THEN
    SELECT * INTO v_settings FROM public.customer_notification_settings
      WHERE tenant_id = NEW.tenant_id AND event_type = 'insurance_approved' LIMIT 1;
    IF v_settings.id IS NOT NULL AND v_settings.auto_send = true AND v_settings.enabled = true THEN
      PERFORM public.enqueue_customer_notification(NEW.tenant_id, NEW.id, 'insurance_approved', NULL, NULL, false);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_insurance_approved
AFTER UPDATE OF insurance_approved ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.notify_on_insurance_approved();

-- 6) Trigger on supplement awaiting customer approval
CREATE OR REPLACE FUNCTION public.notify_on_supplement_pending()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_settings public.customer_notification_settings%ROWTYPE;
BEGIN
  IF NEW.status = 'pending_customer' AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'pending_customer') THEN
    SELECT * INTO v_settings FROM public.customer_notification_settings
      WHERE tenant_id = NEW.tenant_id AND event_type = 'supplement_pending' LIMIT 1;
    IF v_settings.id IS NOT NULL AND v_settings.auto_send = true AND v_settings.enabled = true THEN
      PERFORM public.enqueue_customer_notification(NEW.tenant_id, NEW.job_order_id, 'supplement_pending', NULL, NULL, false);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER trg_notify_on_supplement_pending
AFTER INSERT OR UPDATE OF status ON public.work_order_supplements
FOR EACH ROW EXECUTE FUNCTION public.notify_on_supplement_pending();

-- 7) Default notification settings seed function (called per tenant on first visit from app)
CREATE OR REPLACE FUNCTION public.seed_default_notification_settings(p_tenant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.customer_notification_settings(tenant_id, event_type, enabled, auto_send, default_channel, template_ar, template_en)
  VALUES
    (p_tenant_id, 'received', true, false, 'whatsapp',
      'مرحباً {name}، تم استلام سيارتك في الورشة. أمر العمل: {order}. يمكنك متابعة حالتها هنا: {link}',
      'Hi {name}, your vehicle has been received. Work order: {order}. Track status: {link}'),
    (p_tenant_id, 'inspection_started', true, false, 'whatsapp',
      'بدأ الفحص الفني لسيارتك {order}. متابعة: {link}',
      'Inspection started for your vehicle {order}. Track: {link}'),
    (p_tenant_id, 'waiting_insurance', true, false, 'whatsapp',
      'تم إرسال المطالبة لشركة التأمين، بانتظار الاعتماد. متابعة: {link}',
      'Insurance claim sent. Waiting for approval. Track: {link}'),
    (p_tenant_id, 'insurance_approved', true, false, 'whatsapp',
      'تمت موافقة التأمين على إصلاح سيارتك {order}. سنبدأ تجهيز القطع. متابعة: {link}',
      'Insurance approved for {order}. Parts being prepared. Track: {link}'),
    (p_tenant_id, 'waiting_parts', true, false, 'whatsapp',
      'تم طلب قطع الغيار اللازمة لسيارتك {order}. متابعة: {link}',
      'Parts ordered for {order}. Track: {link}'),
    (p_tenant_id, 'parts_arrived', true, false, 'whatsapp',
      'وصلت قطع الغيار. سيبدأ الإصلاح قريباً. متابعة: {link}',
      'Parts arrived. Repair starting soon. Track: {link}'),
    (p_tenant_id, 'repair_started', true, false, 'whatsapp',
      'بدأ إصلاح سيارتك {order}. متابعة: {link}',
      'Repair started for {order}. Track: {link}'),
    (p_tenant_id, 'supplement_pending', true, false, 'whatsapp',
      'مرحباً {name}، يوجد بنود إضافية تحتاج موافقتك على أمر العمل {order}: {link}',
      'Hi {name}, additional items need your approval for {order}: {link}'),
    (p_tenant_id, 'ready_for_pickup', true, false, 'whatsapp',
      'سيارتك جاهزة للاستلام يا {name}. أمر العمل: {order}.',
      'Your vehicle is ready for pickup, {name}. Order: {order}.'),
    (p_tenant_id, 'delivered', true, false, 'whatsapp',
      'شكراً {name} لاختيارك ورشتنا. نتمنى لك قيادة آمنة 🚗. شاركنا تقييمك: {link}',
      'Thank you {name}. Drive safely. Share your feedback: {link}')
  ON CONFLICT (tenant_id, event_type) DO NOTHING;
END $$;
