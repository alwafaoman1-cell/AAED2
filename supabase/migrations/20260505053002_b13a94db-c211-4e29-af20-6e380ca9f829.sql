
-- 1) Prevent privilege escalation on profiles
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile own fields"
ON public.profiles
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (
  user_id = auth.uid()
  AND role = (SELECT p.role FROM public.profiles p WHERE p.user_id = auth.uid())
  AND tenant_id = (SELECT p.tenant_id FROM public.profiles p WHERE p.user_id = auth.uid())
);

-- 2) Make sensitive buckets private
UPDATE storage.buckets SET public = false WHERE id IN ('insurance-docs','damage-photos');

-- 3) Storage policies — insurance-docs
DROP POLICY IF EXISTS "Public read insurance docs" ON storage.objects;
DROP POLICY IF EXISTS "Public read insurance-docs" ON storage.objects;
DROP POLICY IF EXISTS "Auth update insurance-docs scoped" ON storage.objects;
DROP POLICY IF EXISTS "Auth delete insurance-docs scoped" ON storage.objects;
DROP POLICY IF EXISTS "Auth upload insurance-docs scoped" ON storage.objects;
DROP POLICY IF EXISTS "Staff delete insurance docs" ON storage.objects;
DROP POLICY IF EXISTS "Staff update insurance docs" ON storage.objects;
DROP POLICY IF EXISTS "Staff upload insurance docs" ON storage.objects;

-- helper: tenant scoping for path tenant_id/... or claims/<claim_id>/...
CREATE POLICY "insurance-docs tenant read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'insurance-docs'
  AND (
    (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
    OR (
      (storage.foldername(name))[1] = 'claims'
      AND EXISTS (
        SELECT 1 FROM public.insurance_claims c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND c.tenant_id = public.get_user_tenant_id()
      )
    )
  )
);

CREATE POLICY "insurance-docs tenant insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'insurance-docs'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'technician'::app_role,'insurance'::app_role])
  AND (
    (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
    OR (
      (storage.foldername(name))[1] = 'claims'
      AND EXISTS (
        SELECT 1 FROM public.insurance_claims c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND c.tenant_id = public.get_user_tenant_id()
      )
    )
  )
);

CREATE POLICY "insurance-docs tenant update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'insurance-docs'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  AND (
    (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
    OR (
      (storage.foldername(name))[1] = 'claims'
      AND EXISTS (
        SELECT 1 FROM public.insurance_claims c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND c.tenant_id = public.get_user_tenant_id()
      )
    )
  )
);

CREATE POLICY "insurance-docs tenant delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'insurance-docs'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  AND (
    (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
    OR (
      (storage.foldername(name))[1] = 'claims'
      AND EXISTS (
        SELECT 1 FROM public.insurance_claims c
        WHERE c.id::text = (storage.foldername(name))[2]
          AND c.tenant_id = public.get_user_tenant_id()
      )
    )
  )
);

-- 4) damage-photos: private + tenant scoped (path: tenant_id/...)
DROP POLICY IF EXISTS "Public view damage photos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload damage photos" ON storage.objects;

CREATE POLICY "damage-photos tenant read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'damage-photos'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);
CREATE POLICY "damage-photos tenant insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'damage-photos'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'technician'::app_role,'insurance'::app_role])
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);
CREATE POLICY "damage-photos tenant update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'damage-photos'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'technician'::app_role])
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);
CREATE POLICY "damage-photos tenant delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'damage-photos'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);

-- 5) invoices-pdf: tenant scoped read/write (path: tenant_id/...)
DROP POLICY IF EXISTS "Authenticated view invoices" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated upload invoices" ON storage.objects;

CREATE POLICY "invoices-pdf tenant read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'invoices-pdf'
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);
CREATE POLICY "invoices-pdf tenant insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'invoices-pdf'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'insurance'::app_role])
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);
CREATE POLICY "invoices-pdf tenant update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'invoices-pdf'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);
CREATE POLICY "invoices-pdf tenant delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'invoices-pdf'
  AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role])
  AND (storage.foldername(name))[1] = (public.get_user_tenant_id())::text
);

-- 6) job_order_parts: add UPDATE / DELETE policies (admin + manager)
CREATE POLICY "Staff update parts"
ON public.job_order_parts FOR UPDATE TO authenticated
USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role,'technician'::app_role]));

CREATE POLICY "Admin delete parts"
ON public.job_order_parts FOR DELETE TO authenticated
USING (tenant_id = public.get_user_tenant_id() AND public.get_user_role() = ANY (ARRAY['admin'::app_role,'manager'::app_role]));
