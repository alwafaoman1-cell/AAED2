-- An older claim/order can be linked from vehicle_entries while its own
-- vehicle_entry_id is NULL. Treat either direction as the same visit.
create or replace function public.vehicle_visit_source_duplicate_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehicle_entry_id is null or new.deleted_at is not null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.vehicle_entry_id::text || ':' || tg_table_name, 0));
  if tg_table_name = 'job_orders' then
    if exists (
      select 1 from public.job_orders existing
      where existing.tenant_id = new.tenant_id and existing.deleted_at is null
        and existing.id <> new.id
        and (existing.vehicle_entry_id = new.vehicle_entry_id or exists (
          select 1 from public.vehicle_entries e
          where e.id = new.vehicle_entry_id and e.tenant_id = new.tenant_id
            and e.deleted_at is null
            and existing.id in (e.work_order_id, e.converted_work_order_id)
        ))
    ) then raise exception 'VEHICLE_VISIT_WORK_ORDER_ALREADY_EXISTS'; end if;
  elsif tg_table_name = 'insurance_claims' then
    if exists (
      select 1 from public.insurance_claims existing
      where existing.tenant_id = new.tenant_id and existing.deleted_at is null
        and existing.id <> new.id
        and (existing.vehicle_entry_id = new.vehicle_entry_id or exists (
          select 1 from public.vehicle_entries e
          where e.id = new.vehicle_entry_id and e.tenant_id = new.tenant_id
            and e.deleted_at is null
            and existing.id in (e.insurance_claim_id, e.converted_claim_id)
        ))
    ) then raise exception 'VEHICLE_VISIT_CLAIM_ALREADY_EXISTS'; end if;
  end if;
  return new;
end;
$$;

-- Final delivery must have a finalized handover for this entry AND its linked
-- work order; a handover for another order must not unlock this visit.
create or replace function public.vehicle_visit_delivery_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'delivered' and old.stage is distinct from 'delivered' and not exists (
    select 1 from public.vehicle_handover_records h
    join public.vehicle_entries e on e.id = h.vehicle_entry_id and e.tenant_id = h.tenant_id
    where h.tenant_id = new.tenant_id and h.vehicle_entry_id = new.entry_id
      and h.work_order_id in (e.work_order_id, e.converted_work_order_id)
      and h.status = 'finalized'
  ) then
    raise exception 'VEHICLE_VISIT_SIGNED_HANDOVER_REQUIRED';
  end if;
  return new;
end;
$$;
