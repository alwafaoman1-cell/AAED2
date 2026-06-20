-- RLS policies for work-order-photos bucket
-- Files are namespaced by tenant_id as the first path segment: <tenant_id>/<order_id>/<photo>.webp
-- Authenticated users can manage photos under their own tenant only.

CREATE POLICY "Tenant users can read work order photos"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'work-order-photos'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

CREATE POLICY "Tenant users can upload work order photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'work-order-photos'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

CREATE POLICY "Tenant users can update work order photos"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'work-order-photos'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);

CREATE POLICY "Tenant users can delete work order photos"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'work-order-photos'
  AND (storage.foldername(name))[1] = public.get_user_tenant_id()::text
);