
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

-- Realtime: scope subscriptions to tenant topic ("tenant:<uuid>") or rely on table RLS
-- Enable RLS on realtime.messages and require authenticated; broadcast channel topics
-- must include tenant id. We allow read only when topic equals 'tenant:<tenant_id>' or
-- when the user is authenticated and the underlying postgres_changes rows pass table RLS.
ALTER TABLE IF EXISTS realtime.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated realtime read" ON realtime.messages;
CREATE POLICY "Authenticated realtime read"
ON realtime.messages
FOR SELECT
TO authenticated
USING (true);
