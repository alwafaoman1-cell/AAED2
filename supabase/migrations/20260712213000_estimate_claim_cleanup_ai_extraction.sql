-- Estimate/claim cleanup support.
-- Non destructive: adds compatibility columns and AI extraction audit table only.

alter table public.estimates
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists estimate_date date,
  add column if not exists legacy_source text,
  add column if not exists legacy_id text,
  add column if not exists legacy_number text,
  add column if not exists claim_id uuid,
  add column if not exists work_order_id uuid;

alter table public.insurance_claims
  add column if not exists estimate_date date,
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists vehicle_presence_status text;

alter table public.job_orders
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists vehicle_presence_status text;

create table if not exists public.ai_extraction_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid,
  file_name text,
  file_type text,
  document_type text,
  provider text,
  processing_status text not null default 'created',
  extracted_fields_count integer not null default 0,
  applied_fields_count integer not null default 0,
  failed_reason text,
  created_at timestamptz not null default now()
);

alter table public.ai_extraction_logs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_extraction_logs'
      and policyname = 'Tenant users can read ai extraction logs'
  ) then
    create policy "Tenant users can read ai extraction logs"
      on public.ai_extraction_logs
      for select
      using (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'ai_extraction_logs'
      and policyname = 'Tenant users can insert ai extraction logs'
  ) then
    create policy "Tenant users can insert ai extraction logs"
      on public.ai_extraction_logs
      for insert
      with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

create index if not exists idx_ai_extraction_logs_tenant_created
  on public.ai_extraction_logs(tenant_id, created_at desc);
