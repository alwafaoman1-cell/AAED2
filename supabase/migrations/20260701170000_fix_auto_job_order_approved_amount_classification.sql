-- Fix accounting classification for auto-created insurance work orders.
-- Approved insurance amount belongs to insurance_claims.approved_amount; it is
-- not spare parts and must not be copied into job_orders.parts_cost.

CREATE OR REPLACE FUNCTION public.auto_create_job_order_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_vehicle_id uuid;
BEGIN
  IF NEW.status = 'approved'
     AND (OLD.status IS DISTINCT FROM 'approved')
     AND NEW.auto_job_order_id IS NULL THEN
    v_vehicle_id := NEW.vehicle_id;

    INSERT INTO public.job_orders (
      tenant_id,
      customer_id,
      vehicle_id,
      description,
      diagnosis,
      labor_cost,
      parts_cost,
      status,
      insurance_claim_number,
      insurance_company,
      insurance_approved
    ) VALUES (
      NEW.tenant_id,
      NEW.customer_id,
      v_vehicle_id,
      COALESCE(NEW.incident_description, 'Insurance claim approved #' || NEW.claim_number),
      'Created from insurance claim ' || NEW.claim_number || ' - ' || COALESCE(NEW.insurance_company, '') ||
        CASE WHEN NEW.vehicle_make IS NOT NULL
          THEN ' | Vehicle: ' || COALESCE(NEW.vehicle_make, '') || ' ' || COALESCE(NEW.vehicle_model, '') || ' - ' || COALESCE(NEW.vehicle_plate, '')
          ELSE ''
        END,
      0,
      0,
      'received'::job_status,
      NEW.claim_number,
      NEW.insurance_company,
      true
    )
    RETURNING id INTO v_order_id;

    NEW.auto_job_order_id := v_order_id;
    NEW.job_order_id := COALESCE(NEW.job_order_id, v_order_id);

    INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, details)
    VALUES (
      NEW.tenant_id,
      NEW.id,
      auth.uid(),
      'job_order_created',
      jsonb_build_object(
        'job_order_id', v_order_id,
        'auto', true,
        'classification', 'approved_amount_not_itemized'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;
