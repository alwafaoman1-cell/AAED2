
-- Backups bucket (private)
INSERT INTO storage.buckets (id, name, public)
VALUES ('backups', 'backups', false)
ON CONFLICT (id) DO NOTHING;

-- Policies: only admin/manager of the tenant can read/write their backup folder.
-- Path convention: <tenant_id>/<filename>
DROP POLICY IF EXISTS "Tenant admin read backups" ON storage.objects;
DROP POLICY IF EXISTS "Tenant admin write backups" ON storage.objects;
DROP POLICY IF EXISTS "Tenant admin update backups" ON storage.objects;
DROP POLICY IF EXISTS "Tenant admin delete backups" ON storage.objects;

CREATE POLICY "Tenant admin read backups"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'backups'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  AND public.get_user_role() IN ('admin','manager')
);

CREATE POLICY "Tenant admin write backups"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'backups'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  AND public.get_user_role() IN ('admin','manager')
);

CREATE POLICY "Tenant admin update backups"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'backups'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  AND public.get_user_role() IN ('admin','manager')
);

CREATE POLICY "Tenant admin delete backups"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'backups'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  AND public.get_user_role() = 'admin'
);
