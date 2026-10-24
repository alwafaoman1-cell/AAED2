-- Keep new HR uploads outside the tenant_settings JSON document. Existing
-- base64 documents remain readable there; this migration never rewrites them.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hr-documents', 'hr-documents', false, 10485760,
  array[
    'application/pdf', 'image/jpeg', 'image/png', 'image/webp',
    'image/heic', 'image/heif', 'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ]
)
on conflict (id) do nothing;

create policy hr_documents_read on storage.objects for select to authenticated
using (
  bucket_id = 'hr-documents'
  and (storage.foldername(name))[1] = (select public.get_user_tenant_id())::text
  and (
    (select public.has_role((select auth.uid()), 'admin'::public.app_role))
    or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
  )
);

create policy hr_documents_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'hr-documents'
  and (storage.foldername(name))[1] = (select public.get_user_tenant_id())::text
  and (
    (select public.has_role((select auth.uid()), 'admin'::public.app_role))
    or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
  )
);

-- Used only to remove a newly uploaded object when its HR metadata save fails.
create policy hr_documents_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'hr-documents'
  and (storage.foldername(name))[1] = (select public.get_user_tenant_id())::text
  and (
    (select public.has_role((select auth.uid()), 'admin'::public.app_role))
    or (select public.has_role((select auth.uid()), 'manager'::public.app_role))
  )
);
