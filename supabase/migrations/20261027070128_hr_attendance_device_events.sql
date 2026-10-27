-- Immutable, non-biometric SmartPSS punch ledger. HR employee records currently
-- live in tenant_settings JSON, so employee_id is an application reference,
-- not an unsafe FK to an unrelated table. No historical rows are modified.
create table if not exists public.hr_attendance_device_people (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  device_key text not null check (length(device_key) between 1 and 120),
  person_id text not null check (length(person_id) between 1 and 80),
  employee_id uuid not null,
  created_at timestamptz not null default now(),
  created_by uuid default auth.uid(),
  unique (tenant_id, device_key, person_id)
);

create table if not exists public.hr_attendance_punches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  device_key text not null check (length(device_key) between 1 and 120),
  person_id text not null check (length(person_id) between 1 and 80),
  employee_id uuid not null,
  occurred_at timestamptz not null,
  event_code smallint not null check (event_code between 0 and 4),
  source text not null check (source in ('smartpss_xlsx', 'device_bridge')),
  imported_at timestamptz not null default now(),
  imported_by uuid default auth.uid(),
  unique (tenant_id, device_key, person_id, occurred_at, event_code)
);

create index if not exists hr_attendance_punches_employee_month_idx
  on public.hr_attendance_punches (tenant_id, employee_id, occurred_at desc);

alter table public.hr_attendance_device_people enable row level security;
alter table public.hr_attendance_punches enable row level security;

create policy hr_attendance_device_people_read on public.hr_attendance_device_people
  for select to authenticated using (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );
create policy hr_attendance_device_people_write on public.hr_attendance_device_people
  for insert to authenticated with check (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );
create policy hr_attendance_device_people_update on public.hr_attendance_device_people
  for update to authenticated using (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  ) with check (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );
create policy hr_attendance_punches_read on public.hr_attendance_punches
  for select to authenticated using (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );
create policy hr_attendance_punches_insert on public.hr_attendance_punches
  for insert to authenticated with check (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );

-- No update/delete policies for raw punches. Even a corrected employee mapping
-- leaves the original evidence intact; any re-assignment needs an audited flow.
revoke all on public.hr_attendance_device_people, public.hr_attendance_punches from anon;
grant select, insert, update on public.hr_attendance_device_people to authenticated;
grant select, insert on public.hr_attendance_punches to authenticated;
