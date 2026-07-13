-- Ollama / AI extraction usage logging.
-- Non-destructive: no existing data is changed or removed.

CREATE TABLE IF NOT EXISTS public.ai_usage_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  provider text NOT NULL,
  document_type text,
  model text,
  status text NOT NULL DEFAULT 'pending',
  duration_ms integer,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_tenant_created
  ON public.ai_usage_logs (tenant_id, created_at DESC);

ALTER TABLE public.ai_usage_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Tenant admins read ai usage logs" ON public.ai_usage_logs;
CREATE POLICY "Tenant admins read ai usage logs"
ON public.ai_usage_logs
FOR SELECT
USING (
  tenant_id = public.get_user_tenant_id()
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
);

DROP POLICY IF EXISTS "Tenant users insert ai usage logs" ON public.ai_usage_logs;
CREATE POLICY "Tenant users insert ai usage logs"
ON public.ai_usage_logs
FOR INSERT
WITH CHECK (tenant_id = public.get_user_tenant_id());
