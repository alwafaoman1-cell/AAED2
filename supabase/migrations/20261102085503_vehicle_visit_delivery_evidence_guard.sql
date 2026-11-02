-- A status flag is not proof that the vehicle left the workshop. The finalized
-- handover is the only final-delivery evidence. Temporary inspection releases
-- remain a separate, reversible custody event.
create or replace function public.vehicle_visit_evidence_stage(p_entry_id uuid)
returns text language plpgsql stable set search_path = '' as $$
declare
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
begin
  select * into v_entry from public.vehicle_entries where id = p_entry_id and deleted_at is null;
  if not found then return null; end if;
  select * into v_claim from public.insurance_claims
    where id = coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id)
      and tenant_id = v_entry.tenant_id and deleted_at is null;
  select * into v_order from public.job_orders
    where id = coalesce(v_entry.work_order_id, v_entry.converted_work_order_id)
      and tenant_id = v_entry.tenant_id and deleted_at is null;
  if v_entry.status = 'Cancelled' or v_claim.status::text in ('cancelled','rejected') then
    return 'cancelled';
  end if;
  if exists (select 1 from public.vehicle_handover_records h
    where h.tenant_id = v_entry.tenant_id and h.vehicle_entry_id = p_entry_id
      and h.work_order_id = v_order.id and h.status = 'finalized')
    and v_order.status::text = 'delivered' then
    return 'delivered';
  end if;
  if v_order.status::text in ('completed','delivered') or v_order.work_completed_at is not null
    or v_claim.work_completed_at is not null or v_claim.repair_stage in ('ready','quality_check','delivered') then
    return 'ready';
  end if;
  if v_order.status::text in ('in_progress','waiting_parts') or v_order.work_started_at is not null
    or v_claim.work_started_at is not null or v_claim.repair_stage in ('repairing','in_progress') then
    return 'in_progress';
  end if;
  if v_claim.status::text in ('approved','paid') or v_claim.approved_at is not null
    or v_claim.insurance_approved_at is not null then return 'approved'; end if;
  return 'arrived';
end;
$$;

create or replace function public.vehicle_visit_handover_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehicle_entry_id is not null and new.status is distinct from old.status then
    perform public.sync_vehicle_visit_from_source(new.vehicle_entry_id, 'handover');
  end if;
  return new;
end;
$$;

create trigger trg_vehicle_visit_handover_changed
  after update of status on public.vehicle_handover_records
  for each row execute function public.vehicle_visit_handover_changed();

-- Protect even a privileged/manual RPC caller from marking delivered before
-- the immutable signed handover has been finalized for this exact visit.
create or replace function public.vehicle_visit_delivery_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'delivered' and old.stage is distinct from 'delivered' and not exists (
    select 1 from public.vehicle_handover_records h
    where h.tenant_id = new.tenant_id and h.vehicle_entry_id = new.entry_id
      and h.status = 'finalized'
  ) then
    raise exception 'VEHICLE_VISIT_SIGNED_HANDOVER_REQUIRED';
  end if;
  return new;
end;
$$;

create trigger trg_vehicle_visit_delivery_guard before update of stage
  on public.vehicle_visit_workflows for each row
  execute function public.vehicle_visit_delivery_guard();

revoke all on function public.vehicle_visit_handover_changed(),
  public.vehicle_visit_delivery_guard() from public, anon, authenticated;
