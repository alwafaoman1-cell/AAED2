-- Sync job_orders.insurance_approved + insurance_claim_number when claim status changes.
CREATE OR REPLACE FUNCTION public.sync_wo_insurance_approval_from_claim()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_wo_id uuid;
BEGIN
  v_wo_id := COALESCE(NEW.auto_job_order_id, NEW.job_order_id);
  IF v_wo_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Approved (or paid) → ensure WO reflects insurance approval and claim number
  IF NEW.status IN ('approved','paid') THEN
    UPDATE public.job_orders
       SET insurance_approved = true,
           insurance_claim_number = COALESCE(insurance_claim_number, NEW.claim_number),
           updated_at = now()
     WHERE id = v_wo_id
       AND (insurance_approved IS DISTINCT FROM true
            OR insurance_claim_number IS NULL);
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_wo_insurance_approval ON public.insurance_claims;
CREATE TRIGGER trg_sync_wo_insurance_approval
AFTER INSERT OR UPDATE OF status, job_order_id, auto_job_order_id
ON public.insurance_claims
FOR EACH ROW
EXECUTE FUNCTION public.sync_wo_insurance_approval_from_claim();

-- Backfill existing approved/paid claims that have a linked WO not yet marked approved
UPDATE public.job_orders jo
   SET insurance_approved = true,
       insurance_claim_number = COALESCE(jo.insurance_claim_number, ic.claim_number),
       updated_at = now()
  FROM public.insurance_claims ic
 WHERE ic.status IN ('approved','paid')
   AND COALESCE(ic.auto_job_order_id, ic.job_order_id) = jo.id
   AND (jo.insurance_approved IS DISTINCT FROM true OR jo.insurance_claim_number IS NULL);
