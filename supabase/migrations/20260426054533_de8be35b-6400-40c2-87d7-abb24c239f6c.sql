-- Fix handle_new_user to create tenant BEFORE profile
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
BEGIN
  v_tenant_id := COALESCE((NEW.raw_user_meta_data->>'tenant_id')::uuid, gen_random_uuid());
  
  -- Create tenant FIRST (if not exists)
  INSERT INTO public.tenants (id, name)
  VALUES (v_tenant_id, COALESCE(NEW.raw_user_meta_data->>'company_name', 'ورشتي'))
  ON CONFLICT (id) DO NOTHING;
  
  -- Then create profile
  INSERT INTO public.profiles (user_id, tenant_id, full_name, role)
  VALUES (
    NEW.id,
    v_tenant_id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE((NEW.raw_user_meta_data->>'role')::public.app_role, 'admin')
  );
  
  RETURN NEW;
END;
$function$;

-- Ensure trigger exists on auth.users
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();