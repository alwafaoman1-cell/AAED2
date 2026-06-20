
-- Security definer function to get current user's email without exposing auth.users
CREATE OR REPLACE FUNCTION public.get_user_email()
RETURNS text
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT email::text FROM auth.users WHERE id = auth.uid() LIMIT 1
$$;

GRANT EXECUTE ON FUNCTION public.get_user_email() TO authenticated;

-- Rewrite policies that referenced auth.users directly

-- customers
DROP POLICY IF EXISTS "Tenant access customers" ON public.customers;
CREATE POLICY "Tenant access customers"
ON public.customers FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND (get_user_role() <> 'customer'::app_role OR email = public.get_user_email())
);

-- insurance_claims
DROP POLICY IF EXISTS "Tenant access insurance_claims" ON public.insurance_claims;
CREATE POLICY "Tenant access insurance_claims"
ON public.insurance_claims FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND (
    get_user_role() <> 'customer'::app_role
    OR customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.tenant_id = get_user_tenant_id()
        AND c.email = public.get_user_email()
    )
  )
);
