-- Manual stage transitions must not accept an insurance visit with a cash work
-- order or an order linked to a different claim. Source synchronization stays
-- non-blocking so an existing claim/work-order save is not undone by old data.
create function public.vehicle_visit_manual_channel_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.vehicle_entries%rowtype;
  v_order public.job_orders%rowtype;
  v_claim_id uuid;
begin
  if new.source <> 'manual' then return new; end if;
  select * into v_entry from public.vehicle_entries
    where id = new.entry_id and tenant_id = new.tenant_id and deleted_at is null;
  if not found then raise exception 'VEHICLE_VISIT_NOT_FOUND'; end if;
  v_claim_id := coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id);
  select * into v_order from public.job_orders
    where id = coalesce(v_entry.work_order_id,v_entry.converted_work_order_id)
      and tenant_id = new.tenant_id and deleted_at is null;
  if v_order.id is not null and (
    (v_claim_id is not null and
      (v_order.work_order_type is distinct from 'insurance' or v_order.claim_id is distinct from v_claim_id))
    or (v_claim_id is null and v_order.work_order_type = 'insurance')
  ) then
    raise exception 'VEHICLE_VISIT_ORDER_CHANNEL_MISMATCH';
  end if;
  return new;
end;
$$;
create trigger trg_vehicle_visit_manual_channel_guard
  before insert on public.vehicle_visit_transitions
  for each row execute function public.vehicle_visit_manual_channel_guard();
revoke all on function public.vehicle_visit_manual_channel_guard() from public, anon, authenticated;
