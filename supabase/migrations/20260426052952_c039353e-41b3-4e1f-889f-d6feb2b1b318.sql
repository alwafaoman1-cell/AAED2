-- 1) إعادة تثبيت الـtrigger لضمان إنشاء profile + tenant لأي مستخدم جديد
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2) معالجة المستخدمين الموجودين بدون profile: إنشاء tenant + profile لكل واحد
DO $$
DECLARE
  u RECORD;
  new_tenant_id uuid;
BEGIN
  FOR u IN
    SELECT au.id, au.email, au.raw_user_meta_data
    FROM auth.users au
    LEFT JOIN public.profiles p ON p.user_id = au.id
    WHERE p.id IS NULL
  LOOP
    new_tenant_id := COALESCE(
      (u.raw_user_meta_data->>'tenant_id')::uuid,
      gen_random_uuid()
    );

    INSERT INTO public.tenants (id, name, is_active)
    VALUES (
      new_tenant_id,
      COALESCE(u.raw_user_meta_data->>'company_name', 'ورشتي'),
      true
    )
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.profiles (user_id, tenant_id, full_name, role)
    VALUES (
      u.id,
      new_tenant_id,
      COALESCE(u.raw_user_meta_data->>'full_name', split_part(u.email, '@', 1)),
      COALESCE((u.raw_user_meta_data->>'role')::public.app_role, 'admin'::public.app_role)
    );
  END LOOP;
END $$;

-- 3) حقول تسليم المركبة للمطالبة
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS delivery_photos       text[]                    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS satisfaction_photos   text[]                    DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS receiver_id_photo     text,
  ADD COLUMN IF NOT EXISTS receiver_name         text,
  ADD COLUMN IF NOT EXISTS receiver_id_number    text,
  ADD COLUMN IF NOT EXISTS delivered_at          timestamptz,
  ADD COLUMN IF NOT EXISTS delivery_notes        text;