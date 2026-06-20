
DROP POLICY IF EXISTS "Customer sees only own vehicles" ON public.vehicles;
CREATE POLICY "Customer sees only own vehicles"
ON public.vehicles
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  get_user_role() <> 'customer'::app_role
  OR customer_id IN (
    SELECT c.id FROM public.customers c
    WHERE c.tenant_id = get_user_tenant_id()
      AND c.email = public.get_user_email()
  )
);
