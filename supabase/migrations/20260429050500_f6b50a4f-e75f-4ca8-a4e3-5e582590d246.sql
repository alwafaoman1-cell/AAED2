-- Daily tasks table
CREATE TABLE IF NOT EXISTS public.daily_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  user_id uuid,
  title text NOT NULL,
  description text,
  due_date date NOT NULL DEFAULT CURRENT_DATE,
  priority text NOT NULL DEFAULT 'normal',
  status text NOT NULL DEFAULT 'pending',
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS daily_tasks_tenant_due_idx ON public.daily_tasks(tenant_id, due_date);
CREATE INDEX IF NOT EXISTS daily_tasks_status_idx ON public.daily_tasks(status);

ALTER TABLE public.daily_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant select daily_tasks" ON public.daily_tasks
  FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Staff insert daily_tasks" ON public.daily_tasks
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Staff update daily_tasks" ON public.daily_tasks
  FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

CREATE POLICY "Staff delete daily_tasks" ON public.daily_tasks
  FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])
  );

CREATE TRIGGER trg_daily_tasks_updated_at
  BEFORE UPDATE ON public.daily_tasks
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();