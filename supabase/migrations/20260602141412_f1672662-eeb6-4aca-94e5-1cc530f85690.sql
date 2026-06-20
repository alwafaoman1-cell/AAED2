-- Trigger-only SECURITY DEFINER functions: revoke EXECUTE from authenticated as well.
-- They only ever run via triggers; PostgreSQL triggers fire regardless of EXECUTE grants.

REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.handle_new_user()                   FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.prevent_paid_claim_updates()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template()   FROM PUBLIC, anon, authenticated;
