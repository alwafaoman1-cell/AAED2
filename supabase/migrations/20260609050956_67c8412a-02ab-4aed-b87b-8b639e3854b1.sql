-- Revoke broad execute access from all SECURITY DEFINER functions, then re-grant
-- only where signed-in users genuinely need to call them.

-- Trigger-only functions: no direct execute needed.
REVOKE ALL ON FUNCTION public.auto_close_claim_on_delivery() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.auto_create_job_order_on_approval() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_single_default_template() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_insurance_estimate_number() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_paid_claim_updates() FROM PUBLIC, anon, authenticated;

-- User-facing helpers: revoke from anon and PUBLIC, allow authenticated only.
REVOKE ALL ON FUNCTION public.get_user_email() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_email() TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated;

REVOKE ALL ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;

REVOKE ALL ON FUNCTION public.attach_user_to_staging_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_user_to_staging_tenant(text) TO authenticated;