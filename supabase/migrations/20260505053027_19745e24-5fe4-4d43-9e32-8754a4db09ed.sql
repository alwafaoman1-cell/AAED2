
-- Trigger-only functions: revoke EXECUTE from public/anon/authenticated
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deduct_inventory_on_part_insert() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_order_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_claim_payment_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_insurance_invoice_number() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template() FROM PUBLIC, anon, authenticated;

-- Helper functions: only authenticated users
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;

-- realtime.messages is owned and migrated by the managed Supabase Realtime
-- service. Fresh hosted projects intentionally deny the migration role ALTER
-- privileges on this system table. Application tenant isolation remains on the
-- public source tables and their RLS policies; do not install a broad USING
-- (true) policy on the managed Realtime schema.
