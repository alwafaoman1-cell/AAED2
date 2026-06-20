-- Allow admins to update profiles within their tenant, but prevent self-privilege escalation
CREATE POLICY "Admins can update tenant profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = 'admin'::app_role
)
WITH CHECK (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = 'admin'::app_role
  -- An admin cannot change their own role (prevents self-lockout / abuse via duplicate session)
  AND (user_id <> auth.uid() OR role = 'admin'::app_role)
);