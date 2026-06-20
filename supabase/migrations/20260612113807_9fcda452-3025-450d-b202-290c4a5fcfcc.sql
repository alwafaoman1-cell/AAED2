CREATE OR REPLACE FUNCTION public.get_public_work_order(p_key text, p_password text DEFAULT NULL)
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
  requires_password boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.job_orders%ROWTYPE;
  v_phone text;
  v_norm_pwd text;
  v_norm_exp text;
  v_requires boolean := false;
BEGIN
  IF p_key IS NULL OR length(trim(p_key)) = 0 THEN
    RETURN;
  END IF;

  SELECT * INTO v_row FROM public.job_orders
  WHERE id::text = p_key OR order_number = p_key
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- Customer phone acts as the default tracking password
  SELECT c.phone INTO v_phone FROM public.customers c WHERE c.id = v_row.customer_id;
  v_norm_exp := lower(trim(COALESCE(v_phone, '')));
  v_norm_pwd := lower(trim(COALESCE(p_password, '')));
  IF v_norm_exp ~ '^[0-9 +()-]+$' AND v_norm_exp <> '' THEN
    v_norm_exp := regexp_replace(v_norm_exp, '\D', '', 'g');
    v_norm_pwd := regexp_replace(v_norm_pwd, '\D', '', 'g');
  END IF;
  v_requires := (v_norm_exp <> '');

  -- If a password is required and not matching, expose only the requires_password flag
  IF v_requires AND v_norm_pwd <> v_norm_exp THEN
    RETURN QUERY SELECT v_row.id, v_row.order_number, NULL::text, NULL::date, NULL::timestamptz, NULL::timestamptz,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::int, NULL::text, NULL::text, true;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    v_row.id,
    v_row.order_number,
    v_row.status::text,
    v_row.entry_date,
    v_row.created_at,
    v_row.updated_at,
    v_row.description,
    v_row.diagnosis,
    v_row.insurance_claim_number,
    veh.plate_number,
    veh.brand,
    veh.model,
    veh.year,
    veh.color,
    cust.name,
    v_requires
  FROM (SELECT 1) s
  LEFT JOIN public.vehicles veh ON veh.id = v_row.vehicle_id
  LEFT JOIN public.customers cust ON cust.id = v_row.customer_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_public_work_order(text, text) TO anon, authenticated;