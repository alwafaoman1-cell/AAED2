-- ============================================================
-- Two-way sync between insurance_claims and job_orders
-- ============================================================

-- 1) Expand WO→Claim sync to cover all stages (not just delivered)
CREATE OR REPLACE FUNCTION public.sync_claim_from_job_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_claim_id uuid;
  v_tenant uuid;
  v_updates jsonb := '{}'::jsonb;
  v_set_cols text := '';
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT id, tenant_id INTO v_claim_id, v_tenant
  FROM public.insurance_claims
  WHERE tenant_id = NEW.tenant_id
    AND (auto_job_order_id = NEW.id OR job_order_id = NEW.id)
  LIMIT 1;

  IF v_claim_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Map WO status → claim workflow timestamps (only set if not already set)
  IF NEW.status = 'received' THEN
    UPDATE public.insurance_claims
       SET workshop_arrival_date = COALESCE(workshop_arrival_date, now()),
           updated_at = now()
     WHERE id = v_claim_id;
  ELSIF NEW.status = 'in_progress' THEN
    UPDATE public.insurance_claims
       SET work_started_at = COALESCE(work_started_at, now()),
           workshop_arrival_date = COALESCE(workshop_arrival_date, now()),
           updated_at = now()
     WHERE id = v_claim_id;
  ELSIF NEW.status = 'completed' THEN
    UPDATE public.insurance_claims
       SET work_completed_at = COALESCE(work_completed_at, now()),
           work_started_at = COALESCE(work_started_at, now()),
           workshop_arrival_date = COALESCE(workshop_arrival_date, now()),
           updated_at = now()
     WHERE id = v_claim_id;
  ELSIF NEW.status = 'delivered' THEN
    UPDATE public.insurance_claims
       SET delivered_at = COALESCE(delivered_at, now()),
           work_completed_at = COALESCE(work_completed_at, now()),
           work_started_at = COALESCE(work_started_at, now()),
           workshop_arrival_date = COALESCE(workshop_arrival_date, now()),
           updated_at = now()
     WHERE id = v_claim_id;
  END IF;

  INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, category, details)
  VALUES (
    v_tenant, v_claim_id, auth.uid(),
    'wo_status_synced', 'workflow',
    jsonb_build_object(
      'job_order_id', NEW.id,
      'order_number', NEW.order_number,
      'old_status', OLD.status,
      'new_status', NEW.status,
      'source', 'work_order'
    )
  );

  RETURN NEW;
END $$;

-- Replace the old delivered-only trigger with the comprehensive one
DROP TRIGGER IF EXISTS trg_auto_close_claim_on_delivery ON public.job_orders;
DROP TRIGGER IF EXISTS auto_close_claim_on_delivery ON public.job_orders;
DROP TRIGGER IF EXISTS trg_sync_claim_from_job_order ON public.job_orders;

CREATE TRIGGER trg_sync_claim_from_job_order
AFTER UPDATE OF status ON public.job_orders
FOR EACH ROW
EXECUTE FUNCTION public.sync_claim_from_job_order();


-- 2) Claim → WO sync: when claim.delivered_at is set (or status flips to paid/cancelled),
--    update linked work order status accordingly.
CREATE OR REPLACE FUNCTION public.sync_job_order_from_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wo_id uuid;
  v_old_wo_status job_status;
  v_new_wo_status job_status := NULL;
BEGIN
  v_wo_id := COALESCE(NEW.auto_job_order_id, NEW.job_order_id);
  IF v_wo_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- delivered_at newly set → mark WO delivered
  IF NEW.delivered_at IS NOT NULL AND (OLD.delivered_at IS NULL) THEN
    v_new_wo_status := 'delivered'::job_status;
  -- status transitions that imply delivered
  ELSIF NEW.status = 'paid' AND OLD.status IS DISTINCT FROM 'paid' THEN
    v_new_wo_status := 'delivered'::job_status;
  END IF;

  IF v_new_wo_status IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT status INTO v_old_wo_status FROM public.job_orders WHERE id = v_wo_id;
  IF v_old_wo_status IS DISTINCT FROM v_new_wo_status THEN
    UPDATE public.job_orders
       SET status = v_new_wo_status,
           updated_at = now()
     WHERE id = v_wo_id;

    INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, category, details)
    VALUES (
      NEW.tenant_id, NEW.id, auth.uid(),
      'wo_status_synced', 'workflow',
      jsonb_build_object(
        'job_order_id', v_wo_id,
        'old_status', v_old_wo_status,
        'new_status', v_new_wo_status,
        'source', 'claim'
      )
    );
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_job_order_from_claim ON public.insurance_claims;
CREATE TRIGGER trg_sync_job_order_from_claim
AFTER UPDATE OF status, delivered_at ON public.insurance_claims
FOR EACH ROW
EXECUTE FUNCTION public.sync_job_order_from_claim();