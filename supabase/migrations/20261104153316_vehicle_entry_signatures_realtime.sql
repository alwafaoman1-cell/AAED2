-- Complete the already-subscribed intake channel. A missing table rejected the
-- entire multi-table subscription. Existing tenant/staff RLS remains unchanged.
-- No signature rows, grants, ownership or historical records are modified.
do $$
begin
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime'
    and schemaname='public' and tablename='vehicle_entry_signatures') then
    alter publication supabase_realtime add table public.vehicle_entry_signatures;
  end if;
end $$;
