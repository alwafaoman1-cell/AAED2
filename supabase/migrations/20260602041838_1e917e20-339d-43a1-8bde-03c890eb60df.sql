-- M6: قفل المطالبات المدفوعة — منع تعديل المطالبات بعد دفعها بالكامل
-- يسمح فقط للأدمن بتعديل المطالبات في حالة 'paid'
CREATE OR REPLACE FUNCTION public.prevent_paid_claim_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.status = 'paid' AND public.get_user_role() <> 'admin' THEN
    RAISE EXCEPTION 'لا يمكن تعديل مطالبة مدفوعة. تواصل مع المدير.'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_paid_claim_updates ON public.insurance_claims;
CREATE TRIGGER trg_prevent_paid_claim_updates
  BEFORE UPDATE ON public.insurance_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_paid_claim_updates();