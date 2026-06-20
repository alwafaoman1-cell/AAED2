
-- 1) Unique index: at most one active (non-cancelled) invoice per claim
CREATE UNIQUE INDEX IF NOT EXISTS uniq_active_invoice_per_claim
  ON public.insurance_invoices (claim_id)
  WHERE status <> 'cancelled';

-- 2) Trigger function: recalc invoice paid_amount/status and claim status from payments
CREATE OR REPLACE FUNCTION public.recalc_invoice_on_claim_payment()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id uuid;
  v_paid numeric;
  v_inv_id uuid;
  v_inv_total numeric;
  v_inv_status text;
BEGIN
  v_claim_id := COALESCE(NEW.claim_id, OLD.claim_id);
  IF v_claim_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Sum cleared payments for this claim
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.claim_payments
  WHERE claim_id = v_claim_id
    AND status = 'cleared';

  -- Pick the active invoice (latest non-cancelled)
  SELECT id, total INTO v_inv_id, v_inv_total
  FROM public.insurance_invoices
  WHERE claim_id = v_claim_id
    AND status <> 'cancelled'
  ORDER BY issued_at DESC NULLS LAST
  LIMIT 1;

  IF v_inv_id IS NOT NULL THEN
    v_inv_status := CASE
      WHEN v_inv_total > 0 AND v_paid >= v_inv_total - 0.01 THEN 'paid'
      WHEN v_paid > 0 THEN 'partial'
      ELSE 'issued'
    END;

    UPDATE public.insurance_invoices
       SET paid_amount = v_paid,
           status = v_inv_status,
           updated_at = now()
     WHERE id = v_inv_id;

    -- Mirror to claim if fully paid
    IF v_inv_status = 'paid' THEN
      UPDATE public.insurance_claims
         SET status = 'paid',
             paid_at = COALESCE(paid_at, now()),
             updated_at = now()
       WHERE id = v_claim_id
         AND status <> 'paid';
    END IF;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_on_claim_payment ON public.claim_payments;
CREATE TRIGGER trg_recalc_invoice_on_claim_payment
AFTER INSERT OR UPDATE OR DELETE ON public.claim_payments
FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_on_claim_payment();

-- 3) Trigger function: when an invoice is created/updated, recompute its own status from existing payments
CREATE OR REPLACE FUNCTION public.recalc_invoice_on_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_paid numeric;
BEGIN
  IF NEW.claim_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
  FROM public.claim_payments
  WHERE claim_id = NEW.claim_id AND status = 'cleared';

  NEW.paid_amount := v_paid;
  IF NEW.total > 0 AND v_paid >= NEW.total - 0.01 THEN
    NEW.status := 'paid';
  ELSIF v_paid > 0 THEN
    NEW.status := 'partial';
  ELSE
    -- keep provided status (issued/overdue) only if not already set to paid/partial
    IF NEW.status IS NULL OR NEW.status = '' THEN
      NEW.status := 'issued';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recalc_invoice_on_insert ON public.insurance_invoices;
CREATE TRIGGER trg_recalc_invoice_on_insert
BEFORE INSERT ON public.insurance_invoices
FOR EACH ROW EXECUTE FUNCTION public.recalc_invoice_on_insert();
