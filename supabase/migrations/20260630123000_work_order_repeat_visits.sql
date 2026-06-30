alter table public.job_orders
  add column if not exists parent_work_order_id uuid references public.job_orders(id) on delete set null,
  add column if not exists visit_number integer,
  add column if not exists visit_type text,
  add column if not exists return_reason text;

create index if not exists idx_job_orders_parent_work_order_id
  on public.job_orders(parent_work_order_id)
  where parent_work_order_id is not null;

create index if not exists idx_job_orders_vehicle_visit
  on public.job_orders(tenant_id, vehicle_id, visit_number)
  where vehicle_id is not null;

