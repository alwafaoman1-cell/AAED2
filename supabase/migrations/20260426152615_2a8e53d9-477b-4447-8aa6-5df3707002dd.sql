-- Print Templates Studio schema
CREATE TABLE public.print_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  doc_type text NOT NULL,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  is_default boolean NOT NULL DEFAULT false,
  schema jsonb NOT NULL DEFAULT '{}'::jsonb,
  thumbnail_url text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_print_templates_tenant_type ON public.print_templates(tenant_id, doc_type);
CREATE INDEX idx_print_templates_default ON public.print_templates(tenant_id, doc_type, is_default) WHERE is_default = true;

ALTER TABLE public.print_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant read print_templates"
  ON public.print_templates FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Staff insert print_templates"
  ON public.print_templates FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
  );

CREATE POLICY "Staff update print_templates"
  ON public.print_templates FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
  );

CREATE POLICY "Admin delete print_templates"
  ON public.print_templates FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
    AND is_system = false
  );

-- updated_at trigger
CREATE TRIGGER trg_print_templates_updated_at
  BEFORE UPDATE ON public.print_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Ensure only one default per (tenant, doc_type)
CREATE OR REPLACE FUNCTION public.enforce_single_default_template()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.is_default = true THEN
    UPDATE public.print_templates
       SET is_default = false
     WHERE tenant_id = NEW.tenant_id
       AND doc_type = NEW.doc_type
       AND id <> NEW.id
       AND is_default = true;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_print_templates_single_default
  BEFORE INSERT OR UPDATE OF is_default ON public.print_templates
  FOR EACH ROW EXECUTE FUNCTION public.enforce_single_default_template();

-- Enable realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.print_templates;
ALTER TABLE public.print_templates REPLICA IDENTITY FULL;