-- Lock down SECURITY DEFINER functions: revoke EXECUTE from PUBLIC/anon, allow only authenticated (and service_role where needed).

-- 1) get_user_role()
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;

-- 2) get_user_tenant_id()
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated, service_role;

-- 3) attach_user_to_staging_tenant(text) — admin-only helper
REVOKE EXECUTE ON FUNCTION public.attach_user_to_staging_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_user_to_staging_tenant(text) TO authenticated, service_role;

-- 4) Trigger functions — only the trigger executor needs them; revoke from anon/PUBLIC.
REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.handle_new_user() TO service_role;

REVOKE EXECUTE ON FUNCTION public.prevent_paid_claim_updates() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.prevent_paid_claim_updates() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template() FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.enforce_single_default_template() TO authenticated, service_role;
