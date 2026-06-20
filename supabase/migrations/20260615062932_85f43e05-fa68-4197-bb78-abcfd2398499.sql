
-- 1) Fix gen_random_bytes by qualifying with extensions schema
CREATE OR REPLACE FUNCTION public.ensure_portal_token()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_tok text;
BEGIN
  v_tok := encode(extensions.gen_random_bytes(32), 'hex');
  INSERT INTO public.customer_portal_tokens (tenant_id, job_order_id, token)
  VALUES (NEW.tenant_id, NEW.id, v_tok)
  ON CONFLICT (job_order_id) DO NOTHING;
  RETURN NEW;
END $function$;

-- 2) Use claim's vehicle arrival date (manual) when creating the auto job order
CREATE OR REPLACE FUNCTION public.auto_create_job_order_on_approval()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order_id uuid;
  v_vehicle_id uuid;
  v_should_create boolean := false;
  v_entry_date date;
BEGIN
  IF NEW.auto_job_order_id IS NULL
     AND NEW.status = 'approved' THEN
    IF TG_OP = 'INSERT' THEN
      v_should_create := true;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.status IS DISTINCT FROM 'approved' THEN
        v_should_create := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_should_create THEN
    RETURN NEW;
  END IF;

  v_vehicle_id := NEW.vehicle_id;

  IF v_vehicle_id IS NULL THEN
    IF NEW.vehicle_plate IS NOT NULL AND NEW.vehicle_plate <> '' THEN
      SELECT id INTO v_vehicle_id
      FROM public.vehicles
      WHERE tenant_id = NEW.tenant_id
        AND customer_id = NEW.customer_id
        AND lower(plate_number) = lower(NEW.vehicle_plate)
      LIMIT 1;
    END IF;

    IF v_vehicle_id IS NULL THEN
      INSERT INTO public.vehicles (
        tenant_id, customer_id, brand, model, plate_number, year, color
      ) VALUES (
        NEW.tenant_id,
        NEW.customer_id,
        COALESCE(NULLIF(NEW.vehicle_make, ''), 'غير محدد'),
        COALESCE(NULLIF(NEW.vehicle_model, ''), 'غير محدد'),
        COALESCE(NULLIF(NEW.vehicle_plate, ''), 'TMP-' || substr(NEW.id::text, 1, 8)),
        NEW.vehicle_year,
        NEW.vehicle_color
      )
      RETURNING id INTO v_vehicle_id;
    END IF;

    NEW.vehicle_id := v_vehicle_id;
  END IF;

  -- Honor manually-entered vehicle arrival date from the claim; fall back to estimate date, then today.
  v_entry_date := COALESCE(
    NEW.workshop_arrival_date::date,
    NEW.estimate_date::date,
    CURRENT_DATE
  );

  INSERT INTO public.job_orders (
    tenant_id, customer_id, vehicle_id,
    description, diagnosis,
    labor_cost, parts_cost,
    status,
    insurance_claim_number,
    insurance_approved,
    entry_date
  ) VALUES (
    NEW.tenant_id,
    NEW.customer_id,
    v_vehicle_id,
    COALESCE(NEW.incident_description, 'مطالبة تأمين معتمدة #' || NEW.claim_number),
    'وارد من المطالبة ' || NEW.claim_number || ' - ' || COALESCE(NEW.insurance_company,'') ||
      CASE WHEN NEW.vehicle_make IS NOT NULL
        THEN ' | المركبة: ' || COALESCE(NEW.vehicle_make,'') || ' ' || COALESCE(NEW.vehicle_model,'') || ' - ' || COALESCE(NEW.vehicle_plate,'')
        ELSE ''
      END,
    0,
    COALESCE(NEW.approved_amount, NEW.estimated_amount, 0),
    'received'::job_status,
    NEW.claim_number,
    true,
    v_entry_date
  )
  RETURNING id INTO v_order_id;

  NEW.auto_job_order_id := v_order_id;
  NEW.job_order_id := COALESCE(NEW.job_order_id, v_order_id);

  INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, details)
  VALUES (NEW.tenant_id, NEW.id, auth.uid(), 'job_order_created',
    jsonb_build_object('job_order_id', v_order_id, 'auto', true, 'vehicle_id', v_vehicle_id,
      'entry_date', v_entry_date, 'trigger', 'claim_approved'));

  RETURN NEW;
END $function$;
