-- Non-destructive safety migration for AI/integration status writes.
-- Some production databases have the tenant_integrations migration marked applied
-- while the schema cache/table is missing the status columns used by Edge Functions.

ALTER TABLE public.tenant_integrations
  ADD COLUMN IF NOT EXISTS last_error text,
  ADD COLUMN IF NOT EXISTS last_tested_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_success_at timestamptz;
