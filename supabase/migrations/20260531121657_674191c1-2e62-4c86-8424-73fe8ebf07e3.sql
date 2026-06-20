-- =========================================================================
-- Layered RESTRICTIVE policies that block customer-role users
-- from reading staff/financial data. Existing permissive policies stay,
-- so admin/manager/technician/insurance/accountant continue to work.
-- =========================================================================

-- Helper inline expression: customer role cannot see these rows at all.
-- 1) Operational tables (no customer access)
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'job_orders','inspections','damage_markers','job_order_parts','job_order_logs',
    'invoices','insurance_invoices','claim_payments','claim_audit_logs',
    'expenses','journal_entries','journal_lines',
    'purchase_invoices','supplier_payments','suppliers',
    'sales_documents','sales_payments','print_templates'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Block customer role select" ON public.%I', t);
    EXECUTE format(
      'CREATE POLICY "Block customer role select" ON public.%I AS RESTRICTIVE FOR SELECT TO authenticated USING (public.get_user_role() <> ''customer''::public.app_role)',
      t
    );
  END LOOP;
END $$;

-- 2) Vehicles — customer can only see vehicles they own (matched via customers.email)
DROP POLICY IF EXISTS "Block customer role select" ON public.vehicles;
CREATE POLICY "Customer sees only own vehicles"
ON public.vehicles
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.get_user_role() <> 'customer'::public.app_role
  OR customer_id IN (
    SELECT c.id FROM public.customers c
    WHERE c.tenant_id = public.get_user_tenant_id()
      AND c.email = (SELECT u.email FROM auth.users u WHERE u.id = auth.uid())::text
  )
);

-- 3) Profiles — customer can only see their own profile row
DROP POLICY IF EXISTS "Customer sees only own profile" ON public.profiles;
CREATE POLICY "Customer sees only own profile"
ON public.profiles
AS RESTRICTIVE
FOR SELECT
TO authenticated
USING (
  public.get_user_role() <> 'customer'::public.app_role
  OR user_id = auth.uid()
);

-- 4) Restrict writes (INSERT/UPDATE) so customer-role can't tamper
--    with audit logs, daily tasks, or SMS logs.
DROP POLICY IF EXISTS "Block customer role insert" ON public.claim_audit_logs;
CREATE POLICY "Block customer role insert"
ON public.claim_audit_logs AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (public.get_user_role() <> 'customer'::public.app_role);

DROP POLICY IF EXISTS "Block customer role insert" ON public.daily_tasks;
CREATE POLICY "Block customer role insert"
ON public.daily_tasks AS RESTRICTIVE FOR INSERT TO authenticated
WITH CHECK (public.get_user_role() <> 'customer'::public.app_role);

DROP POLICY IF EXISTS "Block customer role update" ON public.daily_tasks;
CREATE POLICY "Block customer role update"
ON public.daily_tasks AS RESTRICTIVE FOR UPDATE TO authenticated
USING (public.get_user_role() <> 'customer'::public.app_role)
WITH CHECK (public.get_user_role() <> 'customer'::public.app_role);

-- sms_logs (table exists per scan finding even if not in shown schema dump)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename='sms_logs') THEN
    EXECUTE 'DROP POLICY IF EXISTS "Block customer role insert" ON public.sms_logs';
    EXECUTE 'CREATE POLICY "Block customer role insert" ON public.sms_logs AS RESTRICTIVE FOR INSERT TO authenticated WITH CHECK (public.get_user_role() <> ''customer''::public.app_role)';
    EXECUTE 'DROP POLICY IF EXISTS "Block customer role select" ON public.sms_logs';
    EXECUTE 'CREATE POLICY "Block customer role select" ON public.sms_logs AS RESTRICTIVE FOR SELECT TO authenticated USING (public.get_user_role() <> ''customer''::public.app_role)';
  END IF;
END $$;