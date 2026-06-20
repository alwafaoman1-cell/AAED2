-- Block customer-role users from reading sensitive lookup/master tables
CREATE POLICY "Block customer role select"
  ON public.insurance_companies
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (get_user_role() <> 'customer'::app_role);

CREATE POLICY "Block customer role select"
  ON public.inventory
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (get_user_role() <> 'customer'::app_role);

CREATE POLICY "Block customer role select"
  ON public.vehicle_makes
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (get_user_role() <> 'customer'::app_role);

CREATE POLICY "Block customer role select"
  ON public.vehicle_models
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (get_user_role() <> 'customer'::app_role);