
-- Prevent users from changing their own role or tenant_id via profiles update
CREATE OR REPLACE FUNCTION public.prevent_self_role_escalation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() = NEW.user_id AND NOT public.has_role(auth.uid(), 'admin') THEN
    IF NEW.role IS DISTINCT FROM OLD.role THEN
      RAISE EXCEPTION 'لا يمكن تعديل الدور الخاص بك' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'لا يمكن تعديل المستأجر' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_self_role_escalation_trg ON public.profiles;
CREATE TRIGGER prevent_self_role_escalation_trg
BEFORE UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.prevent_self_role_escalation();

-- Restrict purchase_invoices visibility (block technician/supervisor, consistent with supplier_payments)
DROP POLICY IF EXISTS "Block tech/supervisor read purchase_invoices" ON public.purchase_invoices;
CREATE POLICY "Block tech/supervisor read purchase_invoices"
ON public.purchase_invoices
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  NOT public.has_role(auth.uid(), 'technician')
  AND NOT public.has_role(auth.uid(), 'supervisor')
);
