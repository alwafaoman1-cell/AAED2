DROP POLICY IF EXISTS "invoices-pdf tenant insert" ON storage.objects;
CREATE POLICY "invoices-pdf tenant insert" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoices-pdf'
  AND get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role])
  AND (storage.foldername(name))[1] = (get_user_tenant_id())::text
);