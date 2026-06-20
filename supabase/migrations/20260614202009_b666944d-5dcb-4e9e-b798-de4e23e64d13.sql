
-- ============ TABLE: customer_portal_tokens ============
CREATE TABLE public.customer_portal_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid NOT NULL UNIQUE REFERENCES public.job_orders(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customer_portal_tokens TO authenticated;
GRANT ALL ON public.customer_portal_tokens TO service_role;
ALTER TABLE public.customer_portal_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read tokens" ON public.customer_portal_tokens FOR SELECT
  TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant insert tokens" ON public.customer_portal_tokens FOR INSERT
  TO authenticated WITH CHECK (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant update tokens" ON public.customer_portal_tokens FOR UPDATE
  TO authenticated USING (tenant_id = public.get_user_tenant_id());
CREATE POLICY "tenant delete tokens" ON public.customer_portal_tokens FOR DELETE
  TO authenticated USING (tenant_id = public.get_user_tenant_id() AND public.has_role(auth.uid(),'admin'));

CREATE INDEX idx_portal_tokens_token ON public.customer_portal_tokens(token);

-- ============ TABLE: customer_feedback ============
CREATE TABLE public.customer_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  job_order_id uuid NOT NULL UNIQUE REFERENCES public.job_orders(id) ON DELETE CASCADE,
  rating int NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text,
  submitter_ip text,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.customer_feedback TO authenticated;
GRANT ALL ON public.customer_feedback TO service_role;
ALTER TABLE public.customer_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant read feedback" ON public.customer_feedback FOR SELECT
  TO authenticated USING (tenant_id = public.get_user_tenant_id());

-- ============ Helper: ensure token for a job_order ============
CREATE OR REPLACE FUNCTION public.ensure_portal_token()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok text;
BEGIN
  v_tok := encode(gen_random_bytes(32), 'hex');
  INSERT INTO public.customer_portal_tokens (tenant_id, job_order_id, token)
  VALUES (NEW.tenant_id, NEW.id, v_tok)
  ON CONFLICT (job_order_id) DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_ensure_portal_token ON public.job_orders;
CREATE TRIGGER trg_ensure_portal_token
  AFTER INSERT ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.ensure_portal_token();

-- Backfill tokens for existing job orders
INSERT INTO public.customer_portal_tokens (tenant_id, job_order_id, token)
SELECT jo.tenant_id, jo.id, encode(gen_random_bytes(32), 'hex')
FROM public.job_orders jo
LEFT JOIN public.customer_portal_tokens t ON t.job_order_id = jo.id
WHERE t.id IS NULL;

-- ============ PUBLIC RPC: get_public_tracking ============
CREATE OR REPLACE FUNCTION public.get_public_tracking(p_token text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tok public.customer_portal_tokens%ROWTYPE;
  v_jo  public.job_orders%ROWTYPE;
  v_veh public.vehicles%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_progress int;
  v_stage_key text;
  v_stage_ar text;
  v_stage_en text;
  v_stage_emoji text;
  v_pending_supps int := 0;
  v_photos jsonb := '[]'::jsonb;
  v_feedback public.customer_feedback%ROWTYPE;
  v_eta date;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 32 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_tok FROM public.customer_portal_tokens WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error','revoked'); END IF;

  SELECT * INTO v_jo FROM public.job_orders WHERE id = v_tok.job_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  SELECT * INTO v_veh FROM public.vehicles WHERE id = v_jo.vehicle_id;
  SELECT * INTO v_cust FROM public.customers WHERE id = v_jo.customer_id;

  -- Smart stage + progress (insurance-aware, NO financials)
  IF v_jo.status = 'delivered' THEN
    v_stage_key := 'delivered'; v_stage_ar := 'تم التسليم'; v_stage_en := 'Delivered'; v_stage_emoji := '✅';
    v_progress := 100;
  ELSIF v_jo.status = 'completed' THEN
    v_stage_key := 'quality'; v_stage_ar := 'فحص الجودة — جاهز للاستلام'; v_stage_en := 'Quality check — Ready'; v_stage_emoji := '🛡️';
    v_progress := 95;
  ELSIF v_jo.status = 'in_progress' THEN
    v_stage_key := 'in_repair'; v_stage_ar := 'جاري الإصلاح'; v_stage_en := 'Under repair'; v_stage_emoji := '🔧';
    v_progress := 75;
  ELSIF v_jo.status = 'waiting_parts' THEN
    v_stage_key := 'parts_in_transit'; v_stage_ar := 'قطع الغيار في الطريق'; v_stage_en := 'Parts in transit'; v_stage_emoji := '🚚';
    v_progress := 55;
  ELSIF v_jo.insurance_claim_number IS NOT NULL AND v_jo.insurance_approved IS NOT TRUE THEN
    v_stage_key := 'waiting_insurance'; v_stage_ar := 'بانتظار اعتماد شركة التأمين'; v_stage_en := 'Waiting for insurance approval'; v_stage_emoji := '⏳';
    v_progress := 30;
  ELSIF v_jo.insurance_approved IS TRUE AND v_jo.status = 'received' THEN
    v_stage_key := 'insurance_approved'; v_stage_ar := 'تمت موافقة التأمين — تجهيز القطع'; v_stage_en := 'Insurance approved — preparing parts'; v_stage_emoji := '✅';
    v_progress := 45;
  ELSIF v_jo.status = 'inspection' THEN
    v_stage_key := 'inspection'; v_stage_ar := 'تحت الفحص الفني'; v_stage_en := 'Under inspection'; v_stage_emoji := '🔍';
    v_progress := 20;
  ELSE
    v_stage_key := 'received'; v_stage_ar := 'تم استلام المركبة'; v_stage_en := 'Vehicle received'; v_stage_emoji := '📥';
    v_progress := 10;
  END IF;

  -- Pending customer approvals (count only, no amounts)
  SELECT COUNT(*) INTO v_pending_supps
  FROM public.work_order_supplements
  WHERE job_order_id = v_jo.id AND status = 'pending_customer';

  -- Sanitized photos (drop any data flagged as internal)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', p->>'id',
      'phase', p->>'phase',
      'caption', p->>'caption',
      'url', COALESCE(p->>'url', p->>'dataUrl'),
      'uploaded_at', p->>'uploadedAt'
    )
  ), '[]'::jsonb) INTO v_photos
  FROM jsonb_array_elements(COALESCE(v_jo.photos, '[]'::jsonb)) p
  WHERE COALESCE((p->>'internal')::boolean, false) = false;

  v_eta := v_jo.estimated_completion;

  SELECT * INTO v_feedback FROM public.customer_feedback WHERE job_order_id = v_jo.id LIMIT 1;

  RETURN jsonb_build_object(
    'order_number', v_jo.order_number,
    'entry_date', v_jo.entry_date,
    'eta', v_eta,
    'progress_pct', v_progress,
    'stage', jsonb_build_object(
      'key', v_stage_key,
      'label_ar', v_stage_ar,
      'label_en', v_stage_en,
      'emoji', v_stage_emoji
    ),
    'is_delivered', (v_jo.status = 'delivered'),
    'vehicle', jsonb_build_object(
      'plate', v_veh.plate_number,
      'brand', v_veh.brand,
      'model', v_veh.model,
      'year', v_veh.year,
      'color', v_veh.color
    ),
    'customer_name', v_cust.name,
    'pending_approvals', v_pending_supps,
    'photos', v_photos,
    'feedback', CASE WHEN v_feedback.id IS NOT NULL THEN
      jsonb_build_object('rating', v_feedback.rating, 'comment', v_feedback.comment, 'created_at', v_feedback.created_at)
    ELSE NULL END,
    'workshop_name', (SELECT name FROM public.tenants WHERE id = v_jo.tenant_id)
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_public_tracking(text) TO anon, authenticated;

-- ============ PUBLIC RPC: submit_customer_feedback ============
CREATE OR REPLACE FUNCTION public.submit_customer_feedback(
  p_token text, p_rating int, p_comment text DEFAULT NULL, p_ip text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_tok public.customer_portal_tokens%ROWTYPE; v_jo public.job_orders%ROWTYPE;
BEGIN
  IF p_rating IS NULL OR p_rating < 1 OR p_rating > 5 THEN RAISE EXCEPTION 'invalid_rating'; END IF;
  SELECT * INTO v_tok FROM public.customer_portal_tokens WHERE token = p_token LIMIT 1;
  IF NOT FOUND OR v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_token'; END IF;
  SELECT * INTO v_jo FROM public.job_orders WHERE id = v_tok.job_order_id;
  IF v_jo.status <> 'delivered' THEN RAISE EXCEPTION 'not_delivered_yet'; END IF;

  INSERT INTO public.customer_feedback (tenant_id, job_order_id, rating, comment, submitter_ip)
  VALUES (v_tok.tenant_id, v_tok.job_order_id, p_rating, NULLIF(trim(COALESCE(p_comment,'')), ''), p_ip)
  ON CONFLICT (job_order_id) DO UPDATE
    SET rating = EXCLUDED.rating, comment = EXCLUDED.comment;
  RETURN jsonb_build_object('ok', true);
END $$;

GRANT EXECUTE ON FUNCTION public.submit_customer_feedback(text,int,text,text) TO anon, authenticated;
