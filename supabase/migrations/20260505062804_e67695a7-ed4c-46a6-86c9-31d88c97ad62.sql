-- Revoke EXECUTE on SECURITY DEFINER trigger functions from authenticated/anon
-- These are only called via triggers and should not be callable by signed-in users.
REVOKE EXECUTE ON FUNCTION public.generate_claim_payment_number() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.generate_insurance_invoice_number() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.generate_order_number() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.deduct_inventory_on_part_insert() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() FROM authenticated, anon, public;
REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM authenticated, anon, public;