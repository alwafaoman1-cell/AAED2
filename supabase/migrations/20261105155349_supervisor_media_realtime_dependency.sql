-- Complete the existing tenant-filtered subscription, without changing rows,
-- grants, RLS or replica identity. Missing media publication must not degrade
-- the Supervisor's shared image readers into an assumed live subscription.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $guard$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
    raise exception 'EXPECTED_REALTIME_PUBLICATION_REQUIRED';
  end if;
  if not exists(select 1 from pg_class where oid='public.vehicle_media'::regclass and relrowsecurity)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='vehicle_media' and column_name='tenant_id') then
    raise exception 'TENANT_MEDIA_RLS_REQUIRED';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='vehicle_media') then
    alter publication supabase_realtime add table public.vehicle_media;
  end if;
end $guard$;
