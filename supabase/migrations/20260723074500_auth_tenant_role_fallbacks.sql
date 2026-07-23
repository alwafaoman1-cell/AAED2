-- Make auth tenant/role resolution resilient when profiles and user_roles are temporarily out of sync.
-- Non-destructive: no tables/data are removed or rewritten.

CREATE OR REPLACE FUNCTION public.get_user_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1),
    (SELECT ur.tenant_id FROM public.user_roles ur WHERE ur.user_id = auth.uid() LIMIT 1)
  )
$$;

CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT ur.role
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
      ORDER BY CASE ur.role
        WHEN 'admin' THEN 1
        WHEN 'manager' THEN 2
        WHEN 'supervisor' THEN 3
        WHEN 'technician' THEN 4
        WHEN 'insurance' THEN 5
        ELSE 99
      END
      LIMIT 1
    ),
    (SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  )
$$;

GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
