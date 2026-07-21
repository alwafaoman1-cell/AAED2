-- Accept both current customer_portal_tokens.token and legacy job_orders.tracking_token
-- for public work-order tracking and signature links.
-- Non-destructive: preserves existing tokens and wraps the existing RPC bodies.

DO $$
BEGIN
  IF to_regprocedure('public.get_public_tracking_base_20260721(text)') IS NULL
     AND to_regprocedure('public.get_public_tracking(text)') IS NOT NULL THEN
    ALTER FUNCTION public.get_public_tracking(text)
      RENAME TO get_public_tracking_base_20260721;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_public_tracking(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input text := trim(COALESCE(p_token, ''));
  v_resolved_token text;
BEGIN
  IF length(v_input) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT cpt.token
    INTO v_resolved_token
  FROM public.customer_portal_tokens cpt
  WHERE cpt.token = v_input
  LIMIT 1;

  IF v_resolved_token IS NULL THEN
    SELECT cpt.token
      INTO v_resolved_token
    FROM public.job_orders jo
    JOIN public.customer_portal_tokens cpt ON cpt.job_order_id = jo.id
    WHERE jo.tracking_token::text = v_input
    LIMIT 1;
  END IF;

  IF v_resolved_token IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN public.get_public_tracking_base_20260721(v_resolved_token);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_tracking(text) TO anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.get_work_order_for_sign_base_20260721(text)') IS NULL
     AND to_regprocedure('public.get_work_order_for_sign(text)') IS NOT NULL THEN
    ALTER FUNCTION public.get_work_order_for_sign(text)
      RENAME TO get_work_order_for_sign_base_20260721;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.get_work_order_for_sign(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_input text := trim(COALESCE(p_token, ''));
  v_resolved_token text;
BEGIN
  IF length(v_input) < 16 THEN
    RETURN jsonb_build_object('error', 'invalid_token');
  END IF;

  SELECT cpt.token
    INTO v_resolved_token
  FROM public.customer_portal_tokens cpt
  WHERE cpt.token = v_input
  LIMIT 1;

  IF v_resolved_token IS NULL THEN
    SELECT cpt.token
      INTO v_resolved_token
    FROM public.job_orders jo
    JOIN public.customer_portal_tokens cpt ON cpt.job_order_id = jo.id
    WHERE jo.tracking_token::text = v_input
    LIMIT 1;
  END IF;

  IF v_resolved_token IS NULL THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  RETURN public.get_work_order_for_sign_base_20260721(v_resolved_token);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_work_order_for_sign(text) TO anon, authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.submit_work_order_signature_base_20260721(text,text,text,text,text)') IS NULL
     AND to_regprocedure('public.submit_work_order_signature(text,text,text,text,text)') IS NOT NULL THEN
    ALTER FUNCTION public.submit_work_order_signature(text, text, text, text, text)
      RENAME TO submit_work_order_signature_base_20260721;
  END IF;
END $$;

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
SET search_path = public
AS $$
DECLARE
  v_input text := trim(COALESCE(p_token, ''));
  v_resolved_token text;
BEGIN
  IF length(v_input) < 16 THEN
    RAISE EXCEPTION 'invalid_token';
  END IF;

  SELECT cpt.token
    INTO v_resolved_token
  FROM public.customer_portal_tokens cpt
  WHERE cpt.token = v_input
  LIMIT 1;

  IF v_resolved_token IS NULL THEN
    SELECT cpt.token
      INTO v_resolved_token
    FROM public.job_orders jo
    JOIN public.customer_portal_tokens cpt ON cpt.job_order_id = jo.id
    WHERE jo.tracking_token::text = v_input
    LIMIT 1;
  END IF;

  IF v_resolved_token IS NULL THEN
    RAISE EXCEPTION 'not_found';
  END IF;

  RETURN public.submit_work_order_signature_base_20260721(v_resolved_token, p_signature, p_signer_name, p_ip, p_user_agent);
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_work_order_signature(text, text, text, text, text) TO anon, authenticated;
