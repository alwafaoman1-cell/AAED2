-- Covers the four-column FK check when a device-person mapping is updated.
create index if not exists hr_attendance_punches_mapping_fk_idx
  on public.hr_attendance_punches (tenant_id, device_key, person_id, employee_id);
