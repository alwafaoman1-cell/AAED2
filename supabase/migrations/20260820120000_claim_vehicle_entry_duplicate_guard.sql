-- Prevent concurrent creation of more than one active vehicle-entry receipt per claim.
-- Existing rows are preserved; this guard applies only to new links and link restoration.
create or replace function public.guard_active_vehicle_entry_per_claim()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.insurance_claim_id is null or new.deleted_at is not null then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.insurance_claim_id::text, 0));

  if exists (
    select 1 from public.vehicle_entries existing
    where existing.tenant_id = new.tenant_id
      and existing.insurance_claim_id = new.insurance_claim_id
      and existing.deleted_at is null
      and (new.id is null or existing.id <> new.id)
  ) then
    raise unique_violation using
      message = 'Vehicle entry already exists for this claim',
      constraint = 'vehicle_entries_one_active_per_claim_guard';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_active_vehicle_entry_per_claim on public.vehicle_entries;
create trigger trg_guard_active_vehicle_entry_per_claim
before insert or update of tenant_id, insurance_claim_id, deleted_at
on public.vehicle_entries
for each row execute function public.guard_active_vehicle_entry_per_claim();
