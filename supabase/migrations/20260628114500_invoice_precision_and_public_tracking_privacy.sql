-- Non-destructive production hardening:
-- 1) Preserve OMR baisa precision on work-order invoices.
-- 2) Do not expose internal job_order UUIDs through public tracking tokens.

ALTER TABLE public.invoices
  ALTER COLUMN subtotal TYPE numeric(12,3) USING subtotal::numeric(12,3),
  ALTER COLUMN vat TYPE numeric(12,3) USING vat::numeric(12,3),
  ALTER COLUMN total TYPE numeric(12,3) USING total::numeric(12,3);

DROP FUNCTION IF EXISTS public.get_public_work_order(text, text);

CREATE FUNCTION public.get_public_work_order(p_key text, p_password text DEFAULT NULL)
RETURNS TABLE(
  id uuid,
  order_number text,
  status text,
  entry_date date,
  created_at timestamptz,
  updated_at timestamptz,
  description text,
  diagnosis text,
  insurance_claim_number text,
  vehicle_plate text,
  vehicle_brand text,
  vehicle_model text,
  vehicle_year int,
  vehicle_color text,
  customer_name text,
  work_order_type text,
  requires_password boolean,
  access_state text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_orders%ROWTYPE;
  v_phone text;
  v_expected text;
  v_supplied text;
  v_requires boolean := false;
BEGIN
  IF p_key IS NULL OR p_key !~* '^[0-9a-f-]{36}$' THEN
    RETURN;
  END IF;

  SELECT * INTO v_row
  FROM public.job_orders
  WHERE tracking_token::text = p_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_row.tracking_expires_at IS NOT NULL AND v_row.tracking_expires_at <= now() THEN
    RETURN QUERY SELECT
      NULL::uuid, v_row.order_number, NULL::text, NULL::date, NULL::timestamptz, NULL::timestamptz,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::int,
      NULL::text, NULL::text, v_row.work_order_type, false, 'expired'::text;
    RETURN;
  END IF;

  SELECT c.phone INTO v_phone FROM public.customers c WHERE c.id = v_row.customer_id;
  v_expected := lower(trim(COALESCE(v_phone, '')));
  v_supplied := lower(trim(COALESCE(p_password, '')));
  IF v_expected ~ '^[0-9 +()-]+$' AND v_expected <> '' THEN
    v_expected := regexp_replace(v_expected, '\D', '', 'g');
    v_supplied := regexp_replace(v_supplied, '\D', '', 'g');
  END IF;
  v_requires := v_expected <> '';

  IF v_requires AND v_supplied <> v_expected THEN
    RETURN QUERY SELECT
      NULL::uuid, v_row.order_number, NULL::text, NULL::date, NULL::timestamptz, NULL::timestamptz,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::int,
      NULL::text, NULL::text, v_row.work_order_type, true, 'password_required'::text;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    NULL::uuid,
    v_row.order_number,
    v_row.status::text,
    v_row.entry_date,
    v_row.created_at,
    v_row.updated_at,
    v_row.description,
    v_row.diagnosis,
    v_row.insurance_claim_number,
    concat_ws(' ', veh.plate_letters, veh.plate_number),
    veh.brand,
    veh.model,
    veh.year,
    veh.color,
    cust.name,
    v_row.work_order_type,
    v_requires,
    'ok'::text
  FROM (SELECT 1) s
  LEFT JOIN public.vehicles veh ON veh.id = v_row.vehicle_id
  LEFT JOIN public.customers cust ON cust.id = v_row.customer_id;
END;
$$;

REVOKE ALL ON FUNCTION public.get_public_work_order(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_public_work_order(text, text) TO anon, authenticated;
