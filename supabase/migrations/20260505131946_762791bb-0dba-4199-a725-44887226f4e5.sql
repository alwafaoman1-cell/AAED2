CREATE TABLE public.tenant_sms_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL UNIQUE,
  provider text NOT NULL DEFAULT 'twilio',
  account_sid text,
  auth_token text,
  from_number text,
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tenant_sms_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read sms settings" ON public.tenant_sms_settings
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admin insert sms settings" ON public.tenant_sms_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admin update sms settings" ON public.tenant_sms_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE TRIGGER update_tenant_sms_settings_updated_at
  BEFORE UPDATE ON public.tenant_sms_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.sms_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  to_number text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'sent',
  provider_sid text,
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.sms_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read sms logs" ON public.sms_logs
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Tenant insert sms logs" ON public.sms_logs
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE INDEX idx_sms_logs_tenant_created ON public.sms_logs(tenant_id, created_at DESC);