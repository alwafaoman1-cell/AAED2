-- Unified operational file for linked insurance claims and work orders.
-- Non-destructive: keeps legacy columns, backfills shared records, and lets
-- both UIs read/write one operational source going forward.

alter table public.insurance_claims
  add column if not exists vehicle_presence_status text,
  add column if not exists vehicle_location_section text,
  add column if not exists vehicle_location_bay text,
  add column if not exists vehicle_location_note text,
  add column if not exists vehicle_location_updated_at timestamptz,
  add column if not exists vehicle_location_updated_by uuid,
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists repair_started_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists work_completed_at timestamptz,
  add column if not exists repair_stage text,
  add column if not exists delivery_photos text[] default '{}'::text[],
  add column if not exists satisfaction_photos text[] default '{}'::text[],
  add column if not exists damage_photos text[] default '{}'::text[],
  add column if not exists needed_parts jsonb default '[]'::jsonb;

alter table public.job_orders
  add column if not exists claim_id uuid,
  add column if not exists vehicle_presence_status text,
  add column if not exists vehicle_location_section text,
  add column if not exists vehicle_location_bay text,
  add column if not exists vehicle_location_note text,
  add column if not exists vehicle_received_at timestamptz,
  add column if not exists vehicle_delivered_at timestamptz,
  add column if not exists work_started_at timestamptz,
  add column if not exists work_completed_at timestamptz,
  add column if not exists received_at timestamptz,
  add column if not exists parts_needed jsonb default '[]'::jsonb,
  add column if not exists photos jsonb default '[]'::jsonb;

create table if not exists public.claim_work_order_operations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  claim_id uuid null references public.insurance_claims(id) on delete cascade,
  work_order_id uuid null references public.job_orders(id) on delete set null,
  vehicle_id uuid null references public.vehicles(id) on delete set null,
  customer_id uuid null references public.customers(id) on delete set null,
  vehicle_presence_status text null,
  vehicle_location_section text null,
  vehicle_location_bay text null,
  vehicle_location_note text null,
  vehicle_location_updated_at timestamptz null,
  vehicle_location_updated_by uuid null,
  repair_stage text null,
  operational_status text null,
  vehicle_received_at timestamptz null,
  work_started_at timestamptz null,
  work_completed_at timestamptz null,
  vehicle_delivered_at timestamptz null,
  insurance_approval_status text null,
  invoice_status text null,
  payment_status text null,
  operational_notes text null,
  parts_required jsonb not null default '[]'::jsonb,
  estimate_ids uuid[] not null default '{}'::uuid[],
  last_changed_from text null,
  last_changed_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint claim_work_order_operations_has_link
    check (claim_id is not null or work_order_id is not null or vehicle_id is not null)
);

create unique index if not exists claim_work_order_operations_claim_uidx
  on public.claim_work_order_operations(tenant_id, claim_id)
  where claim_id is not null;

create unique index if not exists claim_work_order_operations_work_order_uidx
  on public.claim_work_order_operations(tenant_id, work_order_id)
  where work_order_id is not null;

create index if not exists claim_work_order_operations_vehicle_idx
  on public.claim_work_order_operations(tenant_id, vehicle_id, updated_at desc)
  where vehicle_id is not null;

create table if not exists public.vehicle_media (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  vehicle_id uuid null references public.vehicles(id) on delete set null,
  claim_id uuid null references public.insurance_claims(id) on delete cascade,
  work_order_id uuid null references public.job_orders(id) on delete set null,
  storage_bucket text not null default 'insurance-docs',
  storage_path text not null,
  public_url text null,
  media_type text not null default 'image',
  category text not null default 'general',
  stage text null,
  caption text null,
  source text null,
  uploaded_at timestamptz not null default now(),
  uploaded_by uuid null,
  created_at timestamptz not null default now(),
  constraint vehicle_media_has_link
    check (vehicle_id is not null or claim_id is not null or work_order_id is not null)
);

create unique index if not exists vehicle_media_storage_unique
  on public.vehicle_media(tenant_id, storage_bucket, storage_path);

create index if not exists vehicle_media_claim_idx
  on public.vehicle_media(tenant_id, claim_id, uploaded_at desc)
  where claim_id is not null;

create index if not exists vehicle_media_work_order_idx
  on public.vehicle_media(tenant_id, work_order_id, uploaded_at desc)
  where work_order_id is not null;

create index if not exists vehicle_media_vehicle_idx
  on public.vehicle_media(tenant_id, vehicle_id, uploaded_at desc)
  where vehicle_id is not null;

alter table public.claim_work_order_operations enable row level security;
alter table public.vehicle_media enable row level security;

drop policy if exists "Staff manage unified claim work order operations" on public.claim_work_order_operations;
create policy "Staff manage unified claim work order operations"
on public.claim_work_order_operations
for all
using (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role])
)
with check (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role])
);

drop policy if exists "Staff manage unified vehicle media" on public.vehicle_media;
create policy "Staff manage unified vehicle media"
on public.vehicle_media
for all
using (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role])
)
with check (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role])
);

create or replace function public.touch_unified_operational_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_claim_work_order_operations on public.claim_work_order_operations;
create trigger trg_touch_claim_work_order_operations
before update on public.claim_work_order_operations
for each row execute function public.touch_unified_operational_updated_at();

-- Backfill one unified operation row per current linked claim/work-order file.
insert into public.claim_work_order_operations (
  tenant_id,
  claim_id,
  work_order_id,
  vehicle_id,
  customer_id,
  vehicle_presence_status,
  vehicle_location_section,
  vehicle_location_bay,
  vehicle_location_note,
  vehicle_location_updated_at,
  repair_stage,
  operational_status,
  vehicle_received_at,
  work_started_at,
  work_completed_at,
  vehicle_delivered_at,
  insurance_approval_status,
  invoice_status,
  payment_status,
  operational_notes,
  parts_required,
  last_changed_from
)
select
  c.tenant_id,
  c.id,
  coalesce(c.job_order_id, jo.id),
  coalesce(c.vehicle_id, jo.vehicle_id),
  coalesce(c.customer_id, jo.customer_id),
  coalesce(c.vehicle_presence_status, jo.vehicle_presence_status),
  coalesce(c.vehicle_location_section, jo.vehicle_location_section),
  coalesce(c.vehicle_location_bay, jo.vehicle_location_bay),
  coalesce(c.vehicle_location_note, jo.vehicle_location_note),
  c.vehicle_location_updated_at,
  coalesce(c.repair_stage::text, jo.status::text),
  coalesce(c.status::text, jo.status::text),
  coalesce(c.vehicle_received_at, c.workshop_arrival_date, c.received_at, jo.vehicle_received_at, jo.received_at),
  coalesce(c.work_started_at, c.repair_started_at, jo.work_started_at),
  coalesce(c.work_completed_at, jo.work_completed_at),
  coalesce(c.vehicle_delivered_at, c.delivered_at, jo.vehicle_delivered_at),
  c.status::text,
  case when exists (select 1 from public.insurance_invoices ii where ii.claim_id = c.id and coalesce(ii.status, '') <> 'cancelled') then 'issued' else null end,
  case when c.paid_at is not null then 'paid' else null end,
  c.notes,
  coalesce(to_jsonb(c.needed_parts), '[]'::jsonb),
  'migration_backfill'
from public.insurance_claims c
left join public.job_orders jo on jo.tenant_id = c.tenant_id and (jo.id = c.job_order_id or jo.claim_id = c.id)
where not exists (
  select 1 from public.claim_work_order_operations op
  where op.tenant_id = c.tenant_id and op.claim_id = c.id
);

-- Backfill legacy claim photo arrays into shared vehicle_media.
insert into public.vehicle_media (
  tenant_id, vehicle_id, claim_id, work_order_id, storage_bucket, storage_path, public_url,
  media_type, category, stage, source, uploaded_at
)
select
  c.tenant_id,
  c.vehicle_id,
  c.id,
  coalesce(c.job_order_id, jo.id),
  'insurance-docs',
  photo_url,
  photo_url,
  'image',
  category,
  category,
  'legacy_claim_array',
  coalesce(c.updated_at, c.created_at, now())
from public.insurance_claims c
left join public.job_orders jo on jo.tenant_id = c.tenant_id and (jo.id = c.job_order_id or jo.claim_id = c.id)
cross join lateral (
  select unnest(coalesce(c.damage_photos, '{}'::text[])) as photo_url, 'damage'::text as category
  union all
  select unnest(coalesce(c.satisfaction_photos, '{}'::text[])) as photo_url, 'satisfaction'::text as category
  union all
  select unnest(coalesce(c.delivery_photos, '{}'::text[])) as photo_url, 'delivery'::text as category
) p
where coalesce(photo_url, '') <> ''
on conflict (tenant_id, storage_bucket, storage_path) do nothing;

-- Backfill legacy work-order photos JSONB into shared vehicle_media.
insert into public.vehicle_media (
  tenant_id, vehicle_id, claim_id, work_order_id, storage_bucket, storage_path, public_url,
  media_type, category, stage, caption, source, uploaded_at
)
select
  jo.tenant_id,
  jo.vehicle_id,
  jo.claim_id,
  jo.id,
  coalesce(nullif(photo->>'bucket', ''), 'work-order-photos'),
  coalesce(nullif(photo->>'storagePath', ''), nullif(photo->>'dataUrl', '')),
  nullif(photo->>'dataUrl', ''),
  'image',
  coalesce(nullif(photo->>'phase', ''), 'work_order'),
  nullif(photo->>'phase', ''),
  nullif(photo->>'caption', ''),
  'legacy_work_order_photos',
  coalesce((photo->>'uploadedAt')::timestamptz, jo.updated_at, jo.created_at, now())
from public.job_orders jo
cross join lateral jsonb_array_elements(coalesce(jo.photos, '[]'::jsonb)) photo
where coalesce(nullif(photo->>'storagePath', ''), nullif(photo->>'dataUrl', '')) is not null
on conflict (tenant_id, storage_bucket, storage_path) do nothing;
