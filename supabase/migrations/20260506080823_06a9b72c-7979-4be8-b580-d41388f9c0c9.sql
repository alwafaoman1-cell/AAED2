
CREATE TABLE IF NOT EXISTS public.tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  provider text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secrets jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_test_at timestamptz,
  last_test_status text,
  last_test_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, provider)
);

ALTER TABLE public.tenant_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admin read tenant_integrations" ON public.tenant_integrations
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admin insert tenant_integrations" ON public.tenant_integrations
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admin update tenant_integrations" ON public.tenant_integrations
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE POLICY "Admin delete tenant_integrations" ON public.tenant_integrations
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE TRIGGER trg_tenant_integrations_updated
  BEFORE UPDATE ON public.tenant_integrations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
