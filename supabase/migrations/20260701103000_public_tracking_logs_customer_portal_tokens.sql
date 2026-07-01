-- Link public portal tracking logs to the real customer portal token table.
-- Non-destructive: replaces only the logging RPC body, no data deletion.

CREATE OR REPLACE FUNCTION public.log_public_tracking_open(
  p_short_code text,
  p_target_type text DEFAULT 'customer_tracking',
  p_user_agent text DEFAULT NULL,
  p_result text DEFAULT 'success'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order record;
  v_log_id uuid;
BEGIN
  IF p_short_code IS NULL OR length(trim(p_short_code)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_short_code');
  END IF;

  SELECT jo.id, jo.vehicle_id, jo.claim_id
    INTO v_order
  FROM public.customer_portal_tokens cpt
  JOIN public.job_orders jo ON jo.id = cpt.job_order_id
  WHERE cpt.token::text = trim(p_short_code)
  LIMIT 1;

  IF v_order.id IS NULL THEN
    SELECT jo.id, jo.vehicle_id, jo.claim_id
      INTO v_order
    FROM public.job_orders jo
    WHERE jo.tracking_token::text = trim(p_short_code)
    LIMIT 1;
  END IF;

  INSERT INTO public.public_tracking_logs (
    short_code,
    target_type,
    vehicle_id,
    claim_id,
    work_order_id,
    user_agent,
    result
  )
  VALUES (
    trim(p_short_code),
    COALESCE(NULLIF(trim(p_target_type), ''), 'customer_tracking'),
    v_order.vehicle_id,
    v_order.claim_id,
    v_order.id,
    left(COALESCE(p_user_agent, ''), 500),
    CASE
      WHEN COALESCE(NULLIF(trim(p_result), ''), 'success') = 'opened' THEN 'success'
      ELSE COALESCE(NULLIF(trim(p_result), ''), 'success')
    END
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'id', v_log_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_public_tracking_open(text, text, text, text) TO anon, authenticated;
