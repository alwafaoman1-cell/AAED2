-- Public portal / QR tracking logs.
-- Non-destructive: creates a log table and a SECURITY DEFINER RPC used by /p/:token.

CREATE TABLE IF NOT EXISTS public.public_tracking_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  short_code text NOT NULL,
  target_type text NOT NULL DEFAULT 'customer_tracking',
  vehicle_id uuid NULL,
  claim_id uuid NULL,
  work_order_id uuid NULL,
  opened_at timestamptz NOT NULL DEFAULT now(),
  user_agent text NULL,
  result text NOT NULL DEFAULT 'opened',
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS public_tracking_logs_short_code_idx
  ON public.public_tracking_logs (short_code, opened_at DESC);

CREATE INDEX IF NOT EXISTS public_tracking_logs_vehicle_idx
  ON public.public_tracking_logs (vehicle_id, opened_at DESC)
  WHERE vehicle_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS public_tracking_logs_claim_idx
  ON public.public_tracking_logs (claim_id, opened_at DESC)
  WHERE claim_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS public_tracking_logs_work_order_idx
  ON public.public_tracking_logs (work_order_id, opened_at DESC)
  WHERE work_order_id IS NOT NULL;

ALTER TABLE public.public_tracking_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS public_tracking_logs_tenant_read ON public.public_tracking_logs;
CREATE POLICY public_tracking_logs_tenant_read
  ON public.public_tracking_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.job_orders jo
      WHERE jo.id = public_tracking_logs.work_order_id
        AND jo.tenant_id = public.get_user_tenant_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public.vehicles v
      WHERE v.id = public_tracking_logs.vehicle_id
        AND v.tenant_id = public.get_user_tenant_id()
    )
    OR EXISTS (
      SELECT 1
      FROM public.insurance_claims c
      WHERE c.id = public_tracking_logs.claim_id
        AND c.tenant_id = public.get_user_tenant_id()
    )
  );

CREATE OR REPLACE FUNCTION public.log_public_tracking_open(
  p_short_code text,
  p_target_type text DEFAULT 'customer_tracking',
  p_user_agent text DEFAULT NULL,
  p_result text DEFAULT 'opened'
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
  FROM public.job_orders jo
  WHERE jo.tracking_token::text = trim(p_short_code)
  LIMIT 1;

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
    COALESCE(NULLIF(trim(p_result), ''), 'opened')
  )
  RETURNING id INTO v_log_id;

  RETURN jsonb_build_object('ok', true, 'id', v_log_id);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.log_public_tracking_open(text, text, text, text) TO anon, authenticated;
