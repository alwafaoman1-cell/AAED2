CREATE TABLE IF NOT EXISTS public.app_trash (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  entity_type text NOT NULL,
  entity_id text NOT NULL,
  label text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_by uuid DEFAULT auth.uid(),
  deleted_at timestamptz NOT NULL DEFAULT now(),
  restore_status text NOT NULL DEFAULT 'trashed',
  restored_by uuid,
  restored_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_trash_tenant_status ON public.app_trash(tenant_id, restore_status, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_app_trash_entity ON public.app_trash(tenant_id, entity_type, entity_id);

ALTER TABLE public.app_trash ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_trash_select_tenant ON public.app_trash;
CREATE POLICY app_trash_select_tenant
  ON public.app_trash FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS app_trash_insert_tenant ON public.app_trash;
CREATE POLICY app_trash_insert_tenant
  ON public.app_trash FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS app_trash_update_admin ON public.app_trash;
CREATE POLICY app_trash_update_admin
  ON public.app_trash FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS app_trash_delete_admin ON public.app_trash;
CREATE POLICY app_trash_delete_admin
  ON public.app_trash FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  );

CREATE TABLE IF NOT EXISTS public.accounting_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  receipt_number text NOT NULL,
  receipt_date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(12,3) NOT NULL DEFAULT 0,
  payer_name text NOT NULL DEFAULT '',
  category_id text,
  cashbox_id text,
  payment_method text NOT NULL DEFAULT 'cash',
  notes text,
  customer_id uuid,
  invoice_id uuid,
  claim_id uuid,
  payment_id uuid,
  archived_at timestamptz,
  deleted_at timestamptz,
  created_by uuid DEFAULT auth.uid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS idx_accounting_receipts_tenant_date ON public.accounting_receipts(tenant_id, receipt_date DESC);
CREATE INDEX IF NOT EXISTS idx_accounting_receipts_links ON public.accounting_receipts(tenant_id, customer_id, invoice_id, claim_id, payment_id);

ALTER TABLE public.accounting_receipts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS accounting_receipts_select_tenant ON public.accounting_receipts;
CREATE POLICY accounting_receipts_select_tenant
  ON public.accounting_receipts FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS accounting_receipts_insert_tenant ON public.accounting_receipts;
CREATE POLICY accounting_receipts_insert_tenant
  ON public.accounting_receipts FOR INSERT TO authenticated
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS accounting_receipts_update_tenant ON public.accounting_receipts;
CREATE POLICY accounting_receipts_update_tenant
  ON public.accounting_receipts FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DROP POLICY IF EXISTS accounting_receipts_delete_admin ON public.accounting_receipts;
CREATE POLICY accounting_receipts_delete_admin
  ON public.accounting_receipts FOR DELETE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  );

CREATE TABLE IF NOT EXISTS public.technician_time_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  technician_id uuid DEFAULT auth.uid(),
  technician_name text NOT NULL DEFAULT '',
  work_order_id text,
  task_id text,
  clock_in timestamptz NOT NULL DEFAULT now(),
  clock_out timestamptz,
  minutes integer,
  pause_reason text,
  notes text,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_technician_time_logs_tenant ON public.technician_time_logs(tenant_id, clock_in DESC);
CREATE INDEX IF NOT EXISTS idx_technician_time_logs_technician ON public.technician_time_logs(tenant_id, technician_id, status);
CREATE INDEX IF NOT EXISTS idx_technician_time_logs_work_order ON public.technician_time_logs(tenant_id, work_order_id);

ALTER TABLE public.technician_time_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technician_time_logs_select_scope ON public.technician_time_logs;
CREATE POLICY technician_time_logs_select_scope
  ON public.technician_time_logs FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      technician_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  );

DROP POLICY IF EXISTS technician_time_logs_insert_self ON public.technician_time_logs;
CREATE POLICY technician_time_logs_insert_self
  ON public.technician_time_logs FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (technician_id = auth.uid() OR technician_id IS NULL)
  );

DROP POLICY IF EXISTS technician_time_logs_update_scope ON public.technician_time_logs;
CREATE POLICY technician_time_logs_update_scope
  ON public.technician_time_logs FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      technician_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

CREATE TABLE IF NOT EXISTS public.technician_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  technician_id uuid DEFAULT auth.uid(),
  technician_name text NOT NULL DEFAULT '',
  work_order_id text NOT NULL,
  note text NOT NULL,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_technician_notes_tenant_work_order ON public.technician_notes(tenant_id, work_order_id, created_at DESC);

ALTER TABLE public.technician_notes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS technician_notes_select_scope ON public.technician_notes;
CREATE POLICY technician_notes_select_scope
  ON public.technician_notes FOR SELECT TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND deleted_at IS NULL
    AND (
      technician_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  );

DROP POLICY IF EXISTS technician_notes_insert_self ON public.technician_notes;
CREATE POLICY technician_notes_insert_self
  ON public.technician_notes FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND (technician_id = auth.uid() OR technician_id IS NULL)
  );

DROP POLICY IF EXISTS technician_notes_update_scope ON public.technician_notes;
CREATE POLICY technician_notes_update_scope
  ON public.technician_notes FOR UPDATE TO authenticated
  USING (
    tenant_id = public.get_user_tenant_id()
    AND (
      technician_id = auth.uid()
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'manager')
      OR public.has_role(auth.uid(), 'supervisor')
    )
  )
  WITH CHECK (tenant_id = public.get_user_tenant_id());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'app_trash'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.app_trash;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'accounting_receipts'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.accounting_receipts;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'technician_time_logs'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.technician_time_logs;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'technician_notes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.technician_notes;
    END IF;
  END IF;
END $$;
