
-- 1) Create staging tenant with fixed UUID for easy reference
INSERT INTO public.tenants (id, name)
VALUES ('00000000-0000-4000-8000-000000005741'::uuid, 'مستأجر تجريبي — Staging')
ON CONFLICT (id) DO NOTHING;

-- 2) Helper function: admin-only, moves a freshly-signed-up user to the staging tenant
CREATE OR REPLACE FUNCTION public.attach_user_to_staging_tenant(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_staging uuid := '00000000-0000-4000-8000-000000005741'::uuid;
  v_caller_role public.app_role;
BEGIN
  -- only admins can run this
  SELECT public.get_user_role() INTO v_caller_role;
  IF v_caller_role <> 'admin' THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  SELECT id INTO v_user_id FROM auth.users WHERE lower(email) = lower(_email) LIMIT 1;
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'user_not_found: %', _email;
  END IF;

  UPDATE public.profiles
     SET tenant_id = v_staging,
         role      = 'admin'
   WHERE user_id = v_user_id;

  RETURN jsonb_build_object('ok', true, 'user_id', v_user_id, 'tenant_id', v_staging);
END;
$$;

REVOKE ALL ON FUNCTION public.attach_user_to_staging_tenant(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.attach_user_to_staging_tenant(text) TO authenticated;
