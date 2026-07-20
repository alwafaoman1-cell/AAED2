-- Unify insurance claim photos/documents on public.vehicle_media.
-- Non destructive: legacy columns on insurance_claims remain for compatibility,
-- but new application writes should go to vehicle_media only.

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

alter table public.insurance_claims
  add column if not exists documents jsonb default '[]'::jsonb,
  add column if not exists damage_photos text[] default '{}'::text[];

create index if not exists vehicle_media_claim_active_idx
  on public.vehicle_media(tenant_id, claim_id, media_type, category, sort_order, uploaded_at desc)
  where claim_id is not null and deleted_at is null;

create index if not exists vehicle_media_work_order_active_idx
  on public.vehicle_media(tenant_id, work_order_id, media_type, category, sort_order, uploaded_at desc)
  where work_order_id is not null and deleted_at is null;

create or replace function public.touch_vehicle_media_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_touch_vehicle_media on public.vehicle_media;
create trigger trg_touch_vehicle_media
before update on public.vehicle_media
for each row execute function public.touch_vehicle_media_updated_at();

-- Backfill legacy JSON documents from insurance_claims.documents.
insert into public.vehicle_media (
  tenant_id,
  vehicle_id,
  claim_id,
  work_order_id,
  storage_bucket,
  storage_path,
  public_url,
  media_type,
  category,
  file_name,
  mime_type,
  source,
  legacy_source,
  legacy_reference,
  uploaded_at
)
select
  c.tenant_id,
  c.vehicle_id,
  c.id,
  coalesce(c.job_order_id, jo.id),
  coalesce(nullif(doc->>'bucket', ''), 'insurance-docs'),
  coalesce(
    nullif(doc->>'storage_path', ''),
    nullif(doc->>'file_path', ''),
    nullif(doc->>'path', ''),
    nullif(doc->>'url', '')
  ) as storage_path,
  nullif(doc->>'url', ''),
  'document',
  coalesce(nullif(doc->>'type', ''), nullif(doc->>'category', ''), 'other'),
  coalesce(nullif(doc->>'name', ''), nullif(doc->>'file_name', ''), 'legacy-document'),
  nullif(doc->>'mime_type', ''),
  'legacy_claim_documents',
  'insurance_claims.documents',
  doc::text,
  coalesce(c.updated_at, c.created_at, now())
from public.insurance_claims c
left join public.job_orders jo
  on jo.tenant_id = c.tenant_id
 and (jo.id = c.job_order_id or jo.claim_id = c.id)
cross join lateral jsonb_array_elements(
  case
    when jsonb_typeof(coalesce(c.documents, '[]'::jsonb)) = 'array' then coalesce(c.documents, '[]'::jsonb)
    else '[]'::jsonb
  end
) doc
where coalesce(
  nullif(doc->>'storage_path', ''),
  nullif(doc->>'file_path', ''),
  nullif(doc->>'path', ''),
  nullif(doc->>'url', '')
) is not null
on conflict (tenant_id, storage_bucket, storage_path) do nothing;

-- Backfill legacy claim photo arrays that may exist on older deployments.
insert into public.vehicle_media (
  tenant_id,
  vehicle_id,
  claim_id,
  work_order_id,
  storage_bucket,
  storage_path,
  public_url,
  media_type,
  category,
  file_name,
  source,
  legacy_source,
  legacy_reference,
  uploaded_at
)
select
  c.tenant_id,
  c.vehicle_id,
  c.id,
  coalesce(c.job_order_id, jo.id),
  'insurance-docs',
  photo_url,
  case when photo_url ~* '^https?://' then photo_url else null end,
  'image',
  'damage_photo',
  coalesce(split_part(photo_url, '/', array_length(string_to_array(photo_url, '/'), 1)), 'legacy-photo'),
  'legacy_claim_damage_photos',
  'insurance_claims.damage_photos',
  photo_url,
  coalesce(c.updated_at, c.created_at, now())
from public.insurance_claims c
left join public.job_orders jo
  on jo.tenant_id = c.tenant_id
 and (jo.id = c.job_order_id or jo.claim_id = c.id)
cross join lateral unnest(coalesce(c.damage_photos, '{}'::text[])) as photo_url
where coalesce(photo_url, '') <> ''
on conflict (tenant_id, storage_bucket, storage_path) do nothing;

-- Backfill generated claim documents from claim_audit_logs.
insert into public.vehicle_media (
  tenant_id,
  vehicle_id,
  claim_id,
  work_order_id,
  storage_bucket,
  storage_path,
  public_url,
  media_type,
  category,
  file_name,
  mime_type,
  source,
  legacy_source,
  legacy_reference,
  uploaded_by,
  uploaded_at
)
select
  a.tenant_id,
  c.vehicle_id,
  a.claim_id,
  coalesce(c.job_order_id, jo.id),
  'insurance-docs',
  a.file_path,
  nullif(a.details->>'url', ''),
  'document',
  coalesce(nullif(a.category, ''), 'claim_summary'),
  coalesce(nullif(a.details->>'file_name', ''), split_part(a.file_path, '/', array_length(string_to_array(a.file_path, '/'), 1))),
  nullif(a.details->>'mime_type', ''),
  'legacy_generated_documents',
  'claim_audit_logs.document_generated',
  a.id::text,
  a.user_id,
  coalesce(a.created_at, now())
from public.claim_audit_logs a
join public.insurance_claims c on c.id = a.claim_id and c.tenant_id = a.tenant_id
left join public.job_orders jo
  on jo.tenant_id = c.tenant_id
 and (jo.id = c.job_order_id or jo.claim_id = c.id)
where a.action = 'document_generated'
  and coalesce(a.file_path, '') <> ''
on conflict (tenant_id, storage_bucket, storage_path) do nothing;

-- Ensure previously backfilled legacy photos have useful file names/source flags.
update public.vehicle_media
set
  file_name = coalesce(file_name, split_part(storage_path, '/', array_length(string_to_array(storage_path, '/'), 1)), 'media'),
  legacy_source = coalesce(legacy_source, source)
where file_name is null;

comment on column public.insurance_claims.documents is
  'DEPRECATED for operational writes. Use public.vehicle_media for claim documents.';
comment on column public.insurance_claims.damage_photos is
  'DEPRECATED for operational writes. Use public.vehicle_media for claim images.';
