-- H1: Tighten payment_links INSERT — currently has no WITH CHECK (allows cross-tenant inserts)
DROP POLICY IF EXISTS "Staff insert payment_links" ON public.payment_links;
CREATE POLICY "Staff insert payment_links"
ON public.payment_links
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
);

-- Add RESTRICTIVE policy to ensure customer role cannot access payment_links
CREATE POLICY "Block non-staff payment_links"
ON public.payment_links
AS RESTRICTIVE
FOR ALL
TO authenticated
USING (
  public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
)
WITH CHECK (
  public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
);