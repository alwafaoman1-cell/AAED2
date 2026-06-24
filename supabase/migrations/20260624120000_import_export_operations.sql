CREATE TABLE IF NOT EXISTS public.import_export_operations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid,
  operation text NOT NULL CHECK (operation IN ('import', 'export')),
  entity text NOT NULL,
  status text NOT NULL DEFAULT 'completed',
  row_count integer NOT NULL DEFAULT 0,
  duplicate_count integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.import_export_operations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "import_export_operations_select" ON public.import_export_operations
  FOR SELECT USING (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_platform_admin = true)
  );

CREATE POLICY "import_export_operations_insert" ON public.import_export_operations
  FOR INSERT WITH CHECK (
    tenant_id IN (SELECT tenant_id FROM public.profiles WHERE user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM public.profiles WHERE user_id = auth.uid() AND is_platform_admin = true)
  );

CREATE INDEX IF NOT EXISTS idx_import_export_operations_tenant_created
  ON public.import_export_operations (tenant_id, created_at DESC);

ALTER PUBLICATION supabase_realtime ADD TABLE public.import_export_operations;

