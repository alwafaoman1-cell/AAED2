-- Development was migrated before the Production duplicate preflight. Keep
-- historical conflicts in Needs Review without blocking ordinary source saves.
create or replace function public.vehicle_visit_has_conflicting_entry(p_entry_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.vehicle_entries current_entry
    join public.vehicle_entries other on other.tenant_id = current_entry.tenant_id
      and other.vehicle_id = current_entry.vehicle_id
      and other.id <> current_entry.id and other.deleted_at is null
    where current_entry.id = p_entry_id and current_entry.deleted_at is null
      and (
        (other.vehicle_location = 'داخل الورشة'
          and public.vehicle_visit_evidence_stage(other.id) <> 'delivered')
        or public.vehicle_visit_evidence_stage(other.id) not in ('delivered','cancelled')
      )
  );
$$;

create or replace function public.sync_vehicle_visit_from_source(p_entry_id uuid, p_source text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.vehicle_entries%rowtype;
  v_state public.vehicle_visit_workflows%rowtype;
  v_evidence text;
  v_has_state boolean;
begin
  if p_entry_id is null or current_setting('app.vehicle_visit_manual_transition', true) = 'on' then return; end if;
  select * into v_entry from public.vehicle_entries where id = p_entry_id and deleted_at is null;
  if not found or v_entry.vehicle_id is null then return; end if;
  select * into v_state from public.vehicle_visit_workflows where entry_id = p_entry_id for update;
  v_has_state := found;
  v_evidence := public.vehicle_visit_evidence_stage(p_entry_id);
  if not v_has_state then
    if v_evidence not in ('delivered','cancelled')
      and public.vehicle_visit_has_conflicting_entry(p_entry_id) then return; end if;
    insert into public.vehicle_visit_workflows(entry_id, tenant_id, vehicle_id, stage, changed_by)
    values (p_entry_id, v_entry.tenant_id, v_entry.vehicle_id, v_evidence, auth.uid());
    insert into public.vehicle_visit_transitions(tenant_id, entry_id, revision, from_stage, to_stage,
      occurred_at, recorded_by, responsible_user_id, source)
    values (v_entry.tenant_id, p_entry_id, 0, null, v_evidence,
      (v_entry.arrival_date + v_entry.arrival_time) at time zone 'Asia/Muscat',
      auth.uid(), auth.uid(), p_source);
    return;
  end if;
  if v_evidence = v_state.stage then
    if v_state.review_reason = 'source_regressed' then
      update public.vehicle_visit_workflows set review_reason = null where entry_id = p_entry_id;
    end if;
    return;
  end if;
  if v_state.stage = 'delivered' and v_evidence = 'cancelled' then
    update public.vehicle_visit_workflows set review_reason = 'delivered_then_cancelled' where entry_id = p_entry_id;
    return;
  end if;
  if public.vehicle_visit_stage_rank(v_evidence) < public.vehicle_visit_stage_rank(v_state.stage) then
    update public.vehicle_visit_workflows set review_reason = 'source_regressed' where entry_id = p_entry_id;
    return;
  end if;
  update public.vehicle_visit_workflows set stage = v_evidence, revision = revision + 1,
    review_reason = null, changed_at = now(), changed_by = auth.uid() where entry_id = p_entry_id;
  insert into public.vehicle_visit_transitions(tenant_id, entry_id, revision, from_stage, to_stage,
    occurred_at, recorded_by, responsible_user_id, source)
  values (v_entry.tenant_id, p_entry_id, v_state.revision + 1, v_state.stage, v_evidence,
    now(), auth.uid(), auth.uid(), p_source);
end;
$$;

-- A direct RPC on an old visit must report Needs Review, not a unique-index
-- error, and must never leave a partial workflow or transition behind.
create or replace function public.vehicle_visit_workflow_insert_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage not in ('delivered','cancelled')
    and public.vehicle_visit_has_conflicting_entry(new.entry_id) then
    raise exception 'VEHICLE_VISIT_REVIEW_REQUIRED';
  end if;
  return new;
end;
$$;
create trigger trg_vehicle_visit_workflow_insert_guard
  before insert on public.vehicle_visit_workflows
  for each row execute function public.vehicle_visit_workflow_insert_guard();

revoke all on function public.vehicle_visit_has_conflicting_entry(uuid),
  public.vehicle_visit_workflow_insert_guard() from public, anon, authenticated;
