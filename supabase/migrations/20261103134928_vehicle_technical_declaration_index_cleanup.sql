-- vehicle_entry_id already has a unique index. The extra composite index
-- duplicates that lookup and is unnecessary for this one-document-per-entry table.
drop index if exists public.vehicle_technical_declarations_tenant_entry_idx;
