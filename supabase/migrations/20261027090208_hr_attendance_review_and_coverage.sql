-- Manager-reviewed attendance is separate from the immutable SmartPSS ledger.
-- Both relations are append-only; the newest review is effective and prior
-- decisions remain available for audit. No existing rows are rewritten.
create table public.hr_attendance_month_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null,
  month date not null check (extract(day from month) = 1),
  coverage_start date not null,
  coverage_end date not null,
  grace_minutes integer not null default 0 check (grace_minutes between 0 and 60),
  reason text not null check (length(btrim(reason)) between 8 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  constraint hr_attendance_month_review_dates check (
    coverage_start <= coverage_end
    and date_trunc('month', coverage_start)::date = month
    and date_trunc('month', coverage_end)::date = month
  )
);

create index hr_attendance_month_reviews_latest_idx
  on public.hr_attendance_month_reviews (tenant_id, employee_id, month, created_at desc, id desc);

create table public.hr_attendance_day_reviews (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  employee_id uuid not null,
  attendance_date date not null,
  morning_status text not null check (morning_status in ('present','absent','incomplete','excused')),
  afternoon_status text not null check (afternoon_status in ('present','absent','incomplete','excused')),
  morning_in time,
  morning_out time,
  afternoon_in time,
  afternoon_out time,
  reason text not null check (length(btrim(reason)) between 8 and 1000),
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  constraint hr_attendance_day_review_times check (
    (morning_status <> 'present' or (morning_in is not null and morning_out is not null and morning_out > morning_in))
    and (afternoon_status <> 'present' or (afternoon_in is not null and afternoon_out is not null and afternoon_out > afternoon_in))
    and (morning_status = 'present' or (morning_in is null and morning_out is null))
    and (afternoon_status = 'present' or (afternoon_in is null and afternoon_out is null))
  )
);

create index hr_attendance_day_reviews_latest_idx
  on public.hr_attendance_day_reviews (tenant_id, employee_id, attendance_date, created_at desc, id desc);

alter table public.hr_attendance_month_reviews enable row level security;
alter table public.hr_attendance_day_reviews enable row level security;

create policy hr_attendance_month_reviews_read on public.hr_attendance_month_reviews
  for select to authenticated using (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );
create policy hr_attendance_month_reviews_insert on public.hr_attendance_month_reviews
  for insert to authenticated with check (
    tenant_id = (select public.get_user_tenant_id())
    and created_by = (select auth.uid())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
    and exists (
      select 1 from public.tenant_settings setting
      cross join lateral jsonb_array_elements(coalesce(setting.value->'employees', '[]'::jsonb)) employee
      where setting.tenant_id = hr_attendance_month_reviews.tenant_id
        and setting.key = 'alwafa_hr_v1'
        and employee->>'id' = hr_attendance_month_reviews.employee_id::text
        and coalesce(employee->>'isDeleted', 'false') <> 'true'
    )
  );
create policy hr_attendance_day_reviews_read on public.hr_attendance_day_reviews
  for select to authenticated using (
    tenant_id = (select public.get_user_tenant_id())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
  );
create policy hr_attendance_day_reviews_insert on public.hr_attendance_day_reviews
  for insert to authenticated with check (
    tenant_id = (select public.get_user_tenant_id())
    and created_by = (select auth.uid())
    and ((select public.has_role((select auth.uid()), 'admin'::public.app_role))
      or (select public.has_role((select auth.uid()), 'manager'::public.app_role)))
    and exists (
      select 1 from public.tenant_settings setting
      cross join lateral jsonb_array_elements(coalesce(setting.value->'employees', '[]'::jsonb)) employee
      where setting.tenant_id = hr_attendance_day_reviews.tenant_id
        and setting.key = 'alwafa_hr_v1'
        and employee->>'id' = hr_attendance_day_reviews.employee_id::text
        and coalesce(employee->>'isDeleted', 'false') <> 'true'
    )
  );

revoke all on public.hr_attendance_month_reviews, public.hr_attendance_day_reviews from anon, authenticated;
grant select, insert on public.hr_attendance_month_reviews, public.hr_attendance_day_reviews to authenticated;
