
DROP POLICY IF EXISTS "Tenant access insurance_companies" ON public.insurance_companies;
DROP POLICY IF EXISTS "Block customer role select" ON public.insurance_companies;
CREATE POLICY "Financial roles read insurance_companies"
ON public.insurance_companies
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
);

DROP POLICY IF EXISTS "Tenant read suppliers" ON public.suppliers;
DROP POLICY IF EXISTS "Block customer role select" ON public.suppliers;
CREATE POLICY "Financial roles read suppliers"
ON public.suppliers
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
);

DROP POLICY IF EXISTS "Tenant scoped realtime read" ON realtime.messages;
CREATE POLICY "Tenant scoped realtime read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = ('tenant:'::text || (public.get_user_tenant_id())::text)
  AND public.get_user_role() <> 'customer'::app_role
);
