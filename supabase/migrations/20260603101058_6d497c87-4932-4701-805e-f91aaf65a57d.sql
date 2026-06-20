
-- Customers
CREATE POLICY "Supervisor insert customers" ON public.customers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
CREATE POLICY "Supervisor update customers" ON public.customers
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

-- Job orders
CREATE POLICY "Supervisor insert job_orders" ON public.job_orders
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
CREATE POLICY "Supervisor update job_orders" ON public.job_orders
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

-- Job order parts
CREATE POLICY "Supervisor insert parts" ON public.job_order_parts
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
CREATE POLICY "Supervisor update parts" ON public.job_order_parts
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

-- Inspections
CREATE POLICY "Supervisor insert inspections" ON public.inspections
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
CREATE POLICY "Supervisor update inspections" ON public.inspections
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

-- Damage markers
CREATE POLICY "Supervisor insert damage_markers" ON public.damage_markers
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

-- Expenses
CREATE POLICY "Supervisor insert expenses" ON public.expenses
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

-- Daily tasks (already allows any tenant member for insert/update)

-- Insurance claims / companies / estimates (read + create/update like insurance role)
CREATE POLICY "Supervisor insert insurance_claims" ON public.insurance_claims
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
CREATE POLICY "Supervisor update insurance_claims" ON public.insurance_claims
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);

CREATE POLICY "Supervisor insert insurance_estimates" ON public.insurance_estimates
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
CREATE POLICY "Supervisor update insurance_estimates" ON public.insurance_estimates
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
-- Also allow supervisor SELECT on insurance_estimates (existing policy restricts to specific roles)
CREATE POLICY "Supervisor read insurance_estimates" ON public.insurance_estimates
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id() AND get_user_role() = 'supervisor'::app_role);
