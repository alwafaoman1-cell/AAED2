
-- 1) Block customer role from supplement_approval_requests entirely
CREATE POLICY "block_customer_supplement_requests"
  ON public.supplement_approval_requests AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT public.has_role(auth.uid(), 'customer'))
  WITH CHECK (NOT public.has_role(auth.uid(), 'customer'));

-- 2) Block customer role from work_order_supplements
CREATE POLICY "block_customer_work_order_supplements"
  ON public.work_order_supplements AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT public.has_role(auth.uid(), 'customer'))
  WITH CHECK (NOT public.has_role(auth.uid(), 'customer'));

-- 3) Block customer role from supplement_audit_logs
CREATE POLICY "block_customer_supplement_audit"
  ON public.supplement_audit_logs AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT public.has_role(auth.uid(), 'customer'))
  WITH CHECK (NOT public.has_role(auth.uid(), 'customer'));

-- 4) Block customer + restrict writes on workshop_belongings_settings to admin/manager only
CREATE POLICY "block_customer_belongings_settings"
  ON public.workshop_belongings_settings AS RESTRICTIVE
  FOR ALL TO authenticated
  USING (NOT public.has_role(auth.uid(), 'customer'))
  WITH CHECK (NOT public.has_role(auth.uid(), 'customer'));

CREATE POLICY "belongings_settings_write_admin_manager"
  ON public.workshop_belongings_settings AS RESTRICTIVE
  FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "belongings_settings_update_admin_manager"
  ON public.workshop_belongings_settings AS RESTRICTIVE
  FOR UPDATE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

CREATE POLICY "belongings_settings_delete_admin_manager"
  ON public.workshop_belongings_settings AS RESTRICTIVE
  FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager'));

-- 5) Restrict journal_entries / journal_lines SELECT to admin/manager/accountant only
CREATE POLICY "journal_entries_block_low_roles"
  ON public.journal_entries AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    NOT public.has_role(auth.uid(), 'customer')
    AND NOT public.has_role(auth.uid(), 'technician')
    AND NOT public.has_role(auth.uid(), 'supervisor')
    AND NOT public.has_role(auth.uid(), 'insurance')
  );

CREATE POLICY "journal_lines_block_low_roles"
  ON public.journal_lines AS RESTRICTIVE
  FOR SELECT TO authenticated
  USING (
    NOT public.has_role(auth.uid(), 'customer')
    AND NOT public.has_role(auth.uid(), 'technician')
    AND NOT public.has_role(auth.uid(), 'supervisor')
    AND NOT public.has_role(auth.uid(), 'insurance')
  );
