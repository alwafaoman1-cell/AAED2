-- 1) Tenant-aware get_user_role
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS app_role
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT ur.role FROM public.user_roles ur
  WHERE ur.user_id = auth.uid()
    AND ur.tenant_id = public.get_user_tenant_id()
  ORDER BY CASE ur.role
    WHEN 'admin' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'supervisor' THEN 3
    WHEN 'technician' THEN 4
    WHEN 'insurance' THEN 5
    WHEN 'customer' THEN 6
    ELSE 99
  END
  LIMIT 1;
$$;

-- 2) Tenant-aware has_role: restrict to caller's current tenant
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
      AND ur.tenant_id = public.get_user_tenant_id()
  );
$$;

-- 3) Explicit UPDATE/DELETE policies on damage_markers for admin/manager within tenant
CREATE POLICY "Admins/managers update damage_markers"
ON public.damage_markers
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() IN ('admin','manager')
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() IN ('admin','manager')
);

CREATE POLICY "Admins/managers delete damage_markers"
ON public.damage_markers
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() IN ('admin','manager')
);

-- 4) Block supervisor/technician/customer from reading expenses (financial data)
CREATE POLICY "Block non-finance roles read expenses"
ON public.expenses
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.get_user_role() NOT IN ('supervisor','technician','customer')
);
