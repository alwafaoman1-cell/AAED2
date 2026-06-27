CREATE TABLE IF NOT EXISTS public.tenant_security_settings (
  tenant_id uuid PRIMARY KEY REFERENCES public.tenants(id) ON DELETE CASCADE,
  login_otp_enabled boolean NOT NULL DEFAULT false,
  cloud_reset_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid
);

ALTER TABLE public.tenant_security_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "tenant_security_settings_select" ON public.tenant_security_settings;
CREATE POLICY "tenant_security_settings_select"
  ON public.tenant_security_settings FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS "tenant_security_settings_admin_write" ON public.tenant_security_settings;
CREATE POLICY "tenant_security_settings_admin_write"
  ON public.tenant_security_settings FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = tenant_security_settings.tenant_id
        AND p.role IN ('admin', 'manager')
    )
  );

DROP POLICY IF EXISTS "tenant_security_settings_admin_update" ON public.tenant_security_settings;
CREATE POLICY "tenant_security_settings_admin_update"
  ON public.tenant_security_settings FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = tenant_security_settings.tenant_id
        AND p.role IN ('admin', 'manager')
    )
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.security_action_otps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('cloud_reset', 'login_otp')),
  code_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_security_action_otps_lookup
  ON public.security_action_otps (tenant_id, user_id, action, expires_at DESC);

ALTER TABLE public.security_action_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "security_action_otps_no_client_read" ON public.security_action_otps;
CREATE POLICY "security_action_otps_no_client_read"
  ON public.security_action_otps FOR SELECT TO authenticated
  USING (false);

DROP POLICY IF EXISTS "security_action_otps_no_client_write" ON public.security_action_otps;
CREATE POLICY "security_action_otps_no_client_write"
  ON public.security_action_otps FOR ALL TO authenticated
  USING (false)
  WITH CHECK (false);

CREATE TABLE IF NOT EXISTS public.cloud_reset_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  requested_by uuid,
  status text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cloud_reset_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cloud_reset_audit_tenant_admin_read" ON public.cloud_reset_audit_log;
CREATE POLICY "cloud_reset_audit_tenant_admin_read"
  ON public.cloud_reset_audit_log FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.user_id = auth.uid()
        AND p.tenant_id = cloud_reset_audit_log.tenant_id
        AND p.role IN ('admin', 'manager')
    )
  );
