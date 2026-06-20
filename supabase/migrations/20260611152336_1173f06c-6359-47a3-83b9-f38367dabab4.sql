DROP POLICY IF EXISTS "Tenant scoped realtime write" ON realtime.messages;
CREATE POLICY "Tenant scoped realtime write" ON realtime.messages
  FOR INSERT TO authenticated
  WITH CHECK (
    realtime.topic() = ('tenant:'::text || (public.get_user_tenant_id())::text)
    AND public.get_user_role() <> 'customer'::public.app_role
  );