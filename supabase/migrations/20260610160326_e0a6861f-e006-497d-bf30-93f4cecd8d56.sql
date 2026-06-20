
-- 1) Restrict user_roles SELECT: only own row, or admins/managers see all
DROP POLICY IF EXISTS "Users read roles in tenant" ON public.user_roles;

CREATE POLICY "Users read own role or admin/manager reads all"
ON public.user_roles
FOR SELECT
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND (
    user_id = auth.uid()
    OR public.get_user_role() IN ('admin'::app_role, 'manager'::app_role)
  )
);

-- 2) Revoke EXECUTE from anon on SECURITY DEFINER functions that should not be public.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM anon, PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;

REVOKE EXECUTE ON FUNCTION public.sync_profile_role_to_user_roles() FROM anon, PUBLIC;
REVOKE EXECUTE ON FUNCTION public.log_claim_date_changes() FROM anon, PUBLIC;
