
-- جدول إعدادات الشركة المركزي (مصدر وحيد للحقيقة لكل الإعدادات)
CREATE TABLE IF NOT EXISTS public.tenant_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  key text NOT NULL,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  version integer NOT NULL DEFAULT 1,
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.tenant_settings TO authenticated;
GRANT ALL ON public.tenant_settings TO service_role;

ALTER TABLE public.tenant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_settings_select" ON public.tenant_settings
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tenant_settings_insert" ON public.tenant_settings
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tenant_settings_update" ON public.tenant_settings
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id())
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "tenant_settings_delete" ON public.tenant_settings
  FOR DELETE TO authenticated
  USING (tenant_id = public.get_user_tenant_id()
         AND public.has_role(auth.uid(), 'admin'));

-- زيادة version تلقائياً + ختم updated_at
CREATE OR REPLACE FUNCTION public.bump_tenant_settings_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.value::text IS DISTINCT FROM OLD.value::text THEN
    NEW.version := COALESCE(OLD.version, 0) + 1;
    NEW.updated_at := now();
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_tenant_settings_version ON public.tenant_settings;
CREATE TRIGGER trg_tenant_settings_version
  BEFORE UPDATE ON public.tenant_settings
  FOR EACH ROW EXECUTE FUNCTION public.bump_tenant_settings_version();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.tenant_settings;
