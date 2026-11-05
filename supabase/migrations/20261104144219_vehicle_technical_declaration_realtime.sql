-- Publish the existing canonical declaration, not a duplicate intake snapshot.
-- RLS and column grants are unchanged; no row updates or backfill.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='vehicle_technical_declarations') then
    alter publication supabase_realtime add table public.vehicle_technical_declarations;
  end if;
end $$;
