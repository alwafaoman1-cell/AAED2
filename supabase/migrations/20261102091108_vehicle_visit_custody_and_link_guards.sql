-- Keep physical custody aligned with a finalized handover. This trigger only
-- reacts to new status changes; it does not rewrite historical records.
create or replace function public.vehicle_visit_handover_custody()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehicle_entry_id is null or new.status is not distinct from old.status then return new; end if;
  if new.status = 'finalized' then
    update public.vehicle_entries set vehicle_location = 'مع العميل', vehicle_location_bay = null,
      updated_at = now()
    where id = new.vehicle_entry_id and tenant_id = new.tenant_id and deleted_at is null;
  elsif new.status = 'cancelled' then
    update public.vehicle_entries set vehicle_location = 'داخل الورشة', updated_at = now()
    where id = new.vehicle_entry_id and tenant_id = new.tenant_id and deleted_at is null;
  end if;
  return new;
end;
$$;
create trigger trg_vehicle_visit_handover_custody
  after update of status on public.vehicle_handover_records
  for each row execute function public.vehicle_visit_handover_custody();

-- Concurrent creation through claim/order screens must not make two live
-- operational records for the same physical entry. Existing rows are untouched.
create or replace function public.vehicle_visit_source_duplicate_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehicle_entry_id is null or new.deleted_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.vehicle_entry_id::text || ':' || tg_table_name, 0));
  if tg_table_name = 'job_orders' then
    if exists (select 1 from public.job_orders existing
      where existing.tenant_id = new.tenant_id and existing.vehicle_entry_id = new.vehicle_entry_id
        and existing.deleted_at is null and existing.id <> new.id) then
      raise exception 'VEHICLE_VISIT_WORK_ORDER_ALREADY_EXISTS';
    end if;
  elsif tg_table_name = 'insurance_claims' then
    if exists (select 1 from public.insurance_claims existing
      where existing.tenant_id = new.tenant_id and existing.vehicle_entry_id = new.vehicle_entry_id
        and existing.deleted_at is null and existing.id <> new.id) then
      raise exception 'VEHICLE_VISIT_CLAIM_ALREADY_EXISTS';
    end if;
  end if;
  return new;
end;
$$;
create trigger trg_vehicle_visit_order_duplicate_guard
  before insert or update of vehicle_entry_id, deleted_at on public.job_orders
  for each row execute function public.vehicle_visit_source_duplicate_guard();
create trigger trg_vehicle_visit_claim_duplicate_guard
  before insert or update of vehicle_entry_id, deleted_at on public.insurance_claims
  for each row execute function public.vehicle_visit_source_duplicate_guard();

revoke all on function public.vehicle_visit_handover_custody(),
  public.vehicle_visit_source_duplicate_guard() from public, anon, authenticated;
