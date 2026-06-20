-- Fix: Restrict customer-role users from reading other tenant data

-- 1. customers: customer role can only read own record (matched by email or phone via profile)
DROP POLICY IF EXISTS "Tenant access customers" ON public.customers;
CREATE POLICY "Tenant access customers"
ON public.customers
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND (
    get_user_role() <> 'customer'::app_role
    OR email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())
  )
);

-- 2. insurance_claims: customer role can only see their own claims
DROP POLICY IF EXISTS "Tenant access insurance_claims" ON public.insurance_claims;
CREATE POLICY "Tenant access insurance_claims"
ON public.insurance_claims
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND (
    get_user_role() <> 'customer'::app_role
    OR customer_id IN (
      SELECT c.id FROM public.customers c
      WHERE c.tenant_id = get_user_tenant_id()
        AND c.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())
    )
  )
);

-- 3. insurance_estimates: restrict to staff roles only (customers shouldn't see estimates)
DROP POLICY IF EXISTS "Tenant access insurance_estimates" ON public.insurance_estimates;
CREATE POLICY "Tenant access insurance_estimates"
ON public.insurance_estimates
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role])
);

-- 4. sms_logs: restrict to staff roles
DROP POLICY IF EXISTS "Tenant read sms logs" ON public.sms_logs;
CREATE POLICY "Tenant read sms logs"
ON public.sms_logs
FOR SELECT
TO authenticated
USING (
  tenant_id = get_user_tenant_id()
  AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
);

-- 5. profiles INSERT: prevent managers from assigning admin role (only admins can create admins)
DROP POLICY IF EXISTS "Admins insert profiles" ON public.profiles;
CREATE POLICY "Admins insert profiles"
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (
  tenant_id = get_user_tenant_id()
  AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
  AND (role <> 'admin'::app_role OR get_user_role() = 'admin'::app_role)
);
