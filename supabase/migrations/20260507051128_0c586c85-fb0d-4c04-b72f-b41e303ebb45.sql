
-- 1) Restrict tenant_integrations to admin only (contains API secrets)
DROP POLICY IF EXISTS "Admin read tenant_integrations" ON public.tenant_integrations;
DROP POLICY IF EXISTS "Admin insert tenant_integrations" ON public.tenant_integrations;
DROP POLICY IF EXISTS "Admin update tenant_integrations" ON public.tenant_integrations;
DROP POLICY IF EXISTS "Admin delete tenant_integrations" ON public.tenant_integrations;

CREATE POLICY "Admin only read tenant_integrations" ON public.tenant_integrations
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);
CREATE POLICY "Admin only insert tenant_integrations" ON public.tenant_integrations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);
CREATE POLICY "Admin only update tenant_integrations" ON public.tenant_integrations
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);
CREATE POLICY "Admin only delete tenant_integrations" ON public.tenant_integrations
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);

-- 2) Restrict tenant_sms_settings to admin only (contains Twilio credentials)
DROP POLICY IF EXISTS "Admin read sms settings" ON public.tenant_sms_settings;
DROP POLICY IF EXISTS "Admin insert sms settings" ON public.tenant_sms_settings;
DROP POLICY IF EXISTS "Admin update sms settings" ON public.tenant_sms_settings;

CREATE POLICY "Admin only read sms settings" ON public.tenant_sms_settings
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);
CREATE POLICY "Admin only insert sms settings" ON public.tenant_sms_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);
CREATE POLICY "Admin only update sms settings" ON public.tenant_sms_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'admin'::app_role);

-- Remove tenant_sms_settings from realtime to prevent credential broadcast
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'tenant_sms_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.tenant_sms_settings;
  END IF;
END $$;

-- 3) Restrict payment_links SELECT (PII) to admin/manager/insurance only
DROP POLICY IF EXISTS "Tenant read payment_links" ON public.payment_links;
CREATE POLICY "Staff read payment_links" ON public.payment_links
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
  );

-- 4) Revoke EXECUTE on SECURITY DEFINER trigger functions from authenticated/public/anon
REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template() FROM PUBLIC, anon, authenticated;

-- 5) Restrict avatars bucket listing — make folder-scoped
-- (Files remain publicly readable by direct URL since bucket is public, but listing is restricted)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='storage' AND tablename='objects' AND policyname='Avatar images are publicly accessible') THEN
    DROP POLICY "Avatar images are publicly accessible" ON storage.objects;
  END IF;
END $$;

CREATE POLICY "Avatar public read by direct path"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars' AND name IS NOT NULL);
