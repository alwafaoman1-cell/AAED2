
-- 1) columns
ALTER TABLE public.insurance_invoices
  ADD COLUMN IF NOT EXISTS secure_token text,
  ADD COLUMN IF NOT EXISTS token_revoked_at timestamptz;

-- unique index
CREATE UNIQUE INDEX IF NOT EXISTS insurance_invoices_secure_token_key
  ON public.insurance_invoices(secure_token)
  WHERE secure_token IS NOT NULL;

-- 2) generator function + trigger
CREATE OR REPLACE FUNCTION public.generate_invoice_secure_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.secure_token IS NULL OR NEW.secure_token = '' THEN
    NEW.secure_token := encode(gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_insurance_invoices_secure_token ON public.insurance_invoices;
CREATE TRIGGER trg_insurance_invoices_secure_token
BEFORE INSERT OR UPDATE ON public.insurance_invoices
FOR EACH ROW EXECUTE FUNCTION public.generate_invoice_secure_token();

-- 3) backfill existing rows
UPDATE public.insurance_invoices
   SET secure_token = encode(gen_random_bytes(24), 'hex')
 WHERE secure_token IS NULL;

-- 4) public viewer RPC
CREATE OR REPLACE FUNCTION public.get_public_invoice(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_inv public.insurance_invoices%ROWTYPE;
  v_claim public.insurance_claims%ROWTYPE;
  v_company public.insurance_companies%ROWTYPE;
  v_tenant public.tenants%ROWTYPE;
BEGIN
  IF p_token IS NULL OR length(trim(p_token)) < 16 THEN
    RETURN jsonb_build_object('error','invalid_token');
  END IF;

  SELECT * INTO v_inv FROM public.insurance_invoices WHERE secure_token = p_token LIMIT 1;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error','not_found');
  END IF;
  IF v_inv.token_revoked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error','revoked');
  END IF;

  SELECT * INTO v_claim FROM public.insurance_claims WHERE id = v_inv.claim_id;
  IF v_inv.insurance_company_id IS NOT NULL THEN
    SELECT * INTO v_company FROM public.insurance_companies WHERE id = v_inv.insurance_company_id;
  END IF;
  SELECT * INTO v_tenant FROM public.tenants WHERE id = v_inv.tenant_id;

  RETURN jsonb_build_object(
    'invoice', jsonb_build_object(
      'invoice_number', v_inv.invoice_number,
      'issued_at', v_inv.issued_at,
      'due_date', v_inv.due_date,
      'status', v_inv.status,
      'subtotal', v_inv.subtotal,
      'vat', v_inv.vat,
      'total', v_inv.total,
      'paid_amount', v_inv.paid_amount,
      'items', v_inv.items,
      'notes', v_inv.notes,
      'lpo_number', v_inv.lpo_number,
      'vehicle_make', v_inv.vehicle_make,
      'vehicle_model', v_inv.vehicle_model,
      'vehicle_plate', v_inv.vehicle_plate
    ),
    'claim', jsonb_build_object(
      'claim_number', v_claim.claim_number
    ),
    'company', jsonb_build_object(
      'name', v_inv.insurance_company_name,
      'vat', v_company.tax_number,
      'cr', v_company.commercial_registration,
      'phone', v_company.phone,
      'address', v_company.address
    ),
    'workshop', jsonb_build_object(
      'name', v_tenant.name
    )
  );
END $$;

GRANT EXECUTE ON FUNCTION public.get_public_invoice(text) TO anon, authenticated;
