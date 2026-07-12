-- Unified estimate conversion workflow support.
-- Non destructive: adds optional source links and an audit table only.

alter table public.job_orders
  add column if not exists source_estimate_id uuid references public.estimates(id) on delete set null;

alter table public.insurance_claims
  add column if not exists source_estimate_id uuid references public.estimates(id) on delete set null;

create table if not exists public.estimate_conversion_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  conversion_type text not null
    check (conversion_type in ('independent_to_work_order','insurance_to_claim','insurance_to_work_order','supplementary_link')),
  target_entity_type text not null
    check (target_entity_type in ('work_order','insurance_claim','estimate')),
  target_entity_id uuid null,
  converted_by uuid null,
  converted_at timestamptz not null default now(),
  existing_record_used boolean not null default false,
  notes text null,
  created_at timestamptz not null default now()
);

create index if not exists idx_job_orders_source_estimate_id
  on public.job_orders(source_estimate_id)
  where source_estimate_id is not null;

create unique index if not exists idx_job_orders_tenant_source_estimate_id_active
  on public.job_orders(tenant_id, source_estimate_id)
  where source_estimate_id is not null and deleted_at is null;

create index if not exists idx_insurance_claims_source_estimate_id
  on public.insurance_claims(source_estimate_id)
  where source_estimate_id is not null;

create unique index if not exists idx_insurance_claims_tenant_source_estimate_id
  on public.insurance_claims(tenant_id, source_estimate_id)
  where source_estimate_id is not null;

create index if not exists idx_estimate_conversion_audit_estimate
  on public.estimate_conversion_audit(tenant_id, estimate_id, created_at desc);

create index if not exists idx_estimate_conversion_audit_target
  on public.estimate_conversion_audit(tenant_id, target_entity_type, target_entity_id)
  where target_entity_id is not null;

alter table public.estimate_conversion_audit enable row level security;

drop policy if exists "Staff read estimate conversion audit" on public.estimate_conversion_audit;
create policy "Staff read estimate conversion audit"
on public.estimate_conversion_audit for select to authenticated
using (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role])
);

drop policy if exists "Staff insert estimate conversion audit" on public.estimate_conversion_audit;
create policy "Staff insert estimate conversion audit"
on public.estimate_conversion_audit for insert to authenticated
with check (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role])
);
