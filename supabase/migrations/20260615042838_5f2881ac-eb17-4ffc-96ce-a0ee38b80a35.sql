-- 1) work items list on job_orders
ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS work_items jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 2) signature columns on customer_portal_tokens
ALTER TABLE public.customer_portal_tokens
  ADD COLUMN IF NOT EXISTS signature_data_url text,
  ADD COLUMN IF NOT EXISTS signed_at timestamptz,
  ADD COLUMN IF NOT EXISTS signer_ip text,
  ADD COLUMN IF NOT EXISTS signer_user_agent text,
  ADD COLUMN IF NOT EXISTS signer_name text;

-- 3) Public RPC: load work order for signing page (by token)
CREATE OR REPLACE FUNCTION public.get_work_order_for_sign(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tok public.customer_portal_tokens%ROWTYPE;
  v_jo  public.job_orders%ROWTYPE;
  v_veh public.vehicles%ROWTYPE;
  v_cust public.customers%ROWTYPE;
  v_workshop text;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_tok FROM public.customer_portal_tokens WHERE token = p_token LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RETURN jsonb_build_object('error','revoked'); END IF;

  SELECT * INTO v_jo  FROM public.job_orders WHERE id = v_tok.job_order_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('error','not_found'); END IF;
  SELECT * INTO v_veh FROM public.vehicles  WHERE id = v_jo.vehicle_id;
  SELECT * INTO v_cust FROM public.customers WHERE id = v_jo.customer_id;
  SELECT name INTO v_workshop FROM public.tenants WHERE id = v_jo.tenant_id;

  RETURN jsonb_build_object(
    'order_number', v_jo.order_number,
    'entry_date',   v_jo.entry_date,
    'description',  v_jo.description,
    'diagnosis',    v_jo.diagnosis,
    'work_items',   COALESCE(v_jo.work_items, '[]'::jsonb),
    'vehicle', jsonb_build_object(
      'plate', v_veh.plate_number,
      'brand', v_veh.brand,
      'model', v_veh.model,
      'year',  v_veh.year,
      'color', v_veh.color
    ),
    'customer', jsonb_build_object(
      'name',  v_cust.name,
      'phone', v_cust.phone
    ),
    'workshop_name', v_workshop,
    'signed', (v_tok.signed_at IS NOT NULL),
    'signed_at', v_tok.signed_at,
    'signer_name', v_tok.signer_name,
    'signature_data_url', v_tok.signature_data_url
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_work_order_for_sign(text) TO anon, authenticated;

-- 4) Public RPC: submit customer signature
CREATE OR REPLACE FUNCTION public.submit_work_order_signature(
  p_token text,
  p_signature text,
  p_signer_name text,
  p_ip text DEFAULT NULL,
  p_user_agent text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_tok public.customer_portal_tokens%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;
  IF p_signature IS NULL OR length(p_signature) < 100 THEN
    RAISE EXCEPTION 'invalid_signature';
  END IF;

  SELECT * INTO v_tok FROM public.customer_portal_tokens WHERE token = p_token FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'not_found'; END IF;
  IF v_tok.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'revoked'; END IF;
  IF v_tok.signed_at IS NOT NULL THEN RAISE EXCEPTION 'already_signed'; END IF;

  UPDATE public.customer_portal_tokens
     SET signature_data_url = p_signature,
         signer_name = NULLIF(trim(COALESCE(p_signer_name,'')), ''),
         signer_ip = p_ip,
         signer_user_agent = p_user_agent,
         signed_at = now()
   WHERE id = v_tok.id;

  RETURN jsonb_build_object('ok', true, 'signed_at', now());
END $$;

GRANT EXECUTE ON FUNCTION public.submit_work_order_signature(text, text, text, text, text) TO anon, authenticated;