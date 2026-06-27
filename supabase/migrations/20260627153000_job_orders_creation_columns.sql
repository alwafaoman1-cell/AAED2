alter table public.job_orders
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists reception_damage_markers jsonb not null default '[]'::jsonb,
  add column if not exists reception_signature_data_url text,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

create index if not exists idx_job_orders_tenant_active_created
  on public.job_orders (tenant_id, created_at desc)
  where deleted_at is null and archived_at is null;
