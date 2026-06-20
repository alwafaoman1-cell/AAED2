-- 1) Realtime channel access — restrict to authenticated only, scoped by tenant topic naming
DROP POLICY IF EXISTS "Authenticated realtime read" ON realtime.messages;

CREATE POLICY "Tenant scoped realtime read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  realtime.topic() = ('tenant:' || public.get_user_tenant_id()::text)
);

CREATE POLICY "Tenant scoped realtime write"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  realtime.topic() = ('tenant:' || public.get_user_tenant_id()::text)
);

-- 2) Missing DELETE policies (admin/manager scoped to tenant)
CREATE POLICY "Admin delete invoices"
ON public.invoices
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
);

CREATE POLICY "Admin delete inspections"
ON public.inspections
FOR DELETE
TO authenticated
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
);

-- 3) Revoke EXECUTE on SECURITY DEFINER trigger helper functions from regular roles.
-- These are only meant to be invoked by triggers (which run with table owner privileges).
REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() FROM PUBLIC, anon, authenticated;
