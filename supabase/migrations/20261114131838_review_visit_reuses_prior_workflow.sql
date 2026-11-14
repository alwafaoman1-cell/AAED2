-- Multiple signed handovers are valid only for distinct, attested review visits.
-- Keep the original one-final-handover-per-order constraint for ordinary visits.
alter table public.vehicle_handover_records add column review_return_id uuid references public.vehicle_review_returns(id);
drop index public.vehicle_handover_one_active_final_per_work_order;
create unique index vehicle_handover_one_active_final_per_work_order on public.vehicle_handover_records(tenant_id,work_order_id) where status='finalized' and review_return_id is null;
create unique index vehicle_handover_one_final_per_review on public.vehicle_handover_records(tenant_id,review_return_id) where status='finalized' and review_return_id is not null;
create function app_private.guard_review_handover_relation() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if NEW.review_return_id is not null and (not exists(select 1 from public.vehicle_review_returns r where r.id=NEW.review_return_id and r.return_entry_id=NEW.vehicle_entry_id and r.tenant_id=NEW.tenant_id)
 or (TG_OP='INSERT' and NEW.status<>'draft')) then raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT'; end if;
 return NEW;
end $$;
revoke all on function app_private.guard_review_handover_relation() from public,anon,authenticated,service_role;
create trigger trg_01_review_handover_relation before insert or update on public.vehicle_handover_records for each row execute function app_private.guard_review_handover_relation();

-- Review visits reference historical work without reopening its accounting or custody.
create function app_private.review_visit_context(p_entry uuid) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('source_entry_id',r.source_entry_id,'source_entry_number',e.entry_number,
 'source_handover_id',h.id,'source_handover_number',h.receipt_number,
 'source_claim_id',h.claim_id,'source_claim_number',c.claim_number,
 'source_work_order_id',h.work_order_id,'source_work_order_number',j.order_number)
 from public.vehicle_review_returns r join public.vehicle_entries e on e.id=r.source_entry_id and e.tenant_id=r.tenant_id
 join public.vehicle_handover_records h on h.id=r.source_handover_id and h.tenant_id=r.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized'
 left join public.job_orders j on j.id=h.work_order_id and j.tenant_id=r.tenant_id and j.vehicle_id=h.vehicle_id
 left join public.insurance_claims c on c.id=h.claim_id and c.tenant_id=r.tenant_id and c.vehicle_id=h.vehicle_id
 where r.return_entry_id=p_entry
$$;
revoke all on function app_private.review_visit_context(uuid) from public,anon,authenticated,service_role;
create function public.vehicle_review_visit_context(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.vehicle_entries e join public.profiles p on p.tenant_id=e.tenant_id and p.user_id=auth.uid()
 where e.id=p_entry_id and e.tenant_id=public.get_user_tenant_id() and e.deleted_at is null and p.account_status='active' and p.disabled_at is null)
 then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 return app_private.review_visit_context(p_entry_id)||jsonb_build_object('review_findings',(select notes from public.vehicle_visit_transitions where entry_id=p_entry_id and tenant_id=public.get_user_tenant_id() and to_stage='ready' order by revision desc limit 1));
end $$;
revoke all on function public.vehicle_review_visit_context(uuid) from public,anon,service_role;
grant execute on function public.vehicle_review_visit_context(uuid) to authenticated;

-- Reject new financial links on a review visit; historical references live in the
-- immutable review relation, not in the original order's one-to-one visit FK.
create function app_private.guard_review_financial_links() returns trigger language plpgsql security definer set search_path='' as $$
declare entry_id uuid;
begin
 if TG_TABLE_NAME='vehicle_entries' then
  if exists(select 1 from public.vehicle_review_returns where return_entry_id=NEW.id)
   and coalesce(NEW.insurance_claim_id,NEW.converted_claim_id,NEW.work_order_id,NEW.converted_work_order_id) is not null then raise exception 'REVIEW_RETURN_SOURCE_ONLY'; end if;
 else
  entry_id:=NEW.vehicle_entry_id;
  if exists(select 1 from public.vehicle_review_returns where return_entry_id=entry_id) then raise exception 'REVIEW_RETURN_SOURCE_ONLY'; end if;
 end if;
 return NEW;
end $$;
revoke all on function app_private.guard_review_financial_links() from public,anon,authenticated,service_role;
create trigger review_financial_links before update on public.vehicle_entries for each row execute function app_private.guard_review_financial_links();
create trigger review_financial_links before insert or update of vehicle_entry_id on public.job_orders for each row execute function app_private.guard_review_financial_links();
create trigger review_financial_links before insert or update of vehicle_entry_id on public.insurance_claims for each row execute function app_private.guard_review_financial_links();

create function app_private.advance_review_visit(p_entry uuid,p_revision integer,p_target text,p_at timestamptz,p_notes text,p_reason text,p_responsible uuid) returns public.vehicle_visit_workflows
language plpgsql set search_path='' as $$
declare e public.vehicle_entries; w public.vehicle_visit_workflows; old_stage text; actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); role_name text;
begin
 select p.role::text into role_name from public.profiles p where p.user_id=actor and p.tenant_id=tenant and p.account_status='active' and p.disabled_at is null;
 if role_name is null or role_name not in ('admin','manager','supervisor','technician') then raise exception 'VEHICLE_VISIT_PERMISSION_DENIED'; end if;
 select * into e from public.vehicle_entries where id=p_entry and tenant_id=tenant and deleted_at is null for update;
 if not found or app_private.review_visit_context(e.id) is null then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=tenant for update;
 if not found or w.revision<>p_revision then raise exception 'VEHICLE_VISIT_STALE_REVISION'; end if;
 if w.stage in ('delivered','cancelled') then raise exception 'REVIEW_RETURN_TERMINAL'; end if;
 if p_at is null or p_at>clock_timestamp()+interval '5 minutes' or p_at<((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')
 or p_at<coalesce((select occurred_at from public.vehicle_visit_transitions where entry_id=e.id order by revision desc limit 1),'-infinity'::timestamptz)
 then raise exception 'VEHICLE_VISIT_TIME_INVALID'; end if;
 if length(coalesce(p_notes,''))>2000 or length(coalesce(p_reason,''))>1000 then raise exception 'VEHICLE_VISIT_DETAILS_TOO_LONG'; end if;
 if not exists(select 1 from public.profiles where user_id=coalesce(p_responsible,actor) and tenant_id=tenant and account_status='active' and disabled_at is null) then raise exception 'VEHICLE_VISIT_RESPONSIBLE_INVALID'; end if;
 if p_target='cancelled' then
  if role_name not in ('admin','manager') or length(trim(coalesce(p_reason,'')))<5 then raise exception 'VEHICLE_VISIT_REASON_REQUIRED'; end if;
 elsif not ((w.stage in ('arrived','approved') and p_target='in_progress') or (w.stage='in_progress' and p_target='ready')) then
  raise exception 'REVIEW_RETURN_STAGE_INVALID';
 end if;
 if p_target='ready' and (role_name not in ('admin','manager','supervisor') or length(trim(coalesce(p_notes,'')))<5) then raise exception 'REVIEW_RETURN_FINDINGS_REQUIRED'; end if;
 if p_target<>'cancelled' and e.vehicle_location is distinct from 'داخل الورشة' then raise exception 'VEHICLE_VISIT_NOT_IN_WORKSHOP'; end if;
 old_stage:=w.stage;
 update public.vehicle_visit_workflows set stage=p_target,revision=revision+1,changed_at=clock_timestamp(),changed_by=actor,review_reason=null where entry_id=e.id returning * into w;
 insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source,notes,reason)
 values(tenant,e.id,w.revision,old_stage,p_target,p_at,actor,coalesce(p_responsible,actor),'manual',nullif(trim(p_notes),''),nullif(trim(p_reason),''));
 if p_target='cancelled' then update public.vehicle_entries set status='Cancelled' where id=e.id; end if;
 return w;
end $$;
revoke all on function app_private.advance_review_visit(uuid,integer,text,timestamptz,text,text,uuid) from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.advance_vehicle_visit(p_entry_id uuid, p_expected_revision integer, p_target_stage text, p_occurred_at timestamp with time zone, p_notes text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_responsible_user_id uuid DEFAULT NULL::uuid, p_requirements jsonb DEFAULT '{}'::jsonb)
 RETURNS vehicle_visit_workflows
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  if exists(select 1 from public.vehicle_review_returns where return_entry_id=p_entry_id and tenant_id=v_tenant) then
   return app_private.advance_review_visit(p_entry_id,p_expected_revision,p_target_stage,p_occurred_at,p_notes,p_reason,p_responsible_user_id);
  end if;
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
$function$
;

CREATE OR REPLACE FUNCTION public.vehicle_visit_evidence_stage(p_entry_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
begin
  select * into v_entry from public.vehicle_entries where id = p_entry_id and deleted_at is null;
  if not found then return null; end if;
  if exists(select 1 from public.vehicle_review_returns where return_entry_id=v_entry.id and tenant_id=v_entry.tenant_id) then
   if v_entry.status='Cancelled' then return 'cancelled'; end if;
   if exists(select 1 from public.vehicle_handover_records where vehicle_entry_id=v_entry.id and tenant_id=v_entry.tenant_id and status='finalized') then return 'delivered'; end if;
   return coalesce((select stage from public.vehicle_visit_workflows where entry_id=v_entry.id),'arrived');
  end if;
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
$function$
;

CREATE OR REPLACE FUNCTION app_private.bind_vehicle_handover_visit()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  j public.job_orders%rowtype;
  e public.vehicle_entries%rowtype;
  c public.insurance_claims%rowtype;
  ids uuid[];
  actor uuid:=auth.uid();
  needs_link boolean;
begin
  -- Finalized evidence is not rewritten by this trigger. Its existing immutable
  -- guard owns metadata-only, explicitly audited administrative corrections.
  if (tg_op='UPDATE' and old.status<>'draft') or new.status not in ('draft','finalized')
    or (tg_op='INSERT' and new.status<>'draft') then return new; end if;
  if actor is null or public.get_user_tenant_id() is distinct from new.tenant_id
    or not exists(select 1 from public.profiles p where p.user_id=actor
      and p.tenant_id=new.tenant_id and p.account_status='active' and p.disabled_at is null
      and p.role::text in ('admin','manager','insurance','supervisor')) then
    raise exception 'VEHICLE_HANDOVER_PERMISSION_DENIED' using errcode='42501';
  end if;
  if exists(select 1 from public.vehicle_review_returns where return_entry_id=new.vehicle_entry_id and tenant_id=new.tenant_id) then
   select * into e from public.vehicle_entries where id=new.vehicle_entry_id and tenant_id=new.tenant_id and deleted_at is null for update;
   if not found or e.status='Cancelled' or e.vehicle_id is distinct from new.vehicle_id or e.customer_id is distinct from new.customer_id
    or not exists(select 1 from public.vehicle_review_returns r join public.vehicle_handover_records h on h.id=r.source_handover_id and h.tenant_id=r.tenant_id
     where r.return_entry_id=e.id and r.tenant_id=e.tenant_id and h.status='finalized' and h.vehicle_id=e.vehicle_id
     and h.work_order_id is not distinct from new.work_order_id and h.claim_id is not distinct from new.claim_id)
    or ((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')>new.delivered_at
   then raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT'; end if;
   if new.review_return_id is not null and not exists(select 1 from public.vehicle_review_returns where id=new.review_return_id and return_entry_id=e.id and tenant_id=e.tenant_id) then raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT'; end if;
   new.review_return_id:=(select id from public.vehicle_review_returns where return_entry_id=e.id and tenant_id=e.tenant_id);
   new.snapshot_json:=coalesce(new.snapshot_json,'{}'::jsonb)||jsonb_build_object('reviewSource',app_private.review_visit_context(e.id));
   return new;
  end if;
  select * into j from public.job_orders where id=new.work_order_id
    and tenant_id=new.tenant_id and deleted_at is null for update;
  if not found or j.vehicle_id is distinct from new.vehicle_id
    or j.claim_id is distinct from new.claim_id or j.customer_id is distinct from new.customer_id then
    raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT' using errcode='23514';
  end if;
  if j.claim_id is not null then
    select * into c from public.insurance_claims where id=j.claim_id
      and tenant_id=j.tenant_id and deleted_at is null for update;
    if not found or c.vehicle_id is distinct from j.vehicle_id
      or c.status in ('cancelled','rejected') or j.work_order_type is distinct from 'insurance' then
      raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT' using errcode='23514';
    end if;
  elsif j.work_order_type='insurance' then
    raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT' using errcode='23514';
  end if;
  select array_agg(x.id) into ids from (
    select v.id from public.vehicle_entries v where v.tenant_id=j.tenant_id and v.deleted_at is null
      and (v.id=new.vehicle_entry_id or v.id=j.vehicle_entry_id
        or v.work_order_id=j.id or v.converted_work_order_id=j.id)
    order by v.id limit 2 for update
  ) x;
  if coalesce(cardinality(ids),0)=0 then
    if new.vehicle_entry_id is not null or j.vehicle_entry_id is not null then
      raise exception 'VEHICLE_HANDOVER_VISIT_REQUIRED' using errcode='23514';
    end if;
    return new; -- no visit exists for this standalone legacy order
  end if;
  if cardinality(ids)<>1 then
    raise exception 'VEHICLE_HANDOVER_VISIT_AMBIGUOUS' using errcode='23514';
  end if;
  select * into e from public.vehicle_entries where id=ids[1];
  if e.vehicle_id is distinct from j.vehicle_id or e.status='Cancelled'
    or (new.vehicle_entry_id is not null and new.vehicle_entry_id<>e.id)
    or (j.vehicle_entry_id is not null and j.vehicle_entry_id<>e.id)
    or (e.work_order_id is not null and e.work_order_id<>j.id)
    or (e.converted_work_order_id is not null and e.converted_work_order_id<>j.id)
    or coalesce(e.insurance_claim_id,e.converted_claim_id) is distinct from j.claim_id
    or (e.insurance_claim_id is not null and e.converted_claim_id is not null and e.insurance_claim_id<>e.converted_claim_id)
    or (c.vehicle_entry_id is not null and c.vehicle_entry_id<>e.id)
    or exists(select 1 from public.job_orders other where other.tenant_id=j.tenant_id
      and other.vehicle_entry_id=e.id and other.id<>j.id and other.deleted_at is null and other.parent_work_order_id is null)
    or e.arrival_date>(new.delivered_at at time zone 'Asia/Muscat')::date
    or (e.vehicle_condition->>'arrival_time_precision' is distinct from 'date_only'
      and ((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')>new.delivered_at) then
    raise exception 'VEHICLE_HANDOVER_VISIT_CONFLICT' using errcode='23514';
  end if;
  needs_link:=new.vehicle_entry_id is distinct from e.id or j.vehicle_entry_id is null
    or (j.claim_id is not null and c.vehicle_entry_id is null);
  if j.vehicle_entry_id is null then
    update public.job_orders set vehicle_entry_id=e.id where id=j.id and tenant_id=j.tenant_id;
  end if;
  if j.claim_id is not null and c.vehicle_entry_id is null then
    update public.insurance_claims set vehicle_entry_id=e.id where id=c.id and tenant_id=j.tenant_id;
  end if;
  if needs_link then
    insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,old_value,new_value,reason)
      values(j.tenant_id,e.id,actor,'vehicle_entry.handover_visit_linked',
        jsonb_build_object('handover_entry_id',new.vehicle_entry_id,'order_entry_id',j.vehicle_entry_id,'claim_entry_id',c.vehicle_entry_id),
        jsonb_build_object('handover_id',new.id,'entry_id',e.id,'work_order_id',j.id,'claim_id',j.claim_id),
        'Bound the sole explicit same-tenant, same-vehicle, same-claim visit before handover finalization');
  end if;
  new.vehicle_entry_id:=e.id;
  new.visit_number:=coalesce(new.visit_number,j.visit_number);
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_vehicle_handover(p_record_id uuid)
 RETURNS vehicle_handover_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_record public.vehicle_handover_records;
  v_year integer;
  v_sequence bigint;
  v_receipt text;
begin
  if auth.uid() is null or v_tenant is null then raise exception 'VEHICLE_HANDOVER_AUTH_REQUIRED'; end if;
  if public.get_user_role() <> all (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role
  ]) then raise exception 'VEHICLE_HANDOVER_PERMISSION_DENIED'; end if;

  select * into v_record from public.vehicle_handover_records
    where id = p_record_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VEHICLE_HANDOVER_NOT_FOUND'; end if;
  if v_record.status = 'finalized' then return v_record; end if;
  if v_record.status <> 'draft' then raise exception 'VEHICLE_HANDOVER_NOT_DRAFT'; end if;
  if nullif(trim(v_record.recipient_name), '') is null then
    raise exception 'VEHICLE_HANDOVER_RECIPIENT_REQUIRED';
  end if;
  if nullif(trim(coalesce(v_record.signature_data_url, '')), '') is null and (
    coalesce(v_record.snapshot_json->>'signatureMethod', '') <> 'paper'
    or coalesce(v_record.snapshot_json->>'paperSignatureConfirmed', '') <> 'true'
    or nullif(trim(coalesce(v_record.recipient_id_number, '')), '') is null
    or nullif(trim(coalesce(v_record.workshop_representative, '')), '') is null
  ) then raise exception 'VEHICLE_HANDOVER_PAPER_EVIDENCE_REQUIRED'; end if;

  if exists(select 1 from public.vehicle_review_returns where return_entry_id=v_record.vehicle_entry_id and tenant_id=v_tenant)
   and not exists(select 1 from public.vehicle_visit_workflows where entry_id=v_record.vehicle_entry_id and tenant_id=v_tenant and stage='ready') then raise exception 'REVIEW_RETURN_NOT_READY'; end if;
  v_year := extract(year from v_record.delivered_at at time zone 'Asia/Muscat')::integer;
  insert into public.vehicle_handover_sequences(tenant_id, sequence_year, last_number)
    values (v_tenant, v_year, 1)
    on conflict (tenant_id, sequence_year) do update
      set last_number = public.vehicle_handover_sequences.last_number + 1, updated_at = now()
    returning last_number into v_sequence;
  v_receipt := format('VH-%s-%s', v_year, lpad(v_sequence::text, 5, '0'));

  perform set_config('app.vehicle_handover_transition', 'finalize', true);
  update public.vehicle_handover_records set
    status = 'finalized', receipt_number = v_receipt,
    finalized_at = now(), finalized_by = auth.uid(), updated_at = now(), updated_by = auth.uid()
    where id = p_record_id returning * into v_record;

  if exists(select 1 from public.vehicle_review_returns where return_entry_id=v_record.vehicle_entry_id and tenant_id=v_tenant) then return v_record; end if;
  update public.job_orders set
    status = 'delivered', vehicle_delivered_at = v_record.delivered_at,
    vehicle_presence_status = 'with_customer', vehicle_location_note = 'تم خروج وتسليم المركبة',
    updated_at = now()
    where id = v_record.work_order_id and tenant_id = v_tenant and deleted_at is null;

  if v_record.claim_id is not null then
    update public.insurance_claims set
      delivered_at = v_record.delivered_at, vehicle_delivered_at = v_record.delivered_at,
      vehicle_presence_status = 'with_customer', repair_stage = 'delivered',
      receiver_name = v_record.recipient_name,
      receiver_id_number = v_record.recipient_id_number,
      receiver_id_photo = v_record.receiver_id_photo_url,
      delivery_notes = v_record.satisfaction_notes,
      vehicle_location_note = 'تم خروج وتسليم المركبة', updated_at = now()
      where id = v_record.claim_id and tenant_id = v_tenant and deleted_at is null;
  end if;

  update public.claim_work_order_operations set
    vehicle_delivered_at = v_record.delivered_at,
    vehicle_presence_status = 'with_customer', operational_status = 'delivered',
    repair_stage = 'delivered', vehicle_location_note = 'تم خروج وتسليم المركبة',
    updated_at = now(), last_changed_from = 'system', last_changed_by = auth.uid()
    where tenant_id = v_tenant
      and (work_order_id = v_record.work_order_id or (v_record.claim_id is not null and claim_id = v_record.claim_id));
  return v_record;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_vehicle_handover_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_transition text := current_setting('app.vehicle_handover_transition', true);
  e public.vehicle_entries%rowtype;
begin
  if v_transition='cancel' and exists(select 1 from public.vehicle_review_returns where return_entry_id=old.vehicle_entry_id and tenant_id=old.tenant_id) then raise exception 'REVIEW_RETURN_TERMINAL'; end if;
  if tg_op='DELETE' then raise exception 'VEHICLE_HANDOVER_DELETE_FORBIDDEN'; end if;
  if v_transition='link_legacy_entry' then
    if current_user<>'postgres' or auth.uid() is null
      or old.status<>'finalized' or old.finalized_at is null
      or old.vehicle_entry_id is not null or new.vehicle_entry_id is null
      or (to_jsonb(new)-array['vehicle_entry_id','updated_at','updated_by'])
        is distinct from (to_jsonb(old)-array['vehicle_entry_id','updated_at','updated_by'])
      or nullif(old.signature_data_url,'') is null then
      raise exception 'HANDOVER_LEGACY_LINK_METADATA_ONLY';
    end if;
    select * into e from public.vehicle_entries where id=new.vehicle_entry_id for update;
    if not found or e.deleted_at is not null or e.tenant_id<>old.tenant_id
      or e.vehicle_id is distinct from old.vehicle_id
      or coalesce(e.work_order_id,e.converted_work_order_id) is distinct from old.work_order_id
      or coalesce(e.insurance_claim_id,e.converted_claim_id) is distinct from old.claim_id
      or e.arrival_date>(old.delivered_at at time zone 'Asia/Muscat')::date
      or (e.vehicle_condition->>'arrival_time_precision' is distinct from 'date_only'
        and ((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')>old.delivered_at)
      or not exists(select 1 from public.profiles p where p.user_id=auth.uid()
        and p.tenant_id=old.tenant_id and p.account_status='active' and p.disabled_at is null
        and p.role::text in ('admin','owner','manager'))
      or not exists(select 1 from public.job_orders j where j.id=old.work_order_id
        and j.tenant_id=old.tenant_id and j.vehicle_id=old.vehicle_id
        and j.claim_id is not distinct from old.claim_id and j.deleted_at is null
        and j.vehicle_entry_id=e.id)
      or (old.claim_id is not null and not exists(select 1 from public.insurance_claims c
        where c.id=old.claim_id and c.tenant_id=old.tenant_id and c.vehicle_id=old.vehicle_id
        and c.deleted_at is null and c.vehicle_entry_id=e.id))
      or exists(select 1 from public.vehicle_handover_records h where h.id<>old.id
        and h.tenant_id=old.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized')
      or not exists(select 1 from public.vehicle_entry_audit_logs a where a.tenant_id=e.tenant_id
        and a.vehicle_entry_id=e.id and a.user_id=auth.uid()
        and a.action='vehicle_entry.legacy_visit_reconciled'
        and a.created_at=transaction_timestamp() and nullif(trim(a.reason),'') is not null
        and a.new_value->>'handover_id'=old.id::text) then
      raise exception 'HANDOVER_LEGACY_LINK_EVIDENCE_REQUIRED';
    end if;
  elsif old.status in ('finalized','cancelled') and coalesce(v_transition,'')<>'cancel' then
    raise exception 'VEHICLE_HANDOVER_FINALIZED_IMMUTABLE';
  end if;
  if old.status='draft' and new.status<>'draft' and coalesce(v_transition,'')<>'finalize' then
    raise exception 'VEHICLE_HANDOVER_TRANSITION_REQUIRES_RPC';
  end if;
  new.updated_at:=now();new.updated_by:=auth.uid();return new;
end;
$function$
;

create function public.deliver_vehicle_review_visit(p_entry_id uuid,p_request_id uuid,p_receipt_id uuid,p_recipient text,p_signature text,p_notes text) returns public.vehicle_handover_records
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; h public.vehicle_handover_records; source_h public.vehicle_handover_records; actor uuid:=auth.uid(); t uuid:=public.get_user_tenant_id(); staff text;
begin
 if actor is null or not app_private.custody_can('Deliver',t) or not exists(select 1 from public.profiles where user_id=actor and tenant_id=t and account_status='active' and disabled_at is null and role::text in ('admin','manager','supervisor')) then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 if p_request_id is null or p_receipt_id is null or length(trim(coalesce(p_recipient,''))) not between 2 and 200
 or p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature)>1500000 or length(trim(coalesce(p_notes,''))) not between 5 and 2000 then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':review-delivery:'||p_request_id::text,0));
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=t and deleted_at is null for update;
 if not found or e.status='Cancelled' then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into h from public.vehicle_handover_records where tenant_id=t and snapshot_json->>'reviewDeliveryRequest'=p_request_id::text;
 if found then
  if h.vehicle_entry_id<>e.id or h.snapshot_json->>'custodyReceiptId'<>p_receipt_id::text then raise exception 'REVIEW_RETURN_REQUEST_CONFLICT'; end if;
  return public.finalize_vehicle_handover(h.id);
 end if;
 if not exists(select 1 from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=t and stage='ready') then raise exception 'REVIEW_RETURN_NOT_READY'; end if;
 select sh.* into source_h from public.vehicle_review_returns r join public.vehicle_handover_records sh on sh.id=r.source_handover_id and sh.tenant_id=r.tenant_id where r.return_entry_id=e.id and r.tenant_id=t and sh.status='finalized' and sh.vehicle_id=e.vehicle_id;
 if not found then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 if not exists(select 1 from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=t and vehicle_entry_id=e.id and vehicle_id=e.vehicle_id and status='issued' and exists(select 1 from public.vehicle_entry_signed_revisions sr where sr.id=vehicle_entry_custody_receipts.revision_id and sr.revision=e.intake_revision)) then raise exception 'CUSTODY_NOT_VALID'; end if;
 select full_name into staff from public.profiles where user_id=actor and tenant_id=t;
 insert into public.vehicle_handover_records(tenant_id,vehicle_entry_id,work_order_id,claim_id,vehicle_id,customer_id,recipient_name,signature_data_url,workshop_representative,delivered_at,work_summary,snapshot_json)
 values(t,e.id,source_h.work_order_id,source_h.claim_id,e.vehicle_id,e.customer_id,trim(p_recipient),p_signature,staff,clock_timestamp(),trim(p_notes),
 jsonb_build_object('custodyReceiptId',p_receipt_id,'reviewDeliveryRequest',p_request_id,'reviewSource',app_private.review_visit_context(e.id),'signatureMethod','electronic')) returning * into h;
 return public.finalize_vehicle_handover(h.id);
end $$;
revoke all on function public.deliver_vehicle_review_visit(uuid,uuid,uuid,text,text,text) from public,anon,service_role;
grant execute on function public.deliver_vehicle_review_visit(uuid,uuid,uuid,text,text,text) to authenticated;

create or replace function public.vehicle_intake_receipt_document(p_receipt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.vehicle_entry_custody_receipts; r public.vehicle_entry_signed_revisions; delivery jsonb;
begin
 select * into c from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=public.get_user_tenant_id();
 if not found or not app_private.custody_can('Print',c.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select * into r from public.vehicle_entry_signed_revisions where id=c.revision_id and tenant_id=c.tenant_id;
 if c.status='used' then
  select jsonb_build_object('handover_id',h.id,'handover_number',h.receipt_number,'recipient_name',h.recipient_name,
   'delivered_at',h.delivered_at,'confirmed_at',h.finalized_at,'delivered_by_name',h.workshop_representative,
   'review_notes',h.work_summary,'signature_data_url',h.signature_data_url,'paper_signature_confirmed',coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false))
  into delivery from public.vehicle_handover_records h where h.id=c.handover_id and h.tenant_id=c.tenant_id
   and h.vehicle_entry_id=c.vehicle_entry_id and h.vehicle_id=c.vehicle_id and h.status='finalized'
   and (nullif(h.signature_data_url,'') is not null or coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false));
 end if;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id)
 values(c.tenant_id,c.vehicle_entry_id,c.id,'document_viewed',auth.uid());
 return jsonb_build_object('receipt',to_jsonb(c),'entry',r.snapshot,'revision',r.revision,'delivery_confirmation',delivery,'review_context',app_private.review_visit_context(c.vehicle_entry_id));
end $$;

-- A review delivery is attested against its own visit and used receipt. Historical
-- order/claim references never stand in for the new signed handover.
create or replace function public.vehicle_visit_delivery_guard() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.stage='delivered' and old.stage is distinct from 'delivered' and not exists(
 select 1 from public.vehicle_handover_records h join public.vehicle_entries e on e.id=h.vehicle_entry_id and e.tenant_id=h.tenant_id
 where h.tenant_id=new.tenant_id and h.vehicle_entry_id=new.entry_id and h.status='finalized' and h.vehicle_id=e.vehicle_id
 and (h.work_order_id in(e.work_order_id,e.converted_work_order_id) or exists(
  select 1 from public.vehicle_review_returns r join public.vehicle_entry_custody_receipts c on c.vehicle_entry_id=r.return_entry_id and c.tenant_id=r.tenant_id
  where r.return_entry_id=e.id and r.tenant_id=e.tenant_id and r.id=h.review_return_id and c.status='used' and c.handover_id=h.id and c.vehicle_id=e.vehicle_id))) then
 raise exception 'VEHICLE_VISIT_SIGNED_HANDOVER_REQUIRED'; end if;
 return new;
end $$;
