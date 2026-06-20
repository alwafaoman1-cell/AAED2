
-- Revoke execute from anon/public on SECURITY DEFINER functions
REVOKE EXECUTE ON FUNCTION public.get_user_role() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.get_user_email() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.attach_user_to_staging_tenant(text) FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.enforce_single_default_template() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.prevent_paid_claim_updates() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.auto_create_job_order_on_approval() FROM anon, public;
REVOKE EXECUTE ON FUNCTION public.auto_close_claim_on_delivery() FROM anon, public;

-- Grant execute back to authenticated where needed (helpers used by RLS/policies/app)
GRANT EXECUTE ON FUNCTION public.get_user_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_email() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.attach_user_to_staging_tenant(text) TO authenticated, service_role;
