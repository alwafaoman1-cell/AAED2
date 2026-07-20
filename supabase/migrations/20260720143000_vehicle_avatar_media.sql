-- Vehicle avatar support on the unified vehicle_media source.
-- Non destructive: no storage files or vehicle records are deleted.

alter table public.vehicle_media
  add column if not exists file_name text,
  add column if not exists mime_type text,
  add column if not exists file_size bigint,
  add column if not exists description text,
  add column if not exists sort_order integer not null default 0,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists deleted_at timestamptz,
  add column if not exists legacy_source text,
  add column if not exists legacy_reference text;

create index if not exists vehicle_media_avatar_lookup_idx
  on public.vehicle_media(tenant_id, vehicle_id, uploaded_at desc)
  where vehicle_id is not null
    and media_type = 'image'
    and category = 'vehicle_avatar'
    and deleted_at is null;

-- Enforce one active avatar per vehicle after this migration.
create unique index if not exists vehicle_media_one_active_avatar_idx
  on public.vehicle_media(tenant_id, vehicle_id)
  where vehicle_id is not null
    and media_type = 'image'
    and category = 'vehicle_avatar'
    and deleted_at is null;

comment on index public.vehicle_media_one_active_avatar_idx is
  'Ensures one active vehicle avatar per tenant vehicle. Previous avatars are soft-deleted.';
