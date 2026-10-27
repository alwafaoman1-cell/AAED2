-- Enforce that imported punches belong to the reviewed device-person mapping.
-- A mapping with punch history cannot be silently changed or deleted.
alter table public.hr_attendance_device_people
  add constraint hr_attendance_device_people_identity_unique
  unique (tenant_id, device_key, person_id, employee_id);

alter table public.hr_attendance_punches
  add constraint hr_attendance_punches_mapping_fk
  foreign key (tenant_id, device_key, person_id, employee_id)
  references public.hr_attendance_device_people (tenant_id, device_key, person_id, employee_id)
  on update restrict on delete restrict;

alter policy hr_attendance_device_people_write on public.hr_attendance_device_people
  with check (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
    and exists (
      select 1 from public.tenant_settings setting
      cross join lateral jsonb_array_elements(coalesce(setting.value->'employees', '[]'::jsonb)) employee
      where setting.tenant_id = hr_attendance_device_people.tenant_id
        and setting.key = 'alwafa_hr_v1'
        and employee->>'id' = hr_attendance_device_people.employee_id::text
        and coalesce(employee->>'isDeleted', 'false') <> 'true'
    )
  );

alter policy hr_attendance_device_people_update on public.hr_attendance_device_people
  with check (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
    and exists (
      select 1 from public.tenant_settings setting
      cross join lateral jsonb_array_elements(coalesce(setting.value->'employees', '[]'::jsonb)) employee
      where setting.tenant_id = hr_attendance_device_people.tenant_id
        and setting.key = 'alwafa_hr_v1'
        and employee->>'id' = hr_attendance_device_people.employee_id::text
        and coalesce(employee->>'isDeleted', 'false') <> 'true'
    )
  );
