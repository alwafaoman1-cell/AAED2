-- Duplicate checks must never materialize or alter older visits merely
-- because a user attempted to create a new entry.
create or replace function public.vehicle_visit_entry_duplicate_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.deleted_at is not null or new.vehicle_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.vehicle_id::text, 0));
  if exists (
    select 1 from public.vehicle_entries other
    where other.tenant_id = new.tenant_id and other.vehicle_id = new.vehicle_id
      and other.deleted_at is null and other.id <> new.id
      and (
        (other.vehicle_location = 'داخل الورشة'
          and public.vehicle_visit_evidence_stage(other.id) <> 'delivered')
        or (public.vehicle_visit_evidence_stage(other.id) not in ('delivered','cancelled')
          and not exists (select 1 from public.vehicle_visit_workflows wf
            where wf.entry_id = other.id and wf.stage in ('delivered','cancelled')))
      )
  ) then raise exception 'VEHICLE_VISIT_ALREADY_OPEN'; end if;
  return new;
end;
$$;
