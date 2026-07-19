-- Separate registered vehicle owner from the operational work-order customer.
-- Non-destructive: adds nullable metadata columns only.

alter table public.job_orders
  add column if not exists vehicle_owner_customer_id uuid null references public.customers(id) on delete set null,
  add column if not exists received_from_customer_id uuid null references public.customers(id) on delete set null,
  add column if not exists customer_relationship_to_vehicle text null,
  add column if not exists customer_relationship_note text null;

create index if not exists idx_job_orders_vehicle_owner_customer
  on public.job_orders(tenant_id, vehicle_owner_customer_id)
  where vehicle_owner_customer_id is not null;

create index if not exists idx_job_orders_received_from_customer
  on public.job_orders(tenant_id, received_from_customer_id)
  where received_from_customer_id is not null;

