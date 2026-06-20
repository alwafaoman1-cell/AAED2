
-- 1) Add restrictive policy on daily_tasks to block customer role from reading
CREATE POLICY "Block customer role select daily_tasks"
  ON public.daily_tasks
  AS RESTRICTIVE
  FOR SELECT
  TO authenticated
  USING (public.get_user_role() <> 'customer'::public.app_role);

-- 2) Move role authority from profiles.role to a dedicated user_roles table
CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Read: users can see roles within their tenant (needed by client to render UI)
CREATE POLICY "Users read roles in tenant"
  ON public.user_roles FOR SELECT TO authenticated
  USING (tenant_id = public.get_user_tenant_id());

-- Write: only admins (of the same tenant) may assign/modify roles
CREATE POLICY "Admins manage tenant roles"
  ON public.user_roles FOR ALL TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() = 'admin'::public.app_role)
  WITH CHECK (tenant_id = public.get_user_tenant_id() AND public.get_user_role() = 'admin'::public.app_role);

-- Backfill from existing profiles
INSERT INTO public.user_roles (user_id, tenant_id, role)
SELECT user_id, tenant_id, role FROM public.profiles
WHERE user_id IS NOT NULL AND tenant_id IS NOT NULL AND role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;

-- 3) has_role() helper (SECURITY DEFINER, avoids recursive RLS)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  );
$$;

-- 4) Re-point get_user_role() to user_roles (highest-privilege role wins)
CREATE OR REPLACE FUNCTION public.get_user_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles
  WHERE user_id = auth.uid()
  ORDER BY CASE role
    WHEN 'admin' THEN 1
    WHEN 'manager' THEN 2
    WHEN 'supervisor' THEN 3
    WHEN 'technician' THEN 4
    WHEN 'insurance' THEN 5
    WHEN 'customer' THEN 6
    ELSE 99
  END
  LIMIT 1;
$$;

-- 5) Keep user_roles in sync with profiles for backward compatibility
-- (existing app code still writes profiles.role via handle_new_user and admin UI).
CREATE OR REPLACE FUNCTION public.sync_profile_role_to_user_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.role IS NOT NULL AND NEW.user_id IS NOT NULL AND NEW.tenant_id IS NOT NULL THEN
    INSERT INTO public.user_roles (user_id, tenant_id, role)
    VALUES (NEW.user_id, NEW.tenant_id, NEW.role)
    ON CONFLICT (user_id, role) DO NOTHING;

    -- Remove other roles for this user that no longer match (single-role model)
    DELETE FROM public.user_roles
    WHERE user_id = NEW.user_id AND role <> NEW.role;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_profile_role ON public.profiles;
CREATE TRIGGER trg_sync_profile_role
AFTER INSERT OR UPDATE OF role ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_to_user_roles();

-- 6) Harden profiles.role: nobody (not even admins) can change a role via Data API.
-- Role changes must go through user_roles directly.
-- Tighten the admin update policy to forbid role mutation.
DROP POLICY IF EXISTS "Admins can update tenant profiles" ON public.profiles;
CREATE POLICY "Admins can update tenant profiles"
  ON public.profiles FOR UPDATE TO authenticated
  USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() = 'admin'::public.app_role)
  WITH CHECK (
    tenant_id = public.get_user_tenant_id()
    AND public.get_user_role() = 'admin'::public.app_role
    AND role = (SELECT p.role FROM public.profiles p WHERE p.id = profiles.id)
  );
