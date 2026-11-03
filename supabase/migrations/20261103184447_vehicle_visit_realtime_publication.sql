-- Publish the three existing custody sources so all devices invalidate the
-- same visit projection. No rows, stages, or historical timestamps are changed.
do $$
declare
  source_table text;
begin
  foreach source_table in array array[
    'vehicle_entries', 'vehicle_handover_records', 'vehicle_inspection_releases'
  ] loop
    if not exists (
      select 1 from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = source_table and c.relrowsecurity
    ) then
      raise exception 'RLS must be enabled before publishing public.%', source_table;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = source_table
    ) then
      execute format('alter publication supabase_realtime add table public.%I', source_table);
    end if;
  end loop;
end $$;
