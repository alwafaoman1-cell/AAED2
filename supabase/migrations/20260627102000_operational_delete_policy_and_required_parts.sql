alter table public.expenses
  add column if not exists deleted_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.sales_documents
  add column if not exists deleted_at timestamptz,
  add column if not exists archived_at timestamptz;

alter table public.customers
  add column if not exists archived boolean not null default false,
  add column if not exists archived_at timestamptz,
  add column if not exists archived_reason text;

create table if not exists public.operational_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text not null,
  related_entities jsonb not null default '{}'::jsonb,
  reason text,
  delete_mode text,
  before_snapshot jsonb,
  after_snapshot jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_operational_audit_log_tenant_created
  on public.operational_audit_log (tenant_id, created_at desc);

alter table public.operational_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_audit_log'
      and policyname = 'tenant read operational audit'
  ) then
    create policy "tenant read operational audit"
    on public.operational_audit_log
    for select to authenticated
    using (tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'operational_audit_log'
      and policyname = 'tenant insert operational audit'
  ) then
    create policy "tenant insert operational audit"
    on public.operational_audit_log
    for insert to authenticated
    with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;
