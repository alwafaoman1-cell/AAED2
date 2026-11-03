-- Cover the tenant FK without duplicating the unique vehicle_entry_id lookup.
create index if not exists vehicle_technical_declarations_tenant_idx
  on public.vehicle_technical_declarations (tenant_id);
