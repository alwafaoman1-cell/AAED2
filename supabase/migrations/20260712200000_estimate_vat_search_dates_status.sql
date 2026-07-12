-- Estimate creation refinements: optional VAT, unified dates, legacy references,
-- and vehicle presence fields. Non destructive.

alter table public.estimates
  add column if not exists vat_enabled boolean not null default false,
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists vehicle_presence_status text not null default 'with_customer'
    check (vehicle_presence_status in ('in_workshop','with_customer','at_insurer','at_copart','external_vendor')),
  add column if not exists vehicle_location_section text,
  add column if not exists vehicle_location_bay text,
  add column if not exists vehicle_location_note text,
  add column if not exists legacy_source text,
  add column if not exists legacy_id text,
  add column if not exists legacy_number text;

-- Preserve previous estimates that already had VAT calculated before this setting existed.
update public.estimates
set vat_enabled = true
where coalesce(vat_amount, 0) > 0
  and vat_enabled = false;

alter table public.insurance_claims
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists vehicle_presence_status text not null default 'with_customer'
    check (vehicle_presence_status in ('in_workshop','with_customer','at_insurer','at_copart','external_vendor'));

alter table public.job_orders
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists vehicle_presence_status text not null default 'with_customer'
    check (vehicle_presence_status in ('in_workshop','with_customer','at_insurer','at_copart','external_vendor'));

create unique index if not exists idx_estimates_legacy_source_id
  on public.estimates(tenant_id, legacy_source, legacy_id)
  where legacy_source is not null and legacy_id is not null;

create index if not exists idx_estimates_vehicle_presence
  on public.estimates(tenant_id, vehicle_presence_status);

create index if not exists idx_estimates_legacy_number
  on public.estimates(tenant_id, legacy_number)
  where legacy_number is not null;
