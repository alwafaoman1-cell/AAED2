
CREATE TABLE IF NOT EXISTS public.payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  gateway text NOT NULL,
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'OMR',
  customer_name text,
  customer_phone text,
  customer_email text,
  source_type text NOT NULL,
  source_id uuid,
  source_reference text,
  hosted_url text,
  provider_session_id text,
  status text NOT NULL DEFAULT 'pending',
  paid_at timestamptz,
  expires_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_payment_links_tenant_source
  ON public.payment_links(tenant_id, source_type, source_id);
CREATE INDEX IF NOT EXISTS idx_payment_links_status
  ON public.payment_links(tenant_id, status);

ALTER TABLE public.payment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read payment_links" ON public.payment_links
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "Staff insert payment_links" ON public.payment_links
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]));

CREATE POLICY "Staff update payment_links" ON public.payment_links
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]));

CREATE POLICY "Admin delete payment_links" ON public.payment_links
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]));

CREATE TRIGGER trg_payment_links_updated
  BEFORE UPDATE ON public.payment_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
