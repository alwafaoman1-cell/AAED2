-- SaaS administration foundation: workshops, feature controls, domains, files and admin audit.

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS legal_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS logo_url text,
  ADD COLUMN IF NOT EXISTS settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS subscription_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS subscription_expires_at timestamptz;

UPDATE public.tenants
SET slug = trim(both '-' from lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')))
  || '-' || left(id::text, 8)
WHERE slug IS NULL OR trim(slug) = '';

CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uidx ON public.tenants(slug);

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_platform_admin boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS invited_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_at timestamptz,
  ADD COLUMN IF NOT EXISTS disabled_by uuid;

ALTER TABLE public.job_orders
  ADD COLUMN IF NOT EXISTS reception_damage_markers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS reception_signature_data_url text;

ALTER TABLE public.inspections
  ALTER COLUMN job_order_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS inspection_code text,
  ADD COLUMN IF NOT EXISTS customer_name text,
  ADD COLUMN IF NOT EXISTS vehicle_summary text,
  ADD COLUMN IF NOT EXISTS plate_number text,
  ADD COLUMN IF NOT EXISTS inspection_date date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN IF NOT EXISTS photo_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'قيد الفحص',
  ADD COLUMN IF NOT EXISTS inspection_kind text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS overall_rating text,
  ADD COLUMN IF NOT EXISTS details jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS computer_report_path text,
  ADD COLUMN IF NOT EXISTS ai_analysis jsonb,
  ADD COLUMN IF NOT EXISTS ai_analysis_status text NOT NULL DEFAULT 'not_analyzed',
  ADD COLUMN IF NOT EXISTS ai_analyzed_at timestamptz;

UPDATE public.inspections
SET inspection_code = 'INS-' || left(id::text, 8)
WHERE inspection_code IS NULL OR trim(inspection_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS inspections_tenant_code_uidx
  ON public.inspections(tenant_id, inspection_code);
CREATE INDEX IF NOT EXISTS inspections_tenant_plate_idx
  ON public.inspections(tenant_id, plate_number, inspection_kind);

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_account_status_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_account_status_check
  CHECK (account_status IN ('invited', 'active', 'disabled', 'pending'));

CREATE OR REPLACE FUNCTION public.is_platform_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE user_id = auth.uid() AND is_platform_admin = true AND account_status = 'active'
  );
$$;

REVOKE ALL ON FUNCTION public.is_platform_admin() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_platform_admin() TO authenticated;

CREATE TABLE IF NOT EXISTS public.tenant_features (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  feature_key text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, feature_key)
);

CREATE TABLE IF NOT EXISTS public.tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  hostname text NOT NULL,
  domain_type text NOT NULL DEFAULT 'custom',
  status text NOT NULL DEFAULT 'pending',
  verification_token text NOT NULL DEFAULT encode(extensions.gen_random_bytes(24), 'hex'),
  verification_error text,
  dns_instructions jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz,
  activated_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (hostname)
);

ALTER TABLE public.tenant_domains DROP CONSTRAINT IF EXISTS tenant_domains_status_check;
ALTER TABLE public.tenant_domains ADD CONSTRAINT tenant_domains_status_check
  CHECK (status IN ('pending', 'verified', 'active', 'failed'));
ALTER TABLE public.tenant_domains DROP CONSTRAINT IF EXISTS tenant_domains_type_check;
ALTER TABLE public.tenant_domains ADD CONSTRAINT tenant_domains_type_check
  CHECK (domain_type IN ('subdomain', 'custom'));

CREATE TABLE IF NOT EXISTS public.tenant_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  bucket_id text NOT NULL DEFAULT 'tenant-files',
  storage_path text NOT NULL,
  file_name text NOT NULL,
  content_type text,
  size_bytes bigint NOT NULL DEFAULT 0,
  category text NOT NULL DEFAULT 'other',
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  claim_id uuid REFERENCES public.insurance_claims(id) ON DELETE SET NULL,
  job_order_id uuid REFERENCES public.job_orders(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (bucket_id, storage_path)
);

CREATE TABLE IF NOT EXISTS public.admin_user_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  actor_user_id uuid,
  target_user_id uuid,
  action text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS tenant_features_tenant_idx ON public.tenant_features(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_domains_tenant_idx ON public.tenant_domains(tenant_id);
CREATE INDEX IF NOT EXISTS tenant_files_tenant_category_idx ON public.tenant_files(tenant_id, category);
CREATE INDEX IF NOT EXISTS admin_user_events_target_idx ON public.admin_user_events(target_user_id, created_at DESC);

INSERT INTO public.tenant_features (tenant_id, feature_key, enabled)
SELECT t.id, feature_key, true
FROM public.tenants t
CROSS JOIN unnest(ARRAY[
  'whatsapp','insurance','workshop','inventory','ai_assistant','reports',
  'pdf_archive','customer_qr_portal','supervisor_app','sales_invoices','insurance_accounting'
]) AS feature_key
ON CONFLICT (tenant_id, feature_key) DO NOTHING;

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('tenant-files', 'tenant-files', false, 52428800)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 52428800;

ALTER TABLE public.tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_domains ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tenant_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_user_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant feature read" ON public.tenant_features;
CREATE POLICY "Tenant feature read" ON public.tenant_features FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Tenant feature manage" ON public.tenant_features;
CREATE POLICY "Tenant feature manage" ON public.tenant_features FOR ALL TO authenticated
USING (
  public.is_platform_admin()
  OR (tenant_id = public.get_user_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')))
)
WITH CHECK (
  public.is_platform_admin()
  OR (tenant_id = public.get_user_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')))
);

DROP POLICY IF EXISTS "Tenant domain read" ON public.tenant_domains;
CREATE POLICY "Tenant domain read" ON public.tenant_domains FOR SELECT TO authenticated
USING (tenant_id = public.get_user_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Tenant domain manage" ON public.tenant_domains;
CREATE POLICY "Tenant domain manage" ON public.tenant_domains FOR ALL TO authenticated
USING (public.is_platform_admin() OR (tenant_id = public.get_user_tenant_id() AND public.has_role(auth.uid(),'admin')))
WITH CHECK (public.is_platform_admin() OR (tenant_id = public.get_user_tenant_id() AND public.has_role(auth.uid(),'admin')));

DROP POLICY IF EXISTS "Tenant files read" ON public.tenant_files;
CREATE POLICY "Tenant files read" ON public.tenant_files FOR SELECT TO authenticated
USING (deleted_at IS NULL AND (tenant_id = public.get_user_tenant_id() OR public.is_platform_admin()));
DROP POLICY IF EXISTS "Tenant files insert" ON public.tenant_files;
CREATE POLICY "Tenant files insert" ON public.tenant_files FOR INSERT TO authenticated
WITH CHECK (tenant_id = public.get_user_tenant_id() OR public.is_platform_admin());
DROP POLICY IF EXISTS "Tenant files manage" ON public.tenant_files;
CREATE POLICY "Tenant files manage" ON public.tenant_files FOR UPDATE TO authenticated
USING (
  public.is_platform_admin()
  OR (tenant_id = public.get_user_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')))
);

DROP POLICY IF EXISTS "Admin events read" ON public.admin_user_events;
CREATE POLICY "Admin events read" ON public.admin_user_events FOR SELECT TO authenticated
USING (
  public.is_platform_admin()
  OR (tenant_id = public.get_user_tenant_id() AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager')))
);

DROP POLICY IF EXISTS "Platform admins manage tenants" ON public.tenants;
CREATE POLICY "Platform admins manage tenants" ON public.tenants FOR ALL TO authenticated
USING (public.is_platform_admin())
WITH CHECK (public.is_platform_admin());

DROP POLICY IF EXISTS "tenant-files read" ON storage.objects;
CREATE POLICY "tenant-files read" ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'tenant-files'
  AND (
    (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    OR public.is_platform_admin()
  )
);
DROP POLICY IF EXISTS "tenant-files upload" ON storage.objects;
CREATE POLICY "tenant-files upload" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'tenant-files'
  AND (
    (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    OR public.is_platform_admin()
  )
);
DROP POLICY IF EXISTS "tenant-files update" ON storage.objects;
CREATE POLICY "tenant-files update" ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'tenant-files'
  AND (
    (storage.foldername(name))[1] = public.get_user_tenant_id()::text
    OR public.is_platform_admin()
  )
);
DROP POLICY IF EXISTS "tenant-files delete" ON storage.objects;
CREATE POLICY "tenant-files delete" ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'tenant-files'
  AND (
    public.is_platform_admin()
    OR (
      (storage.foldername(name))[1] = public.get_user_tenant_id()::text
      AND (public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'manager'))
    )
  )
);

CREATE OR REPLACE FUNCTION public.resolve_tenant_by_hostname(p_hostname text)
RETURNS TABLE(tenant_id uuid, tenant_slug text, tenant_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT t.id, t.slug, t.name
  FROM public.tenant_domains d
  JOIN public.tenants t ON t.id = d.tenant_id
  WHERE lower(d.hostname) = lower(trim(p_hostname))
    AND d.status = 'active'
    AND t.is_active = true
  LIMIT 1;
$$;
REVOKE ALL ON FUNCTION public.resolve_tenant_by_hostname(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_tenant_by_hostname(text) TO anon, authenticated;

DROP TRIGGER IF EXISTS update_tenant_features_updated_at ON public.tenant_features;
CREATE TRIGGER update_tenant_features_updated_at
BEFORE UPDATE ON public.tenant_features FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS update_tenant_domains_updated_at ON public.tenant_domains;
CREATE TRIGGER update_tenant_domains_updated_at
BEFORE UPDATE ON public.tenant_domains FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
