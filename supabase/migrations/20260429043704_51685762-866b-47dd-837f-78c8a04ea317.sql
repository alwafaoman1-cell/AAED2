CREATE OR REPLACE FUNCTION public.auto_close_claim_on_delivery()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim_id uuid;
  v_tenant uuid;
BEGIN
  IF NEW.status = 'delivered' AND (OLD.status IS DISTINCT FROM 'delivered') THEN
    SELECT id, tenant_id INTO v_claim_id, v_tenant
    FROM public.insurance_claims
    WHERE tenant_id = NEW.tenant_id
      AND (auto_job_order_id = NEW.id OR job_order_id = NEW.id)
    LIMIT 1;

    IF v_claim_id IS NOT NULL THEN
      UPDATE public.insurance_claims
         SET delivered_at = COALESCE(delivered_at, now()),
             updated_at   = now()
       WHERE id = v_claim_id;

      INSERT INTO public.claim_audit_logs (tenant_id, claim_id, user_id, action, category, details)
      VALUES (
        v_tenant, v_claim_id, auth.uid(),
        'claim_closed_by_delivery', 'workflow',
        jsonb_build_object('job_order_id', NEW.id, 'order_number', NEW.order_number, 'auto', true)
      );
    END IF;
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_auto_close_claim_on_delivery ON public.job_orders;
CREATE TRIGGER trg_auto_close_claim_on_delivery
  AFTER UPDATE ON public.job_orders
  FOR EACH ROW EXECUTE FUNCTION public.auto_close_claim_on_delivery();