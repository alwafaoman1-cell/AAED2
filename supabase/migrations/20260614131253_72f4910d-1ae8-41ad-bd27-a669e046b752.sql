
-- 1) insurance_invoices: add last_payment_date
ALTER TABLE public.insurance_invoices
  ADD COLUMN IF NOT EXISTS last_payment_date timestamptz;

-- Update existing recalc trigger function to also set last_payment_date
CREATE OR REPLACE FUNCTION public.recalc_invoice_on_claim_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_claim_id uuid;
  v_paid numeric;
  v_last timestamptz;
  v_inv_id uuid;
  v_inv_total numeric;
  v_inv_status text;
BEGIN
  v_claim_id := COALESCE(NEW.claim_id, OLD.claim_id);
  IF v_claim_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0), MAX(payment_date::timestamptz)
    INTO v_paid, v_last
  FROM public.claim_payments
  WHERE claim_id = v_claim_id
    AND status = 'cleared';

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
           last_payment_date = v_last,
           updated_at = now()
     WHERE id = v_inv_id;

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
$function$;

-- Protect issued_at on insurance_invoices from being changed after creation
CREATE OR REPLACE FUNCTION public.protect_insurance_invoice_issued_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.issued_at IS DISTINCT FROM OLD.issued_at THEN
    NEW.issued_at := OLD.issued_at;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_protect_invoice_issued_at ON public.insurance_invoices;
CREATE TRIGGER trg_protect_invoice_issued_at
  BEFORE UPDATE ON public.insurance_invoices
  FOR EACH ROW EXECUTE FUNCTION public.protect_insurance_invoice_issued_at();

-- Backfill last_payment_date for insurance invoices
UPDATE public.insurance_invoices i
   SET last_payment_date = sub.last_dt
  FROM (
    SELECT claim_id, MAX(payment_date::timestamptz) AS last_dt
      FROM public.claim_payments
     WHERE status = 'cleared'
     GROUP BY claim_id
  ) sub
 WHERE sub.claim_id = i.claim_id
   AND i.last_payment_date IS NULL;

-- 2) sales_documents: add last_payment_date
ALTER TABLE public.sales_documents
  ADD COLUMN IF NOT EXISTS last_payment_date timestamptz;

-- Trigger on sales_payments to refresh last_payment_date + paid_amount
CREATE OR REPLACE FUNCTION public.refresh_sales_doc_last_payment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_doc uuid;
  v_paid numeric;
  v_last timestamptz;
BEGIN
  v_doc := COALESCE(NEW.sales_document_id, OLD.sales_document_id);
  IF v_doc IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(SUM(amount), 0), MAX(date::timestamptz)
    INTO v_paid, v_last
    FROM public.sales_payments
   WHERE sales_document_id = v_doc;

  UPDATE public.sales_documents
     SET paid_amount = v_paid,
         last_payment_date = v_last,
         updated_at = now()
   WHERE id = v_doc;

  RETURN COALESCE(NEW, OLD);
END;
$function$;

DROP TRIGGER IF EXISTS trg_refresh_sales_doc_last_payment ON public.sales_payments;
CREATE TRIGGER trg_refresh_sales_doc_last_payment
  AFTER INSERT OR UPDATE OR DELETE ON public.sales_payments
  FOR EACH ROW EXECUTE FUNCTION public.refresh_sales_doc_last_payment();

-- Protect sales_documents.date (issue date) from being changed by code paths
-- that intend to log a payment. Edits via the editor page still allowed
-- because they UPDATE multiple fields including date intentionally.
-- (No trigger added here to keep manual editing flexible.)

-- Backfill last_payment_date for sales_documents
UPDATE public.sales_documents d
   SET last_payment_date = sub.last_dt
  FROM (
    SELECT sales_document_id, MAX(date::timestamptz) AS last_dt
      FROM public.sales_payments
     GROUP BY sales_document_id
  ) sub
 WHERE sub.sales_document_id = d.id
   AND d.last_payment_date IS NULL;
