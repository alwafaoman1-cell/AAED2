alter table public.job_orders
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.customers
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.vehicles
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid;

alter table public.expenses
  add column if not exists deleted_by uuid;

alter table public.sales_documents
  add column if not exists deleted_by uuid;

create index if not exists idx_job_orders_tenant_not_deleted
  on public.job_orders (tenant_id, created_at desc)
  where deleted_at is null and archived_at is null;

create index if not exists idx_customers_tenant_not_deleted
  on public.customers (tenant_id, created_at desc)
  where deleted_at is null and (archived is false or archived is null);
