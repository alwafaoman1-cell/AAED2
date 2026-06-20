-- Re-bind sync trigger so every profile insert/update mirrors to user_roles.
DROP TRIGGER IF EXISTS sync_profile_role_to_user_roles_trg ON public.profiles;
CREATE TRIGGER sync_profile_role_to_user_roles_trg
AFTER INSERT OR UPDATE OF role, tenant_id ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_role_to_user_roles();

-- Backfill any existing profiles missing a user_roles row.
INSERT INTO public.user_roles (user_id, tenant_id, role)
SELECT p.user_id, p.tenant_id, p.role
FROM public.profiles p
LEFT JOIN public.user_roles ur
  ON ur.user_id = p.user_id AND ur.role = p.role
WHERE ur.user_id IS NULL AND p.role IS NOT NULL
ON CONFLICT (user_id, role) DO NOTHING;