-- Work order control center:
-- explicit order type, safe claim linkage, tokenized public tracking, and hardened RLS.

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS work_order_type text NOT NULL DEFAULT 'general_customer',
  ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES public.insurance_claims(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS tracking_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS tracking_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.job_orders jo
SET claim_id = c.id
FROM public.insurance_claims c
WHERE jo.claim_id IS NULL
  AND c.tenant_id = jo.tenant_id
  AND (
    c.job_order_id = jo.id
    OR c.auto_job_order_id = jo.id
    OR (
      jo.insurance_claim_number IS NOT NULL
      AND jo.insurance_claim_number <> ''
      AND c.claim_number = jo.insurance_claim_number
    )
  );

UPDATE public.job_orders
SET work_order_type = CASE
  WHEN claim_id IS NOT NULL THEN 'insurance'
  ELSE 'general_customer'
END;

ALTER TABLE public.job_orders
  DROP CONSTRAINT IF EXISTS job_orders_work_order_type_check;

ALTER TABLE public.job_orders
  ADD CONSTRAINT job_orders_work_order_type_check
  CHECK (work_order_type IN ('general_customer', 'insurance'));

CREATE UNIQUE INDEX IF NOT EXISTS job_orders_tracking_token_uidx
  ON public.job_orders(tracking_token);
CREATE INDEX IF NOT EXISTS job_orders_claim_id_idx
  ON public.job_orders(claim_id);
CREATE INDEX IF NOT EXISTS job_orders_type_status_idx
  ON public.job_orders(tenant_id, work_order_type, status);

CREATE OR REPLACE FUNCTION public.enforce_job_order_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim public.insurance_claims%ROWTYPE;
BEGIN
  IF NEW.claim_id IS NULL
     AND NEW.insurance_claim_number IS NOT NULL
     AND trim(NEW.insurance_claim_number) <> '' THEN
    SELECT * INTO v_claim
    FROM public.insurance_claims
    WHERE tenant_id = NEW.tenant_id
      AND claim_number = NEW.insurance_claim_number
    ORDER BY created_at DESC
    LIMIT 1;

    IF FOUND THEN
      NEW.claim_id := v_claim.id;
      NEW.insurance_company := COALESCE(NULLIF(NEW.insurance_company, ''), v_claim.insurance_company);
    END IF;
  END IF;

  IF NEW.claim_id IS NOT NULL THEN
    NEW.work_order_type := 'insurance';
  ELSIF NEW.work_order_type IS NULL THEN
    NEW.work_order_type := 'general_customer';
  END IF;

  IF NEW.work_order_type = 'general_customer' THEN
    NEW.claim_id := NULL;
    NEW.insurance_claim_number := NULL;
    NEW.insurance_company := NULL;
    NEW.insurance_approved := false;
  END IF;

  IF NEW.status::text = 'delivered' AND NEW.archived_at IS NULL THEN
    NEW.archived_at := now();
  ELSIF TG_OP = 'UPDATE'
        AND NEW.status::text <> 'delivered'
        AND OLD.archived_at IS NOT NULL
        AND NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.archived_at := NULL;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_job_order_type ON public.job_orders;
CREATE TRIGGER trg_enforce_job_order_type
BEFORE INSERT OR UPDATE OF work_order_type, claim_id, insurance_claim_number, insurance_company, status
ON public.job_orders
FOR EACH ROW EXECUTE FUNCTION public.enforce_job_order_type();

CREATE OR REPLACE FUNCTION public.sync_job_order_claim_link()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_work_order_id uuid;
BEGIN
  v_work_order_id := COALESCE(NEW.auto_job_order_id, NEW.job_order_id);
  IF v_work_order_id IS NOT NULL THEN
    UPDATE public.job_orders
    SET claim_id = NEW.id,
        work_order_type = 'insurance',
        insurance_claim_number = NEW.claim_number,
        insurance_company = NEW.insurance_company
    WHERE id = v_work_order_id
      AND tenant_id = NEW.tenant_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_order_claim_link ON public.insurance_claims;
CREATE TRIGGER trg_sync_job_order_claim_link
AFTER INSERT OR UPDATE OF auto_job_order_id, job_order_id, claim_number, insurance_company
ON public.insurance_claims
FOR EACH ROW EXECUTE FUNCTION public.sync_job_order_claim_link();

-- Public access accepts only an opaque token. Order numbers and UUIDs are never public keys.
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
      v_row.id, v_row.order_number, NULL::text, NULL::date, NULL::timestamptz, NULL::timestamptz,
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
      v_row.id, v_row.order_number, NULL::text, NULL::date, NULL::timestamptz, NULL::timestamptz,
      NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::text, NULL::int,
      NULL::text, NULL::text, v_row.work_order_type, true, 'password_required'::text;
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

-- Replace legacy permissive policies with explicit role-aware policies.
DROP POLICY IF EXISTS "Tenant access job_orders" ON public.job_orders;
DROP POLICY IF EXISTS "Staff insert job_orders" ON public.job_orders;
DROP POLICY IF EXISTS "Staff update job_orders" ON public.job_orders;
DROP POLICY IF EXISTS "Admin delete job_orders" ON public.job_orders;

CREATE POLICY "Staff read tenant job orders"
ON public.job_orders FOR SELECT TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND NOT public.has_role(auth.uid(), 'customer')
);

CREATE POLICY "Workshop staff create job orders"
ON public.job_orders FOR INSERT TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'technician')
  )
);

CREATE POLICY "Workshop staff update job orders"
ON public.job_orders FOR UPDATE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'supervisor')
    OR public.has_role(auth.uid(), 'technician')
  )
)
WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Managers delete job orders"
ON public.job_orders FOR DELETE TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
  )
);
