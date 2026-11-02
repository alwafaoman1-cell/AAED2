-- One operational workflow per physical entry. Existing entries are read through
-- their current claim/order evidence; no historical rows are rewritten here.
create table public.vehicle_visit_workflows (
  entry_id uuid primary key references public.vehicle_entries(id) on delete restrict,
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  stage text not null default 'arrived' check (stage in
    ('arrived','approved','in_progress','ready','delivered','cancelled')),
  revision integer not null default 0 check (revision >= 0),
  review_reason text,
  changed_at timestamptz not null default now(),
  changed_by uuid references auth.users(id) on delete set null
);

create unique index vehicle_visit_one_open_per_vehicle
  on public.vehicle_visit_workflows(tenant_id, vehicle_id)
  where stage not in ('delivered','cancelled');
create index vehicle_visit_workflows_tenant_stage_idx
  on public.vehicle_visit_workflows(tenant_id, stage, changed_at desc);

create table public.vehicle_visit_transitions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  entry_id uuid not null references public.vehicle_entries(id) on delete restrict,
  revision integer not null,
  from_stage text,
  to_stage text not null,
  occurred_at timestamptz not null,
  recorded_at timestamptz not null default now(),
  recorded_by uuid references auth.users(id) on delete set null,
  responsible_user_id uuid references auth.users(id) on delete set null,
  source text not null check (source in ('entry','manual','claim','work_order','handover')),
  notes text,
  reason text,
  requirements jsonb not null default '{}'::jsonb,
  unique (entry_id, revision)
);
create index vehicle_visit_transitions_history_idx
  on public.vehicle_visit_transitions(tenant_id, entry_id, revision desc);

alter table public.vehicle_visit_workflows enable row level security;
alter table public.vehicle_visit_transitions enable row level security;
revoke all on public.vehicle_visit_workflows, public.vehicle_visit_transitions from public, anon, authenticated;
grant select on public.vehicle_visit_workflows, public.vehicle_visit_transitions to authenticated;
create policy vehicle_visit_workflows_staff_read on public.vehicle_visit_workflows
  for select to authenticated using (
    tenant_id = public.get_user_tenant_id()
    and public.get_user_role() = any(array[
      'admin'::public.app_role,'manager'::public.app_role,'supervisor'::public.app_role,
      'technician'::public.app_role,'insurance'::public.app_role
    ])
  );
create policy vehicle_visit_transitions_staff_read on public.vehicle_visit_transitions
  for select to authenticated using (
    tenant_id = public.get_user_tenant_id()
    and public.get_user_role() = any(array[
      'admin'::public.app_role,'manager'::public.app_role,'supervisor'::public.app_role,
      'technician'::public.app_role,'insurance'::public.app_role
    ])
  );

-- Evidence is intentionally derived from linked operational records, never
-- from invoice or payment state. A paid claim is not proof of vehicle delivery.
create function public.vehicle_visit_evidence_stage(p_entry_id uuid)
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
  if v_order.vehicle_delivered_at is not null or v_claim.vehicle_delivered_at is not null
    or v_claim.delivered_at is not null or v_order.status::text = 'delivered' then
    return 'delivered';
  end if;
  if v_order.status::text = 'completed' or v_order.work_completed_at is not null
    or v_claim.work_completed_at is not null or v_claim.repair_stage in ('ready','quality_check') then
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

create function public.vehicle_visit_stage_rank(p_stage text)
returns integer language sql immutable set search_path = '' as $$
  select case p_stage when 'arrived' then 1 when 'approved' then 2
    when 'in_progress' then 3 when 'ready' then 4 when 'delivered' then 5
    when 'cancelled' then 6 else 0 end;
$$;

-- Historical visits may disagree about physical custody. Keep those rows
-- read-only for review; do not let a source update materialize a second open
-- workflow and abort an otherwise valid claim or work-order save.
create function public.vehicle_visit_has_conflicting_entry(p_entry_id uuid)
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

create function public.sync_vehicle_visit_from_source(p_entry_id uuid, p_source text)
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

create function public.vehicle_visit_entry_inserted()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehicle_id is null then
    raise exception 'VEHICLE_VISIT_VEHICLE_REQUIRED';
  end if;
  insert into public.vehicle_visit_workflows(entry_id, tenant_id, vehicle_id, stage, changed_by)
  values (new.id, new.tenant_id, new.vehicle_id, 'arrived', auth.uid());
  insert into public.vehicle_visit_transitions(tenant_id, entry_id, revision, from_stage, to_stage,
    occurred_at, recorded_by, responsible_user_id, source)
  values (new.tenant_id, new.id, 0, null, 'arrived',
    (new.arrival_date + new.arrival_time) at time zone 'Asia/Muscat',
    auth.uid(), auth.uid(), 'entry');
  perform public.sync_vehicle_visit_from_source(new.id, 'entry');
  return new;
end;
$$;
create trigger trg_vehicle_visit_entry_inserted after insert on public.vehicle_entries
  for each row execute function public.vehicle_visit_entry_inserted();

create function public.vehicle_visit_entry_duplicate_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_existing_id uuid;
begin
  if new.deleted_at is not null or new.vehicle_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || ':' || new.vehicle_id::text, 0));
  for v_existing_id in select id from public.vehicle_entries
    where tenant_id = new.tenant_id and vehicle_id = new.vehicle_id
      and deleted_at is null and id <> new.id
  loop
    perform public.sync_vehicle_visit_from_source(v_existing_id, 'entry');
  end loop;
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
create trigger trg_vehicle_visit_duplicate_guard
  before insert or update of vehicle_id, deleted_at on public.vehicle_entries
  for each row execute function public.vehicle_visit_entry_duplicate_guard();

create function public.vehicle_visit_entry_vehicle_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.vehicle_id is null then raise exception 'VEHICLE_VISIT_VEHICLE_REQUIRED'; end if;
  update public.vehicle_visit_workflows set vehicle_id = new.vehicle_id where entry_id = new.id;
  return new;
end;
$$;
create trigger trg_vehicle_visit_entry_vehicle_changed
  after update of vehicle_id on public.vehicle_entries
  for each row when (old.vehicle_id is distinct from new.vehicle_id)
  execute function public.vehicle_visit_entry_vehicle_changed();

create function public.vehicle_visit_entry_status_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.sync_vehicle_visit_from_source(new.id, 'entry');
  return new;
end;
$$;
create trigger trg_vehicle_visit_entry_status_changed
  after update of status on public.vehicle_entries
  for each row when (old.status is distinct from new.status)
  execute function public.vehicle_visit_entry_status_changed();

create function public.vehicle_visit_source_changed()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_entry_id uuid;
begin
  for v_entry_id in
    select distinct id from public.vehicle_entries
    where tenant_id = new.tenant_id and deleted_at is null
      and (id = new.vehicle_entry_id or
        (tg_table_name = 'job_orders' and (work_order_id = new.id or converted_work_order_id = new.id)) or
        (tg_table_name = 'insurance_claims' and (insurance_claim_id = new.id or converted_claim_id = new.id)))
  loop
    perform public.sync_vehicle_visit_from_source(v_entry_id,
      case when tg_table_name = 'job_orders' then 'work_order' else 'claim' end);
  end loop;
  return new;
end;
$$;
create trigger trg_vehicle_visit_order_changed
  after insert or update of status, work_started_at, work_completed_at, vehicle_delivered_at, deleted_at
  on public.job_orders for each row execute function public.vehicle_visit_source_changed();
create trigger trg_vehicle_visit_claim_changed
  after insert or update of status, repair_stage, work_started_at, work_completed_at,
    vehicle_delivered_at, delivered_at, approved_at, insurance_approved_at, deleted_at
  on public.insurance_claims for each row execute function public.vehicle_visit_source_changed();

-- All mutations go through this one transaction. The actor is auth.uid(); the
-- chosen responsible employee is separately tenant-validated and never impersonates the actor.
create function public.advance_vehicle_visit(
  p_entry_id uuid, p_expected_revision integer, p_target_stage text,
  p_occurred_at timestamptz, p_notes text default null, p_reason text default null,
  p_responsible_user_id uuid default null, p_requirements jsonb default '{}'::jsonb
) returns public.vehicle_visit_workflows
language plpgsql security definer set search_path = '' as $$
declare
  v_entry public.vehicle_entries%rowtype;
  v_state public.vehicle_visit_workflows%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
  v_actor uuid := auth.uid();
  v_tenant uuid := public.get_user_tenant_id();
  v_role text := public.get_user_role()::text;
  v_responsible uuid := coalesce(p_responsible_user_id, auth.uid());
  v_evidence text;
  v_previous_time timestamptz;
  v_from_stage text;
begin
  if v_actor is null or v_tenant is null or v_role not in
    ('admin','manager','supervisor','technician','insurance') then
    raise exception 'VEHICLE_VISIT_PERMISSION_DENIED';
  end if;
  if p_target_stage not in ('approved','in_progress','ready','delivered','cancelled','arrived') then
    raise exception 'VEHICLE_VISIT_STAGE_INVALID';
  end if;
  if p_occurred_at is null or p_occurred_at > now() + interval '5 minutes' then
    raise exception 'VEHICLE_VISIT_TIME_INVALID';
  end if;
  if length(coalesce(p_notes,'')) > 2000 or length(coalesce(p_reason,'')) > 1000
    or pg_column_size(coalesce(p_requirements,'{}'::jsonb)) > 8192 then
    raise exception 'VEHICLE_VISIT_DETAILS_TOO_LONG';
  end if;
  if not exists (select 1 from public.profiles where user_id = v_responsible
    and tenant_id = v_tenant) then raise exception 'VEHICLE_VISIT_RESPONSIBLE_INVALID'; end if;

  select * into v_entry from public.vehicle_entries
    where id = p_entry_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found then raise exception 'VEHICLE_VISIT_NOT_FOUND'; end if;
  if p_occurred_at < ((v_entry.arrival_date + v_entry.arrival_time)
      at time zone 'Asia/Muscat') then raise exception 'VEHICLE_VISIT_BEFORE_ARRIVAL'; end if;
  select * into v_state from public.vehicle_visit_workflows where entry_id = p_entry_id for update;
  if not found then
    if v_entry.vehicle_id is null then raise exception 'VEHICLE_VISIT_VEHICLE_REQUIRED'; end if;
    v_evidence := public.vehicle_visit_evidence_stage(p_entry_id);
    if v_evidence not in ('delivered','cancelled')
      and public.vehicle_visit_has_conflicting_entry(p_entry_id) then
      raise exception 'VEHICLE_VISIT_REVIEW_REQUIRED';
    end if;
    insert into public.vehicle_visit_workflows(entry_id, tenant_id, vehicle_id, stage, changed_by)
      values (p_entry_id, v_tenant, v_entry.vehicle_id, v_evidence, v_actor)
      returning * into v_state;
    insert into public.vehicle_visit_transitions(tenant_id, entry_id, revision, from_stage, to_stage,
      occurred_at, recorded_by, responsible_user_id, source)
      values (v_tenant, p_entry_id, 0, null, v_evidence,
        (v_entry.arrival_date + v_entry.arrival_time) at time zone 'Asia/Muscat',
        v_actor, v_actor, 'entry');
  end if;
  if v_state.revision <> p_expected_revision then raise exception 'VEHICLE_VISIT_STALE_REVISION'; end if;
  if v_state.review_reason is not null and not (
    v_role in ('admin','manager')
    and public.vehicle_visit_stage_rank(p_target_stage) < public.vehicle_visit_stage_rank(v_state.stage)
    and nullif(trim(coalesce(p_reason,'')), '') is not null
  ) then raise exception 'VEHICLE_VISIT_REVIEW_REQUIRED'; end if;
  if v_state.stage = p_target_stage then raise exception 'VEHICLE_VISIT_ALREADY_IN_STAGE'; end if;
  v_from_stage := v_state.stage;
  select occurred_at into v_previous_time from public.vehicle_visit_transitions
    where entry_id = p_entry_id order by revision desc limit 1;
  if v_previous_time is not null and p_occurred_at < v_previous_time then
    raise exception 'VEHICLE_VISIT_TIME_OUT_OF_ORDER';
  end if;
  select * into v_claim from public.insurance_claims
    where id = coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id)
      and tenant_id = v_tenant and deleted_at is null;
  select * into v_order from public.job_orders
    where id = coalesce(v_entry.work_order_id,v_entry.converted_work_order_id)
      and tenant_id = v_tenant and deleted_at is null;
  if (v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null
      and v_entry.insurance_claim_id <> v_entry.converted_claim_id)
    or (v_entry.work_order_id is not null and v_entry.converted_work_order_id is not null
      and v_entry.work_order_id <> v_entry.converted_work_order_id)
    or (coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id) is not null and v_claim.id is null)
    or (coalesce(v_entry.work_order_id,v_entry.converted_work_order_id) is not null and v_order.id is null) then
    raise exception 'VEHICLE_VISIT_LINK_REVIEW_REQUIRED';
  end if;
  if v_claim.id is not null and v_claim.vehicle_id is distinct from v_entry.vehicle_id then
    raise exception 'VEHICLE_VISIT_CLAIM_VEHICLE_MISMATCH';
  end if;
  if v_order.id is not null and v_order.vehicle_id is distinct from v_entry.vehicle_id then
    raise exception 'VEHICLE_VISIT_ORDER_VEHICLE_MISMATCH';
  end if;

  if p_target_stage = 'cancelled' then
    if v_role not in ('admin','manager') then raise exception 'VEHICLE_VISIT_CANCEL_PERMISSION_DENIED'; end if;
    if v_state.stage = 'delivered' then raise exception 'VEHICLE_VISIT_DELIVERY_REVERSAL_REQUIRED'; end if;
    if nullif(trim(coalesce(p_reason,'')), '') is null then raise exception 'VEHICLE_VISIT_REASON_REQUIRED'; end if;
    if (v_claim.id is not null and v_claim.status::text not in ('cancelled','rejected'))
      or (v_order.id is not null and v_order.status::text not in ('delivered') and v_order.deleted_at is null) then
      raise exception 'VEHICLE_VISIT_CANCEL_LINKED_RECORD_FIRST';
    end if;
  elsif public.vehicle_visit_stage_rank(p_target_stage) < public.vehicle_visit_stage_rank(v_state.stage) then
    if v_role not in ('admin','manager') or nullif(trim(coalesce(p_reason,'')), '') is null then
      raise exception 'VEHICLE_VISIT_REVERSAL_PERMISSION_OR_REASON_REQUIRED';
    end if;
    if v_state.stage = 'cancelled' then
      if p_target_stage is distinct from (
        select from_stage from public.vehicle_visit_transitions
          where entry_id = p_entry_id order by revision desc limit 1
      ) then raise exception 'VEHICLE_VISIT_REVERSAL_PREVIOUS_STAGE_ONLY'; end if;
    elsif public.vehicle_visit_stage_rank(p_target_stage) <> public.vehicle_visit_stage_rank(v_state.stage) - 1 then
      raise exception 'VEHICLE_VISIT_REVERSAL_ONE_STEP_ONLY';
    end if;
    v_evidence := public.vehicle_visit_evidence_stage(p_entry_id);
    if public.vehicle_visit_stage_rank(v_evidence) > public.vehicle_visit_stage_rank(p_target_stage) then
      raise exception 'VEHICLE_VISIT_REVERSE_SOURCE_FIRST';
    end if;
  else
    if public.vehicle_visit_stage_rank(p_target_stage) <> public.vehicle_visit_stage_rank(v_state.stage) + 1 then
      raise exception 'VEHICLE_VISIT_FORWARD_ONE_STEP_ONLY';
    end if;
    if p_target_stage = 'approved' then
      if v_role not in ('admin','manager','insurance') then
        raise exception 'VEHICLE_VISIT_APPROVAL_PERMISSION_DENIED';
      end if;
      if v_claim.id is not null then
        if v_claim.status::text not in ('approved','paid') then
          raise exception 'VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED';
        end if;
      elsif v_role = 'insurance' or v_order.id is null
        or coalesce(p_requirements->>'customer_approved','false') <> 'true' then
        raise exception 'VEHICLE_VISIT_CASH_APPROVAL_REQUIRED';
      end if;
    elsif p_target_stage = 'in_progress' then
      if v_role not in ('admin','manager','supervisor','technician') then
        raise exception 'VEHICLE_VISIT_WORK_PERMISSION_DENIED';
      end if;
      if v_order.id is null then raise exception 'VEHICLE_VISIT_WORK_ORDER_REQUIRED'; end if;
      if v_entry.vehicle_location is distinct from 'داخل الورشة'
        or v_order.vehicle_presence_status = 'with_customer'
        or v_claim.vehicle_presence_status = 'with_customer' then
        raise exception 'VEHICLE_VISIT_NOT_IN_WORKSHOP';
      end if;
      if v_claim.id is not null and v_claim.status::text not in ('approved','paid') then
        raise exception 'VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED';
      end if;
      if v_order.status::text not in ('received','inspection','waiting_parts','in_progress') then
        raise exception 'VEHICLE_VISIT_WORK_ORDER_STATUS_INVALID';
      end if;
      perform set_config('app.vehicle_visit_manual_transition','on',true);
      update public.job_orders set status = 'in_progress',
        work_started_at = coalesce(work_started_at,p_occurred_at), updated_at = now()
        where id = v_order.id and tenant_id = v_tenant;
      if v_claim.id is not null then
        update public.insurance_claims set repair_stage = 'in_progress',
          work_started_at = coalesce(work_started_at,p_occurred_at), updated_at = now()
          where id = v_claim.id and tenant_id = v_tenant;
      end if;
    elsif p_target_stage = 'ready' then
      if v_role not in ('admin','manager','supervisor') then
        raise exception 'VEHICLE_VISIT_READY_PERMISSION_DENIED';
      end if;
      if v_order.id is null or v_order.status::text <> 'completed' then
        raise exception 'VEHICLE_VISIT_COMPLETE_WORK_ORDER_FIRST';
      end if;
    elsif p_target_stage = 'delivered' then
      if v_role not in ('admin','manager','supervisor') then
        raise exception 'VEHICLE_VISIT_DELIVERY_PERMISSION_DENIED';
      end if;
      if v_order.id is null or v_order.status::text <> 'delivered'
        or v_order.vehicle_delivered_at is null then
        raise exception 'VEHICLE_VISIT_SIGNED_HANDOVER_REQUIRED';
      end if;
    end if;
  end if;

  update public.vehicle_visit_workflows set stage = p_target_stage, revision = revision + 1,
    changed_at = now(), changed_by = v_actor, review_reason = null
    where entry_id = p_entry_id returning * into v_state;
  insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,
    occurred_at,recorded_by,responsible_user_id,source,notes,reason,requirements)
  values(v_tenant,p_entry_id,v_state.revision,v_from_stage,p_target_stage,p_occurred_at,
    v_actor,v_responsible,'manual',nullif(trim(p_notes),''),nullif(trim(p_reason),''),
    coalesce(p_requirements,'{}'::jsonb));
  return v_state;
end;
$$;

revoke all on function public.vehicle_visit_evidence_stage(uuid),
  public.vehicle_visit_stage_rank(text), public.vehicle_visit_has_conflicting_entry(uuid),
  public.sync_vehicle_visit_from_source(uuid,text),
  public.vehicle_visit_entry_inserted(), public.vehicle_visit_entry_duplicate_guard(),
  public.vehicle_visit_entry_vehicle_changed(), public.vehicle_visit_entry_status_changed(),
  public.vehicle_visit_source_changed()
  from public, anon, authenticated;
revoke all on function public.advance_vehicle_visit(uuid,integer,text,timestamptz,text,text,uuid,jsonb)
  from public, anon, authenticated;
grant execute on function public.advance_vehicle_visit(uuid,integer,text,timestamptz,text,text,uuid,jsonb)
  to authenticated;

do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
    and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime'
      and schemaname = 'public' and tablename = 'vehicle_visit_workflows') then
    alter publication supabase_realtime add table public.vehicle_visit_workflows;
  end if;
end $$;
