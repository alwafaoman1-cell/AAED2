-- Non-destructive support for unified payments, insurance company employees,
-- and work-order wizard metadata.
-- Adds nullable columns/tables/indexes only; no data deletion or destructive constraints.

create table if not exists public.insurance_company_employees (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  insurance_company_id uuid not null references public.insurance_companies(id) on delete cascade,
  name text not null,
  title text,
  email text,
  phone text,
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.insurance_company_employees enable row level security;

create index if not exists idx_insurance_company_employees_tenant_company
  on public.insurance_company_employees (tenant_id, insurance_company_id, is_active);

create index if not exists idx_insurance_company_employees_email
  on public.insurance_company_employees (tenant_id, lower(email))
  where email is not null and email <> '';

alter table public.insurance_claims
  add column if not exists insurance_employee_id uuid references public.insurance_company_employees(id) on delete set null;

create index if not exists idx_insurance_claims_employee
  on public.insurance_claims (tenant_id, insurance_employee_id)
  where insurance_employee_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'insurance_company_employees'
      and policyname = 'insurance_company_employees_select_tenant'
  ) then
    create policy insurance_company_employees_select_tenant
      on public.insurance_company_employees
      for select
      using (tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'insurance_company_employees'
      and policyname = 'insurance_company_employees_insert_tenant'
  ) then
    create policy insurance_company_employees_insert_tenant
      on public.insurance_company_employees
      for insert
      with check (tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'insurance_company_employees'
      and policyname = 'insurance_company_employees_update_tenant'
  ) then
    create policy insurance_company_employees_update_tenant
      on public.insurance_company_employees
      for update
      using (tenant_id = public.get_user_tenant_id())
      with check (tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'insurance_company_employees'
      and policyname = 'insurance_company_employees_delete_tenant'
  ) then
    create policy insurance_company_employees_delete_tenant
      on public.insurance_company_employees
      for delete
      using (tenant_id = public.get_user_tenant_id());
  end if;
end $$;
