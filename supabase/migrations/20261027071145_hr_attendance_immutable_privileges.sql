-- Supabase default privileges can grant UPDATE/DELETE to authenticated.
-- RLS already blocks those operations, but also remove table privileges so
-- later broad policy additions cannot mutate the original device evidence.
revoke update, delete on public.hr_attendance_punches from authenticated;
revoke delete on public.hr_attendance_device_people from authenticated;
