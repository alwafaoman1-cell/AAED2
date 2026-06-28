-- Non-destructive storage bootstrap for work order reception/stage images.
-- Creates the bucket if it is missing; keeps existing files and policies intact.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'work-order-photos',
  'work-order-photos',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
on conflict (id) do update
set
  public = false,
  file_size_limit = coalesce(storage.buckets.file_size_limit, excluded.file_size_limit),
  allowed_mime_types = coalesce(storage.buckets.allowed_mime_types, excluded.allowed_mime_types);
