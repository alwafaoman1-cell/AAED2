-- Guard claim/work-order sync triggers from recursive updates.
-- Non-destructive: replaces only the sync function body; no data changes.

CREATE OR REPLACE FUNCTION public.sync_claim_from_job_order()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- When a job order is inserted/updated from inside an insurance_claims trigger
  -- (for example auto_create_job_order_on_approval), updating insurance_claims
  -- again can recurse until Postgres raises "stack depth limit exceeded".
  -- The originating claim trigger already has NEW.job_order_id / NEW.auto_job_order_id,
  -- so this nested sync is intentionally skipped.
  IF pg_trigger_depth() > 1 THEN
    RETURN NEW;
  END IF;

  IF NEW.insurance_claim_number IS NULL OR trim(NEW.insurance_claim_number) = '' THEN
    RETURN NEW;
  END IF;

  UPDATE public.insurance_claims
  SET
    job_order_id = COALESCE(job_order_id, NEW.id),
    auto_job_order_id = COALESCE(auto_job_order_id, NEW.id),
    work_started_at = CASE
      WHEN NEW.status = 'in_progress' AND work_started_at IS NULL THEN now()
      ELSE work_started_at
    END,
    work_completed_at = CASE
      WHEN NEW.status IN ('completed', 'delivered') AND work_completed_at IS NULL THEN now()
      ELSE work_completed_at
    END,
    delivered_at = CASE
      WHEN NEW.status = 'delivered' AND delivered_at IS NULL THEN now()
      ELSE delivered_at
    END,
    updated_at = now()
  WHERE tenant_id = NEW.tenant_id
    AND lower(trim(claim_number)) = lower(trim(NEW.insurance_claim_number))
    AND (
      job_order_id IS DISTINCT FROM COALESCE(job_order_id, NEW.id)
      OR auto_job_order_id IS DISTINCT FROM COALESCE(auto_job_order_id, NEW.id)
      OR (NEW.status = 'in_progress' AND work_started_at IS NULL)
      OR (NEW.status IN ('completed', 'delivered') AND work_completed_at IS NULL)
      OR (NEW.status = 'delivered' AND delivered_at IS NULL)
    );

  RETURN NEW;
END
$$;
