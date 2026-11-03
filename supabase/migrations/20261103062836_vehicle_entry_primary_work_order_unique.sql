-- A visit can have one active primary work order. Supplementary child orders
-- remain possible; no historical rows are changed or reclassified.
create unique index uq_job_orders_one_primary_vehicle_entry_per_tenant
  on public.job_orders (tenant_id, vehicle_entry_id)
  where vehicle_entry_id is not null
    and deleted_at is null
    and parent_work_order_id is null;
