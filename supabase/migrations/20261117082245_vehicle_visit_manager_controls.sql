-- Development first. Explicit manager corrections for active visits only.
-- Signed intake snapshots, receipts, handovers and accounting stay untouched.
alter table public.vehicle_visit_workflows
  add column manager_adjustment jsonb not null default '{}'::jsonb
  check(jsonb_typeof(manager_adjustment)='object' and pg_column_size(manager_adjustment)<=16384);

create function app_private.vehicle_visit_manager_presence(e public.vehicle_entries,w public.vehicle_visit_workflows)
returns text language sql stable set search_path='' as $$
 select case when w.stage in ('arrived','approved','in_progress','ready')
  and w.manager_adjustment->>'version'='1' and w.manager_adjustment->>'presence_attested'='true'
  and w.manager_adjustment->>'entry_id'=e.id::text and w.manager_adjustment->>'tenant_id'=e.tenant_id::text
  and w.manager_adjustment->>'vehicle_id'=e.vehicle_id::text
  and w.manager_adjustment->>'presence' in ('in_workshop','with_customer')
  and e.vehicle_location=(case w.manager_adjustment->>'presence' when 'in_workshop' then 'داخل الورشة' else 'مع العميل' end)
 then w.manager_adjustment->>'presence' else null end
$$;

create function app_private.vehicle_visit_manager_stage_active(e public.vehicle_entries,w public.vehicle_visit_workflows)
returns boolean language sql stable set search_path='' as $$
 select coalesce(w.stage in ('arrived','approved','in_progress','ready')
  and w.manager_adjustment->>'version'='1' and w.manager_adjustment->>'stage_override'='true'
  and w.manager_adjustment->>'entry_id'=e.id::text and w.manager_adjustment->>'tenant_id'=e.tenant_id::text
  and w.manager_adjustment->>'vehicle_id'=e.vehicle_id::text
  and w.manager_adjustment->>'stage'=w.stage and w.manager_adjustment->>'stage_revision'=w.revision::text,false)
$$;

-- A direct authenticated UPDATE cannot forge the trusted field, even if a
-- future table ACL is expanded. Invoker security preserves the statement role.
create function app_private.guard_vehicle_visit_manager_adjustment()
returns trigger language plpgsql set search_path='' as $$
declare m jsonb:=NEW.manager_adjustment; permit boolean; system_clear boolean:=false;
begin
 permit:=current_user='postgres'
  and current_setting('app.vehicle_visit_manager_request',true)=m->>'request_id'
  and m->>'actor_id'=auth.uid()::text and m->>'txid'=txid_current()::text
  and m->>'entry_id'=NEW.entry_id::text and m->>'tenant_id'=NEW.tenant_id::text
  and m->>'vehicle_id'=NEW.vehicle_id::text and m->>'version'='1'
  and exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=NEW.tenant_id
    and p.account_status='active' and p.disabled_at is null and p.role::text in ('admin','manager'));
 if TG_OP='INSERT' then
  if m<>'{}'::jsonb and not coalesce(permit,false) then raise exception 'VEHICLE_VISIT_MANAGER_FORBIDDEN' using errcode='42501';end if;
  return NEW;
 end if;
 system_clear:=current_user='postgres' and pg_trigger_depth()>1
  and OLD.manager_adjustment->>'presence_attested'='true'
  and m=jsonb_set(OLD.manager_adjustment,'{presence_attested}','false'::jsonb)
  and (to_jsonb(NEW)-'manager_adjustment')=(to_jsonb(OLD)-'manager_adjustment')
  and exists(select 1 from public.vehicle_entries e where e.id=NEW.entry_id and e.tenant_id=NEW.tenant_id
    and e.vehicle_location is distinct from (case OLD.manager_adjustment->>'presence' when 'in_workshop' then 'داخل الورشة' else 'مع العميل' end));
 if m is distinct from OLD.manager_adjustment and not coalesce(permit,false) and not coalesce(system_clear,false) then
  raise exception 'VEHICLE_VISIT_MANAGER_FORBIDDEN' using errcode='42501';
 end if;
 if not coalesce(permit,false) and m<>'{}'::jsonb then
  if NEW.stage is distinct from OLD.stage then
   -- An intentional canonical transition or a real terminal event wins.
   m:=jsonb_set(m,'{stage_override}','false'::jsonb);
  elsif NEW.revision is distinct from OLD.revision and m->>'stage_override'='true' then
   -- A same-stage custody event is not a new repair-stage decision.
   m:=jsonb_set(m,'{stage_revision}',to_jsonb(NEW.revision));
  end if;
  if NEW.stage in ('delivered','cancelled') then
   m:=jsonb_set(jsonb_set(m,'{stage_override}','false'::jsonb),'{presence_attested}','false'::jsonb);
  end if;
  NEW.manager_adjustment:=m;
 end if;
 return NEW;
end $$;
create trigger trg_00_vehicle_visit_manager_adjustment before insert or update on public.vehicle_visit_workflows
 for each row execute function app_private.guard_vehicle_visit_manager_adjustment();

-- Invalidate only custody attestation when a later canonical custody operation
-- moves the vehicle. Never mutate signed intake content or signature revisions.
create function app_private.clear_vehicle_visit_manager_presence()
returns trigger language plpgsql security definer set search_path='' as $$
declare w public.vehicle_visit_workflows; m jsonb; previous_request text;
begin
 if NEW.vehicle_location is not distinct from OLD.vehicle_location then return NEW;end if;
 select * into w from public.vehicle_visit_workflows where entry_id=NEW.id and tenant_id=NEW.tenant_id for update;
 if not found or w.manager_adjustment->>'presence_attested' is distinct from 'true'
  or NEW.vehicle_location=(case w.manager_adjustment->>'presence' when 'in_workshop' then 'داخل الورشة' else 'مع العميل' end) then return NEW;end if;
 m:=w.manager_adjustment;
 -- The integrity guard accepts a system invalidation only through a separate
 -- narrowly checked trigger path, not a caller-controlled skip flag.
 update public.vehicle_visit_workflows set manager_adjustment=jsonb_set(m,'{presence_attested}','false'::jsonb)
  where entry_id=NEW.id and tenant_id=NEW.tenant_id;
 return NEW;
end $$;
create trigger trg_vehicle_visit_manager_presence_changed after update of vehicle_location on public.vehicle_entries
 for each row execute function app_private.clear_vehicle_visit_manager_presence();

create function app_private.vehicle_visit_manager_stage_dates(e public.vehicle_entries,w public.vehicle_visit_workflows)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare dates jsonb:='{}'::jsonb; name text; at_time timestamptz; event_revision integer; effective_revision integer; m jsonb:=coalesce(w.manager_adjustment,'{}'); c public.insurance_claims; j public.job_orders; baseline_revision integer;
begin
 baseline_revision:=case when m->>'dates_revision' ~ '^[0-9]+$' then (m->>'dates_revision')::integer else -1 end;
 select * into c from public.insurance_claims where id=coalesce(e.insurance_claim_id,e.converted_claim_id) and tenant_id=e.tenant_id and deleted_at is null;
 select * into j from public.job_orders where id=coalesce(e.work_order_id,e.converted_work_order_id) and tenant_id=e.tenant_id and deleted_at is null;
 foreach name in array array['arrived','approved','in_progress','ready','delivered'] loop
  at_time:=null;event_revision:=-1;
  select t.occurred_at,t.revision into at_time,event_revision from public.vehicle_visit_transitions t
   where t.entry_id=e.id and t.tenant_id=e.tenant_id and t.to_stage=name
    and (t.from_stage is distinct from t.to_stage or t.from_stage is null)
    and coalesce(t.requirements->>'action','')<>'manager_adjustment'
   order by t.revision desc limit 1;
  if name='arrived' and at_time is null then at_time:=(e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat';end if;
  if at_time is null then
   at_time:=case name when 'approved' then coalesce(c.approved_at,c.insurance_approved_at)
    when 'in_progress' then coalesce(j.work_started_at,c.work_started_at)
    when 'ready' then coalesce(j.work_completed_at,c.work_completed_at) else null end;
  end if;
  if name='delivered' then
   select h.delivered_at into at_time from public.vehicle_handover_records h
    where h.tenant_id=e.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized'
    order by h.delivered_at desc,h.created_at desc limit 1;
  else
   effective_revision:=coalesce(event_revision,-1);
   if m->'stage_dates' ? name and effective_revision<=baseline_revision then
    -- A projected pending phase stays pending after a location-only save.
    at_time:=case when jsonb_typeof(m->'stage_dates'->name)='string' then (m->'stage_dates'->>name)::timestamptz else null end;
    effective_revision:=baseline_revision;
   end if;
   -- Re-entering an earlier phase starts its current timeline again. Old later
   -- milestones remain immutable history, not future milestones of this cycle.
   if exists(select 1 from public.vehicle_visit_transitions t where t.entry_id=e.id and t.tenant_id=e.tenant_id
     and t.revision>effective_revision and t.from_stage is not null and t.from_stage is distinct from t.to_stage
     and t.to_stage in ('arrived','approved','in_progress','ready')
     and public.vehicle_visit_stage_rank(t.to_stage)<public.vehicle_visit_stage_rank(name)
     and coalesce(t.requirements->>'action','')<>'manager_adjustment') then at_time:=null;end if;
  end if;
  dates:=dates||jsonb_build_object(name,at_time);
 end loop;
 return dates;
end $$;

create function app_private.vehicle_visit_manager_context(p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare e public.vehicle_entries; w public.vehicle_visit_workflows; stage_name text; inside text; review boolean; signed boolean; editable boolean;
begin
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=public.get_user_tenant_id() and deleted_at is null;
 if not found or e.vehicle_id is null then raise exception 'VEHICLE_VISIT_MANAGER_NOT_FOUND';end if;
 select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=e.tenant_id;
 stage_name:=coalesce(w.stage,public.vehicle_visit_evidence_stage(e.id),'arrived');
 inside:=case e.vehicle_location when 'داخل الورشة' then 'in_workshop' when 'مع العميل' then 'with_customer' else null end;
 review:=exists(select 1 from public.vehicle_review_returns r where r.return_entry_id=e.id and r.tenant_id=e.tenant_id);
 signed:=exists(select 1 from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and s.intake_revision=e.intake_revision);
 editable:=stage_name in ('arrived','approved','in_progress','ready') and e.status not in ('Cancelled','Draft') and inside is not null
  and not exists(select 1 from public.vehicle_handover_records h where h.tenant_id=e.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized');
 return jsonb_build_object('entry_id',e.id,'tenant_id',e.tenant_id,'vehicle_id',e.vehicle_id,'stage',stage_name,
  'presence',coalesce(inside,'with_customer'),'workflow_revision',coalesce(w.revision,0),'entry_updated_at',e.updated_at,
  'stage_dates',app_private.vehicle_visit_manager_stage_dates(e,w),'editable',editable,'is_review',review,'intake_signed',signed,
  'manager_adjustment',nullif(w.manager_adjustment,'{}'::jsonb),'last_changed_at',w.changed_at,
  'available_stages',case when review then jsonb_build_array('arrived','in_progress','ready') else jsonb_build_array('arrived','approved','in_progress','ready') end);
end $$;

create function public.get_vehicle_visit_manager_context(p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=public.get_user_tenant_id()
  and p.account_status='active' and p.disabled_at is null and p.role::text in ('admin','manager')) then
  raise exception 'VEHICLE_VISIT_MANAGER_FORBIDDEN' using errcode='42501';end if;
 return app_private.vehicle_visit_manager_context(p_entry_id);
end $$;

-- The invoker center page may read operational dates through this UUID-only
-- bridge. Caller composites/tenant IDs are never accepted by privileged code.
create function public.vehicle_visit_effective_stage_dates(p_entry_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); e public.vehicle_entries; w public.vehicle_visit_workflows;
begin
 if actor is null or tenant is null or not exists(select 1 from public.profiles p
  where p.user_id=actor and p.tenant_id=tenant and p.account_status='active' and p.disabled_at is null
   and p.role::text in ('admin','manager','supervisor','technician','insurance')) then
  raise exception 'VEHICLE_VISIT_MANAGER_FORBIDDEN' using errcode='42501';
 end if;
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=tenant and deleted_at is null;
 if not found then raise exception 'VEHICLE_VISIT_MANAGER_NOT_FOUND';end if;
 select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=tenant;
 if not found or w.vehicle_id is distinct from e.vehicle_id
  or w.manager_adjustment->>'version' is distinct from '1'
  or w.manager_adjustment->>'entry_id' is distinct from e.id::text
  or w.manager_adjustment->>'tenant_id' is distinct from e.tenant_id::text
  or w.manager_adjustment->>'vehicle_id' is distinct from e.vehicle_id::text then return null;end if;
 return app_private.vehicle_visit_manager_stage_dates(e,w);
end $$;
revoke all on function public.vehicle_visit_effective_stage_dates(uuid) from public,anon,authenticated,service_role;
grant execute on function public.vehicle_visit_effective_stage_dates(uuid) to authenticated;

create function public.adjust_vehicle_visit_manager(
 p_entry_id uuid,p_expected_revision integer,p_expected_updated_at timestamptz,
 p_target_stage text,p_presence text,p_stage_dates jsonb,p_presence_occurred_at timestamptz,
 p_reason text,p_request_id uuid
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid();tenant uuid:=public.get_user_tenant_id(); e public.vehicle_entries; w public.vehicle_visit_workflows;
 c public.insurance_claims; j public.job_orders; release_row public.vehicle_inspection_releases; old_context jsonb; prior_request public.vehicle_visit_transitions;
 dates jsonb; name text; at_time timestamptz; previous_time timestamptz; min_arrival timestamptz; custody_floor timestamptz; recorded timestamptz:=clock_timestamp();
 m jsonb; request_payload jsonb; previous_request text; previous_manual text; review boolean; next_revision integer;
begin
 if actor is null or tenant is null or not exists(select 1 from public.profiles p where p.user_id=actor and p.tenant_id=tenant
  and p.account_status='active' and p.disabled_at is null and p.role::text in ('admin','manager')) then raise exception 'VEHICLE_VISIT_MANAGER_FORBIDDEN' using errcode='42501';end if;
 if p_request_id is null or p_expected_revision is null or p_expected_revision<0 or p_expected_updated_at is null then raise exception 'VEHICLE_VISIT_MANAGER_IDENTITY';end if;
 if p_target_stage is null or p_presence is null or p_target_stage not in ('arrived','approved','in_progress','ready') or p_presence not in ('in_workshop','with_customer') then raise exception 'VEHICLE_VISIT_MANAGER_STAGE_INVALID';end if;
 if length(trim(coalesce(p_reason,''))) not between 8 and 1000 then raise exception 'VEHICLE_VISIT_MANAGER_REASON_REQUIRED';end if;
 if jsonb_typeof(p_stage_dates) is distinct from 'object' or pg_column_size(p_stage_dates)>4096
  or exists(select 1 from jsonb_object_keys(p_stage_dates) k where k not in ('arrived','approved','in_progress','ready')) then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end if;
 if p_presence_occurred_at is null or not isfinite(p_presence_occurred_at) or p_presence_occurred_at>recorded+interval '5 minutes' then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':manager-visit:'||p_entry_id::text,0));
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=tenant and deleted_at is null for update;
 if not found or e.vehicle_id is null then raise exception 'VEHICLE_VISIT_MANAGER_NOT_FOUND';end if;
 perform pg_advisory_xact_lock(hashtextextended(tenant::text||':'||e.vehicle_id::text,0));
 request_payload:=jsonb_build_object('expected_revision',p_expected_revision,'expected_updated_at',p_expected_updated_at,
  'target_stage',p_target_stage,'presence',p_presence,'stage_dates',p_stage_dates,'presence_occurred_at',p_presence_occurred_at,'reason',trim(p_reason));
 select * into prior_request from public.vehicle_visit_transitions t where t.tenant_id=tenant and t.entry_id=e.id
  and t.requirements->>'action'='manager_adjustment' and t.requirements->>'request_id'=p_request_id::text;
 if found then
  if prior_request.recorded_by is distinct from actor or prior_request.requirements->'request_payload' is distinct from request_payload then raise exception 'VEHICLE_VISIT_MANAGER_REQUEST_CONFLICT';end if;
  return app_private.vehicle_visit_manager_context(e.id);
 end if;
 select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=tenant for update;
 if coalesce(w.revision,0)<>p_expected_revision or e.updated_at is distinct from p_expected_updated_at then raise exception 'VEHICLE_VISIT_MANAGER_STALE' using errcode='40001';end if;
 old_context:=app_private.vehicle_visit_manager_context(e.id);
 if (old_context->>'editable')::boolean is distinct from true then raise exception 'VEHICLE_VISIT_MANAGER_TERMINAL';end if;
 if public.vehicle_visit_has_conflicting_entry(e.id) then raise exception 'VEHICLE_VISIT_MANAGER_CONFLICT';end if;
 if (e.insurance_claim_id is not null and e.converted_claim_id is not null and e.insurance_claim_id<>e.converted_claim_id)
  or (e.work_order_id is not null and e.converted_work_order_id is not null and e.work_order_id<>e.converted_work_order_id) then raise exception 'VEHICLE_VISIT_MANAGER_CONFLICT';end if;
 review:=(old_context->>'is_review')::boolean;
 if review and app_private.review_visit_context(e.id) is null then raise exception 'VEHICLE_VISIT_MANAGER_CONFLICT';end if;
 if review and p_target_stage='approved' and p_target_stage is distinct from old_context->>'stage' then raise exception 'VEHICLE_VISIT_MANAGER_REVIEW_APPROVAL_NOT_REQUIRED';end if;
 if review and p_target_stage is distinct from old_context->>'stage' and p_target_stage in ('in_progress','ready')
  and (old_context->>'intake_signed')::boolean is distinct from true then raise exception 'VEHICLE_VISIT_MANAGER_REVIEW_SIGNATURE_REQUIRED';end if;
 if coalesce(e.insurance_claim_id,e.converted_claim_id) is not null then
  select * into c from public.insurance_claims where id=coalesce(e.insurance_claim_id,e.converted_claim_id) and tenant_id=tenant and deleted_at is null for update;
  if not found or c.vehicle_id is distinct from e.vehicle_id or c.customer_id is distinct from e.customer_id
   or c.status::text in ('cancelled','rejected') or c.delivered_at is not null or c.vehicle_delivered_at is not null then raise exception 'VEHICLE_VISIT_MANAGER_CONFLICT';end if;
 end if;
 if coalesce(e.work_order_id,e.converted_work_order_id) is not null then
  select * into j from public.job_orders where id=coalesce(e.work_order_id,e.converted_work_order_id) and tenant_id=tenant and deleted_at is null for update;
  if not found or j.vehicle_id is distinct from e.vehicle_id or j.customer_id is distinct from e.customer_id
   or j.claim_id is distinct from c.id or j.status::text in ('delivered','cancelled','canceled','closed') or j.vehicle_delivered_at is not null then raise exception 'VEHICLE_VISIT_MANAGER_CONFLICT';end if;
 end if;
 if not review and p_target_stage='approved' and w.stage is distinct from 'approved' then
  if c.id is not null then
   if c.status::text not in ('approved','paid') then raise exception 'VEHICLE_VISIT_MANAGER_APPROVAL_REQUIRED';end if;
  elsif e.insurance_company_id is not null or nullif(trim(e.insurance_snapshot->>'claim_number'),'') is not null
   or nullif(trim(e.insurance_snapshot->>'company_name'),'') is not null or j.work_order_type='insurance' then
   raise exception 'VEHICLE_VISIT_MANAGER_APPROVAL_REQUIRED';
  elsif j.id is null or not exists(select 1 from public.vehicle_visit_transitions t where t.entry_id=e.id and t.tenant_id=tenant
    and t.to_stage='approved' and coalesce(t.requirements->>'customer_approved','false')='true') then
   raise exception 'VEHICLE_VISIT_MANAGER_APPROVAL_REQUIRED';
  end if;
 end if;
 dates:=old_context->'stage_dates';previous_time:=null;
 foreach name in array array['arrived','approved','in_progress','ready'] loop
  if p_stage_dates ? name and p_stage_dates->name<>'null'::jsonb then
   if jsonb_typeof(p_stage_dates->name)<>'string' then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end if;
   begin at_time:=(p_stage_dates->>name)::timestamptz;exception when others then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end;
   dates:=dates||jsonb_build_object(name,at_time);
  end if;
  at_time:=case when dates->name='null'::jsonb then null else (dates->>name)::timestamptz end;
  if at_time is not null then
   if not isfinite(at_time) or at_time>recorded+interval '5 minutes' then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end if;
   if previous_time is not null and at_time<previous_time then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
   previous_time:=at_time;
  end if;
 end loop;
 if dates->>p_target_stage is null then raise exception 'VEHICLE_VISIT_MANAGER_TARGET_DATE_REQUIRED';end if;
 min_arrival:=(dates->>'arrived')::timestamptz;
 if min_arrival is null or p_presence_occurred_at<min_arrival then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
 -- Phase corrections do not rewrite real custody chronology. A movement may
 -- not precede the attested location it leaves, or signed release/return events.
 custody_floor:=null;
 if p_presence is distinct from old_context->>'presence' and app_private.vehicle_visit_manager_presence(e,w) is not null then
  custody_floor:=(w.manager_adjustment->>'presence_occurred_at')::timestamptz;
 end if;
 select greatest(custody_floor,max(greatest(r.released_at,r.returned_at))) into custody_floor
  from public.vehicle_inspection_releases r where r.tenant_id=tenant and r.vehicle_entry_id=e.id and r.status='signed';
 select greatest(custody_floor,max(t.occurred_at)) into custody_floor from public.vehicle_visit_transitions t
  where t.tenant_id=tenant and t.entry_id=e.id and t.requirements->>'action' in ('actual_arrival','temporary_return');
 if p_presence_occurred_at<custody_floor then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
 if review and exists(select 1 from public.vehicle_review_returns r join public.vehicle_handover_records h on h.id=r.source_handover_id and h.tenant_id=r.tenant_id
  where r.tenant_id=tenant and r.return_entry_id=e.id and h.status='finalized' and h.delivered_at>min_arrival) then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
 if w.entry_id is null then
  insert into public.vehicle_visit_workflows(entry_id,tenant_id,vehicle_id,stage,changed_by)
   values(e.id,tenant,e.vehicle_id,old_context->>'stage',actor) returning * into w;
  insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source)
   values(tenant,e.id,0,null,w.stage,(e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat',actor,actor,'entry');
 end if;
 next_revision:=w.revision+1;
 m:=jsonb_build_object('version',1,'entry_id',e.id,'tenant_id',tenant,'vehicle_id',e.vehicle_id,'request_id',p_request_id,
  'actor_id',actor,'recorded_at',recorded,'txid',txid_current()::text,'reason',trim(p_reason),
  'stage_override',p_target_stage is distinct from w.stage or coalesce((w.manager_adjustment->>'stage_override')::boolean,false),
  'stage',p_target_stage,'stage_revision',next_revision,'stage_dates',dates-'delivered','dates_revision',next_revision,
  'presence_attested',true,'presence',p_presence,'presence_occurred_at',p_presence_occurred_at);
 previous_request:=current_setting('app.vehicle_visit_manager_request',true);previous_manual:=current_setting('app.vehicle_visit_manual_transition',true);
 perform set_config('app.vehicle_visit_manager_request',p_request_id::text,true);
 perform set_config('app.vehicle_visit_manual_transition','on',true);
 -- Preserve the normal approval trigger on real stage changes; date/location
 -- corrections in the same stage do not run UPDATE OF stage triggers.
 if w.stage is distinct from p_target_stage then
  update public.vehicle_visit_workflows set stage=p_target_stage,revision=next_revision,changed_at=recorded,changed_by=actor,review_reason=null,manager_adjustment=m
   where entry_id=e.id and tenant_id=tenant returning * into w;
 else
  update public.vehicle_visit_workflows set revision=next_revision,changed_at=recorded,changed_by=actor,review_reason=null,manager_adjustment=m
   where entry_id=e.id and tenant_id=tenant returning * into w;
 end if;
 if p_presence='in_workshop' then
  for release_row in select * from public.vehicle_inspection_releases where tenant_id=tenant and vehicle_entry_id=e.id and status='signed' and returned_at is null for update loop
   if release_row.released_at is null or p_presence_occurred_at<release_row.released_at then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
   update public.vehicle_inspection_releases set returned_at=p_presence_occurred_at,returned_by=actor,updated_at=recorded where id=release_row.id and tenant_id=tenant;
   insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value,reason)
    values(tenant,e.id,actor,'vehicle_inspection_release.manager_return',jsonb_build_object('release_id',release_row.id,'returned_at',p_presence_occurred_at,'request_id',p_request_id),trim(p_reason));
  end loop;
 end if;
 update public.vehicle_entries set vehicle_location=case p_presence when 'in_workshop' then 'داخل الورشة' else 'مع العميل' end,
  vehicle_location_bay=case when p_presence='in_workshop' then vehicle_location_bay else null end,updated_at=recorded,updated_by=actor
  where id=e.id and tenant_id=tenant;
 -- Review entries intentionally have no source financial FKs. Never change
 -- their original claim/order custody or reopen historical accounting.
 if not review then
  update public.insurance_claims set vehicle_presence_status=p_presence,vehicle_location_section=case when p_presence='in_workshop' then vehicle_location_section else null end,
   vehicle_location_bay=case when p_presence='in_workshop' then vehicle_location_bay else null end,
   vehicle_location_updated_at=recorded,vehicle_location_updated_by=actor,updated_at=recorded where id=c.id and tenant_id=tenant;
  update public.job_orders set vehicle_presence_status=p_presence,vehicle_location_section=case when p_presence='in_workshop' then vehicle_location_section else null end,
   vehicle_location_bay=case when p_presence='in_workshop' then vehicle_location_bay else null end,updated_at=recorded where id=j.id and tenant_id=tenant;
  update public.claim_work_order_operations set vehicle_presence_status=p_presence,vehicle_location_section=case when p_presence='in_workshop' then vehicle_location_section else null end,
   vehicle_location_bay=case when p_presence='in_workshop' then vehicle_location_bay else null end,
   vehicle_location_updated_at=recorded,vehicle_location_updated_by=actor,updated_at=recorded,last_changed_from='system',last_changed_by=actor
   where tenant_id=tenant and ((c.id is not null and claim_id=c.id) or (j.id is not null and work_order_id=j.id));
 end if;
 insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source,reason,requirements)
  values(tenant,e.id,next_revision,old_context->>'stage',p_target_stage,p_presence_occurred_at,actor,actor,'manual',trim(p_reason),
   jsonb_build_object('action','manager_adjustment','request_id',p_request_id,'request_payload',request_payload,'old_values',old_context,
    'new_stage',p_target_stage,'new_presence',p_presence,'stage_dates',dates,'presence_occurred_at',p_presence_occurred_at));
 insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,old_value,new_value,reason)
  values(tenant,e.id,actor,'vehicle_visit.manager_adjustment',old_context,app_private.vehicle_visit_manager_context(e.id),trim(p_reason));
 perform set_config('app.vehicle_visit_manager_request',coalesce(previous_request,''),true);
 perform set_config('app.vehicle_visit_manual_transition',coalesce(previous_manual,''),true);
 return app_private.vehicle_visit_manager_context(e.id);
end $$;

revoke all on function app_private.vehicle_visit_manager_presence(public.vehicle_entries,public.vehicle_visit_workflows),
 app_private.vehicle_visit_manager_stage_active(public.vehicle_entries,public.vehicle_visit_workflows),
 app_private.guard_vehicle_visit_manager_adjustment(),app_private.clear_vehicle_visit_manager_presence(),
 app_private.vehicle_visit_manager_stage_dates(public.vehicle_entries,public.vehicle_visit_workflows),
 app_private.vehicle_visit_manager_context(uuid) from public,anon,authenticated,service_role;
revoke all on function public.get_vehicle_visit_manager_context(uuid),
 public.adjust_vehicle_visit_manager(uuid,integer,timestamptz,text,text,jsonb,timestamptz,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_vehicle_visit_manager_context(uuid),
 public.adjust_vehicle_visit_manager(uuid,integer,timestamptz,text,text,jsonb,timestamptz,text,uuid) to authenticated;

-- Every canonical handover path keeps its existing receipt/signature guards.
-- A newly finalized handover must also honor manager-corrected operational
-- dates and actual custody; historical finalized documents are never changed.
create function app_private.guard_vehicle_handover_manager_time()
returns trigger language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; w public.vehicle_visit_workflows; dates jsonb; latest_at timestamptz; floor_at timestamptz;
begin
 if OLD.status='finalized' or NEW.status is distinct from 'finalized' then return NEW;end if;
 select * into e from public.vehicle_entries where id=NEW.vehicle_entry_id and tenant_id=NEW.tenant_id for update;
 if not found then return NEW;end if;
 select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=e.tenant_id for update;
 if not found or w.vehicle_id is distinct from e.vehicle_id
  or w.manager_adjustment->>'version' is distinct from '1'
  or w.manager_adjustment->>'entry_id' is distinct from e.id::text
  or w.manager_adjustment->>'tenant_id' is distinct from e.tenant_id::text
  or w.manager_adjustment->>'vehicle_id' is distinct from e.vehicle_id::text then return NEW;end if;
 dates:=app_private.vehicle_visit_manager_stage_dates(e,w);
 select x.occurred_at into latest_at from public.vehicle_visit_transitions x
  where x.entry_id=e.id and x.tenant_id=e.tenant_id order by x.revision desc limit 1;
 floor_at:=greatest((dates->>'arrived')::timestamptz,(dates->>w.stage)::timestamptz,(dates->>'ready')::timestamptz,
  case when app_private.vehicle_visit_manager_presence(e,w) is not null
   then (w.manager_adjustment->>'presence_occurred_at')::timestamptz else null end,latest_at);
 if NEW.delivered_at is null or not isfinite(NEW.delivered_at) or NEW.delivered_at<floor_at then
  raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';
 end if;
 return NEW;
end $$;
revoke all on function app_private.guard_vehicle_handover_manager_time() from public,anon,authenticated,service_role;
create trigger trg_vehicle_handover_manager_time before update of status on public.vehicle_handover_records
 for each row when(OLD.status is distinct from 'finalized' and NEW.status='finalized')
 execute function app_private.guard_vehicle_handover_manager_time();











-- Guarded compatibility patches captured from Development before this migration.

-- BEFORE row triggers cannot read NEW stored generated values. Guard the exact
-- non-writable outputs; every writable financial input remains in row equality.
do $manager_generated_schema$
begin
 if (select jsonb_object_agg(a.attname,jsonb_build_object('stored',a.attgenerated='s','expression',pg_get_expr(d.adbin,d.adrelid)))
   from pg_catalog.pg_attribute a join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
   where a.attrelid='public.job_orders'::regclass and a.attname in ('subtotal','vat','final_total') and not a.attisdropped)
   is distinct from '{"subtotal":{"stored":true,"expression":"(labor_cost + parts_cost)"},"vat":{"stored":true,"expression":"((labor_cost + parts_cost) * 0.05)"},"final_total":{"stored":true,"expression":"((labor_cost + parts_cost) * 1.05)"}}'::jsonb then
  raise exception 'VEHICLE_VISIT_MANAGER_FINANCIAL_SCHEMA_DRIFT';
 end if;
end $manager_generated_schema$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('app_private.advance_review_visit(uuid,integer,text,timestamptz,text,text,uuid)'::regprocedure) into definition;
 if md5(definition)<>'7280ffcf75ab66bbba7b40dfab111277' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: advance_review_visit';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION app_private.advance_review_visit(p_entry uuid, p_revision integer, p_target text, p_at timestamp with time zone, p_notes text, p_reason text, p_responsible uuid)
 RETURNS vehicle_visit_workflows
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 or p_at<coalesce((app_private.vehicle_visit_manager_stage_dates(e,w)->>'arrived')::timestamptz,'-infinity'::timestamptz)
 or p_at<coalesce((app_private.vehicle_visit_manager_stage_dates(e,w)->>w.stage)::timestamptz,'-infinity'::timestamptz)
 or p_at<coalesce((case when app_private.vehicle_visit_manager_presence(e,w) is not null then (w.manager_adjustment->>'presence_occurred_at')::timestamptz else null end),'-infinity'::timestamptz)
 or p_at<coalesce((select occurred_at from public.vehicle_visit_transitions where entry_id=e.id order by revision desc limit 1),'-infinity'::timestamptz)
 then raise exception 'VEHICLE_VISIT_TIME_INVALID'; end if;
 if length(coalesce(p_notes,''))>2000 or length(coalesce(p_reason,''))>1000 then raise exception 'VEHICLE_VISIT_DETAILS_TOO_LONG'; end if;
 if not exists(select 1 from public.profiles where user_id=coalesce(p_responsible,actor) and tenant_id=tenant and account_status='active' and disabled_at is null) then raise exception 'VEHICLE_VISIT_RESPONSIBLE_INVALID'; end if;
 if p_target<>'cancelled' and not exists(select 1 from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and s.intake_revision=e.intake_revision) then raise exception 'REVIEW_RETURN_SIGNATURE_REQUIRED';end if;
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
end $function$
$manager_definition$;
end $manager_patch$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('public.advance_vehicle_visit(uuid,integer,text,timestamptz,text,text,uuid,jsonb)'::regprocedure) into definition;
 if md5(definition)<>'e82c412f44d4ae392b1b1f46c620f8df' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: advance_vehicle_visit';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION public.advance_vehicle_visit(p_entry_id uuid, p_expected_revision integer, p_target_stage text, p_occurred_at timestamp with time zone, p_notes text DEFAULT NULL::text, p_reason text DEFAULT NULL::text, p_responsible_user_id uuid DEFAULT NULL::uuid, p_requirements jsonb DEFAULT '{}'::jsonb)
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
  -- Retain the canonical event floor; manager milestone corrections must
  -- also constrain the next actual phase without changing source accounting.
  if (v_previous_time is not null and p_occurred_at < v_previous_time)
    or (v_state.manager_adjustment->>'version'='1'
      and v_state.manager_adjustment->>'entry_id'=v_entry.id::text
      and v_state.manager_adjustment->>'tenant_id'=v_entry.tenant_id::text
      and v_state.manager_adjustment->>'vehicle_id'=v_entry.vehicle_id::text
      and p_occurred_at < greatest(
        (app_private.vehicle_visit_manager_stage_dates(v_entry,v_state)->>v_state.stage)::timestamptz,
        (app_private.vehicle_visit_manager_stage_dates(v_entry,v_state)->>'arrived')::timestamptz,
        case when app_private.vehicle_visit_manager_presence(v_entry,v_state) is not null
          then (v_state.manager_adjustment->>'presence_occurred_at')::timestamptz else null end)) then
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
$manager_definition$;
end $manager_patch$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('public.sync_vehicle_visit_from_source(uuid,text)'::regprocedure) into definition;
 if md5(definition)<>'5ff2766d71a73203f2c2669394d2a38b' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: sync_vehicle_visit_from_source';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION public.sync_vehicle_visit_from_source(p_entry_id uuid, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Manager stage correction remains authoritative until an intentional
  -- transition; real signed terminal evidence still wins.
  if v_has_state and v_evidence not in ('delivered','cancelled')
    and app_private.vehicle_visit_manager_stage_active(v_entry,v_state) then
    if v_state.review_reason='source_regressed' then
      update public.vehicle_visit_workflows set review_reason=null where entry_id=p_entry_id;
    end if;
    return;
  end if;
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
    case when v_evidence='delivered' then coalesce((select h.delivered_at from public.vehicle_handover_records h
      where h.tenant_id=v_entry.tenant_id and h.vehicle_entry_id=p_entry_id and h.status='finalized'
      order by h.delivered_at desc,h.created_at desc limit 1),now()) else now() end,
    auth.uid(), auth.uid(), p_source);
end;
$function$
$manager_definition$;
end $manager_patch$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('app_private.custody_guard_exit_projection()'::regprocedure) into definition;
 if md5(definition)<>'ef42b0ffdc7e694b2ec920b78d5ee96c' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: custody_guard_exit_projection';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION app_private.custody_guard_exit_projection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare n jsonb:=to_jsonb(NEW); o jsonb:=to_jsonb(OLD); e_id uuid; exiting boolean;
begin
 if TG_TABLE_NAME='vehicle_entries' then
  exiting:=n->>'vehicle_location'='مع العميل' and o->>'vehicle_location' is distinct from n->>'vehicle_location';
  e_id:=NEW.id;
 else
  exiting:=((n->>'vehicle_presence_status'='with_customer' and o->>'vehicle_presence_status' is distinct from n->>'vehicle_presence_status')
   or (n->>'vehicle_delivered_at' is not null and o->>'vehicle_delivered_at' is distinct from n->>'vehicle_delivered_at')
   or (TG_TABLE_NAME='job_orders' and n->>'status'='delivered' and o->>'status' is distinct from n->>'status')
   or (TG_TABLE_NAME='insurance_claims' and ((n->>'delivered_at' is not null and o->>'delivered_at' is distinct from n->>'delivered_at') or (n->>'repair_stage'='delivered' and o->>'repair_stage' is distinct from n->>'repair_stage'))));
  e_id:=(n->>'vehicle_entry_id')::uuid;
 end if;
 if not coalesce(exiting,false) then return NEW; end if;
 if e_id is null then raise exception 'CUSTODY_ENTRY_REQUIRED'; end if;
 -- Only this transaction's authenticated manager correction can attest an
 -- administrative custody movement. Never accepts delivery, accounting, stage
 -- or any signed-form mutation through this branch.
 if n->>'vehicle_delivered_at' is not distinct from o->>'vehicle_delivered_at'
  and n->>'delivered_at' is not distinct from o->>'delivered_at'
  and n->>'status' is not distinct from o->>'status'
  and n->>'repair_stage' is not distinct from o->>'repair_stage'
  and (case TG_TABLE_NAME
   when 'vehicle_entries' then n-array['vehicle_location','vehicle_location_bay','updated_at','updated_by']=o-array['vehicle_location','vehicle_location_bay','updated_at','updated_by']
   when 'insurance_claims' then n-array['vehicle_presence_status','vehicle_location_section','vehicle_location_bay','vehicle_location_updated_at','vehicle_location_updated_by','updated_at']=o-array['vehicle_presence_status','vehicle_location_section','vehicle_location_bay','vehicle_location_updated_at','vehicle_location_updated_by','updated_at']
   when 'job_orders' then n-array['vehicle_presence_status','vehicle_location_section','vehicle_location_bay','updated_at','subtotal','vat','final_total']=o-array['vehicle_presence_status','vehicle_location_section','vehicle_location_bay','updated_at','subtotal','vat','final_total']
    and 3=(select count(*) from pg_catalog.pg_attribute a where a.attrelid='public.job_orders'::regclass and a.attname in ('subtotal','vat','final_total') and a.attgenerated='s' and not a.attisdropped) else false end)
  and exists(select 1 from public.vehicle_entries e join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=e.tenant_id
   join public.profiles p on p.user_id=auth.uid() and p.tenant_id=e.tenant_id
   where e.id=e_id and e.tenant_id=NEW.tenant_id and e.deleted_at is null and e.status not in ('Cancelled','Draft')
    and p.account_status='active' and p.disabled_at is null and p.role::text in ('admin','manager')
    and w.stage in ('arrived','approved','in_progress','ready') and w.vehicle_id=e.vehicle_id
    and w.manager_adjustment->>'version'='1' and w.manager_adjustment->>'presence_attested'='true'
    and w.manager_adjustment->>'presence'='with_customer'
    and w.manager_adjustment->>'entry_id'=e.id::text and w.manager_adjustment->>'tenant_id'=e.tenant_id::text
    and w.manager_adjustment->>'vehicle_id'=e.vehicle_id::text
    and w.manager_adjustment->>'stage'=w.stage and w.manager_adjustment->>'stage_revision'=w.revision::text
    and w.manager_adjustment->>'actor_id'=auth.uid()::text and w.manager_adjustment->>'txid'=txid_current()::text
    and w.manager_adjustment->>'request_id'=current_setting('app.vehicle_visit_manager_request',true)
    and (TG_TABLE_NAME<>'job_orders' or coalesce(e.work_order_id,e.converted_work_order_id)=NEW.id)
    and (TG_TABLE_NAME<>'insurance_claims' or coalesce(e.insurance_claim_id,e.converted_claim_id)=NEW.id)
    and not exists(select 1 from public.vehicle_handover_records h where h.vehicle_entry_id=e.id and h.tenant_id=e.tenant_id and h.status='finalized')) then return NEW;end if;
 -- A signed temporary inspection release changes custody, never final delivery.
 if (TG_TABLE_NAME='vehicle_entries' or
   (n->>'vehicle_delivered_at' is null and n->>'delivered_at' is null
    and n->>'status' is not distinct from o->>'status'
    and n->>'repair_stage' is not distinct from o->>'repair_stage'))
 and exists(select 1 from public.vehicle_inspection_releases r where r.tenant_id=NEW.tenant_id and r.vehicle_entry_id=e_id
  and r.status='signed' and r.returned_at is null and r.released_at>=transaction_timestamp()
  and (nullif(r.signature_data_url,'') is not null or r.entry_snapshot#>>'{release_acknowledgement,method}'='paper')
  and (TG_TABLE_NAME='vehicle_entries' or n->>'temporary_inspection_release_id'=r.id::text)
  and (TG_TABLE_NAME<>'job_orders' or r.work_order_id=NEW.id)
  and (TG_TABLE_NAME<>'insurance_claims' or r.claim_id=NEW.id)) then return NEW;end if;

 if not exists(select 1 from public.vehicle_handover_records h
  where h.tenant_id=NEW.tenant_id and h.vehicle_entry_id=e_id and h.status='finalized'
   and h.finalized_at=transaction_timestamp() and h.finalized_by=auth.uid()
   and (TG_TABLE_NAME<>'job_orders' or h.work_order_id=NEW.id)
   and (TG_TABLE_NAME<>'insurance_claims' or h.claim_id=NEW.id)
   and (exists(select 1 from public.vehicle_entry_custody_receipts c where c.handover_id=h.id and c.tenant_id=h.tenant_id and c.vehicle_entry_id=e_id and c.status='used')
    or exists(select 1 from public.vehicle_entry_custody_audit a where a.tenant_id=h.tenant_id and a.vehicle_entry_id=e_id and a.action='legacy_delivery_exception' and a.details->>'handover_id'=h.id::text))) then
  raise exception 'CUSTODY_RECEIPT_REQUIRED';
 end if;
 return NEW;
end $function$
$manager_definition$;
end $manager_patch$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('public.vehicle_visit_center_resolve_v1(jsonb,jsonb,boolean,boolean,text)'::regprocedure) into definition;
 if md5(definition)<>'f9e9c63dd73a9af8a576a624faabb218' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: vehicle_visit_center_resolve_v1';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION public.vehicle_visit_center_resolve_v1(e jsonb, w jsonb, final_handover boolean, temporary_release boolean, evidence_stage text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  c jsonb := coalesce(nullif(e->'claim','null'), nullif(e->'converted_claim','null'), '{}'::jsonb);
  o jsonb := coalesce(nullif(e->'work_order','null'), nullif(e->'converted_work_order','null'), '{}'::jsonb);
  linked_claim text := coalesce(e->>'insurance_claim_id',e->>'converted_claim_id');
  linked_order text := coalesce(e->>'work_order_id',e->>'converted_work_order_id');
  reason text := w->>'review_reason';
  stage text := coalesce(w->>'stage',evidence_stage,'arrived');
  manager_presence text;
  manager_meta jsonb:=coalesce(w->'manager_adjustment','{}'::jsonb);
  operational text;
  presence text;
  tab text;
  arrival timestamptz := ((e->>'arrival_date') || 'T' || left(coalesce(e->>'arrival_time','00:00'),5) || ':00+04:00')::timestamptz;
  delivery_since_arrival boolean;
  delivered_marker boolean;
  cancelled boolean := coalesce(e->>'status'='Cancelled' or c->>'status' in ('cancelled','rejected'), false);
  inside_link boolean := coalesce(c->>'vehicle_presence_status'='in_workshop' or o->>'vehicle_presence_status'='in_workshop',false);
  outside_link boolean := coalesce(c->>'vehicle_presence_status'='with_customer' or o->>'vehicle_presence_status'='with_customer',false);
begin
  -- Stored metadata is writable only by the privileged manager RPC. This
  -- invoker projection intentionally has no privileged helper dependency.
  if stage in ('arrived','approved','in_progress','ready') and not final_handover
   and manager_meta->>'version'='1' and manager_meta->>'presence_attested'='true'
   and manager_meta->>'entry_id'=e->>'id' and manager_meta->>'tenant_id'=e->>'tenant_id'
   and manager_meta->>'vehicle_id'=e->>'vehicle_id'
   and manager_meta->>'presence' in ('in_workshop','with_customer')
   and e->>'vehicle_location'=(case manager_meta->>'presence' when 'in_workshop' then 'داخل الورشة' else 'مع العميل' end) then
   manager_presence:=manager_meta->>'presence';
  end if;
  select coalesce(bool_or(value::timestamptz >= arrival or arrival is null),false)
    into delivery_since_arrival from unnest(array[o->>'vehicle_delivered_at', c->>'vehicle_delivered_at',c->>'delivered_at']) value
    where value is not null;
  delivered_marker := final_handover or delivery_since_arrival or coalesce(o->>'status'='delivered'
    and o->>'vehicle_delivered_at' is null and c->>'vehicle_delivered_at' is null and c->>'delivered_at' is null,false);
  presence := case
    when (e->>'work_order_id' is not null and e->>'converted_work_order_id' is not null and e->>'work_order_id'<>e->>'converted_work_order_id')
      or (e->>'insurance_claim_id' is not null and e->>'converted_claim_id' is not null and e->>'insurance_claim_id'<>e->>'converted_claim_id')
      or (linked_order is not null and o='{}'::jsonb) or (linked_claim is not null and c='{}'::jsonb) then 'needs_review'
    when inside_link and (outside_link or delivery_since_arrival or e->>'vehicle_location'='مع العميل') then 'needs_review'
    when delivery_since_arrival or e->>'vehicle_location'='مع العميل' then 'with_customer'
    when e->>'vehicle_location'='داخل الورشة' and not outside_link then 'in_workshop'
    else 'needs_review' end;

  if manager_presence is not null and presence<>'needs_review' then presence:=manager_presence;end if;
  if coalesce((e->>'_claimOnly')::boolean,false) then
    -- v2 presentation contract only; v1 clients keep their original projection.
    if current_setting('app.vehicle_center_projection_version',true)='2'
      and c->>'status' in ('cancelled','rejected') then
      return jsonb_build_object('stage','cancelled','operationalStage','cancelled',
        'reviewReason','claim_without_entry','centerTab','cancelled','presence',presence);
    end if;
    stage := case
      when c->>'vehicle_id' is null or (o<>'{}'::jsonb and (o->>'claim_id' is distinct from c->>'id'
        or o->>'vehicle_id' is distinct from c->>'vehicle_id' or o->>'work_order_type' is distinct from 'insurance')) then 'needs_review'
      when c->>'status' in ('cancelled','rejected') then 'cancelled'
      when c->>'delivered_at' is not null or c->>'vehicle_delivered_at' is not null or o->>'vehicle_delivered_at' is not null or o->>'status'='delivered'
        then case when c->>'vehicle_presence_status'='with_customer' then 'delivered' else 'needs_review' end
      when o->>'status'='completed' or o->>'work_completed_at' is not null or c->>'work_completed_at' is not null or c->>'repair_stage' in ('ready','quality_check') then 'ready'
      when o->>'status' in ('in_progress','waiting_parts') or o->>'work_started_at' is not null or c->>'work_started_at' is not null or c->>'repair_stage' in ('repairing','in_progress')
        then case when c->>'vehicle_presence_status'='with_customer' then 'needs_review' else 'in_progress' end
      when c->>'status' in ('approved','paid') or c->>'approved_at' is not null or c->>'insurance_approved_at' is not null then 'approved'
      else 'arrived' end;
    return jsonb_build_object('stage',stage,'operationalStage',stage,'reviewReason','claim_without_entry','centerTab',case when stage in ('cancelled','delivered') then stage else 'needs_review' end,'presence',presence);
  end if;

  if e->>'vehicle_id' is null then reason := coalesce(reason,'missing_vehicle'); end if;
  if linked_order is not null and (o='{}'::jsonb or o->>'vehicle_id' is distinct from e->>'vehicle_id') then reason := coalesce(reason,'work_order_link_conflict'); end if;
  if coalesce((e->>'__inferredOrderLink')::boolean,false) then reason := coalesce(reason,'work_order_link_conflict'); end if;
  if coalesce((e->>'__inferredClaimLink')::boolean,false) then reason := coalesce(reason,'claim_link_conflict'); end if;
  if linked_claim is not null and (c='{}'::jsonb or c->>'vehicle_id' is distinct from e->>'vehicle_id') then reason := coalesce(reason,'claim_link_conflict'); end if;
  if o<>'{}'::jsonb and ((linked_claim is not null and (o->>'work_order_type' is distinct from 'insurance' or o->>'claim_id' is distinct from linked_claim))
    or (linked_claim is null and o->>'work_order_type'='insurance')) then reason := coalesce(reason,'work_order_channel_conflict'); end if;
  -- Claim creation is a later explicit step; approval/start guards still enforce it.
  if cancelled and o<>'{}'::jsonb and o->>'status' is distinct from 'delivered' then reason := coalesce(reason,'cancelled_with_active_work_order'); end if;
  if e->>'work_order_id' is not null and e->>'converted_work_order_id' is not null and e->>'work_order_id'<>e->>'converted_work_order_id' then reason := coalesce(reason,'work_order_link_conflict'); end if;
  if e->>'insurance_claim_id' is not null and e->>'converted_claim_id' is not null and e->>'insurance_claim_id'<>e->>'converted_claim_id' then reason := coalesce(reason,'claim_link_conflict'); end if;
  if presence='needs_review' then reason := coalesce(reason,'custody_conflict'); end if;
  if delivered_marker and not final_handover and (reason is null or reason='custody_conflict') then reason := 'delivery_without_signed_handover'; end if;
  if w->>'stage'='delivered' and not final_handover then reason := coalesce(reason,'delivery_without_signed_handover'); end if;
  if presence='with_customer' and manager_presence is null and not final_handover and not temporary_release and c->>'cancelled_handover_signed_at' is null
    and not (coalesce(e#>>'{vehicle_condition,arrival_confirmation}','')='pending'
      and coalesce(e#>>'{vehicle_condition,visit_purpose}','')='inspection' and e->>'vehicle_location'='مع العميل') then reason := coalesce(reason,'exit_without_signed_release'); end if;
  if w is null or w='null'::jsonb then
    -- The canonical evidence function remains the baseline; finalized handover
    -- projection and inferred links are display-only, never sync/backfill calls.
    stage := case when cancelled then 'cancelled' when final_handover and delivered_marker then 'delivered'
      when o->>'status' in ('completed','delivered') or o->>'work_completed_at' is not null or c->>'work_completed_at' is not null or c->>'repair_stage' in ('ready','quality_check','delivered') then 'ready'
      when o->>'status' in ('in_progress','waiting_parts') or o->>'work_started_at' is not null or c->>'work_started_at' is not null or c->>'repair_stage' in ('repairing','in_progress') then 'in_progress'
      when c->>'status' in ('approved','paid') or c->>'approved_at' is not null or c->>'insurance_approved_at' is not null then 'approved'
      else coalesce(evidence_stage,'arrived') end;
  end if;
  operational := case when reason is null then stage else 'needs_review' end;
  if reason is not null then
    operational := case when cancelled then 'cancelled'
      when delivered_marker and (final_handover or outside_link or e->>'vehicle_location'='مع العميل') then 'delivered'
      when o->>'status' in ('completed','delivered') or o->>'work_completed_at' is not null or c->>'work_completed_at' is not null or c->>'repair_stage' in ('ready','quality_check') then 'ready'
      when o->>'status' in ('in_progress','waiting_parts') or o->>'work_started_at' is not null or c->>'work_started_at' is not null or c->>'repair_stage' in ('repairing','in_progress') then 'in_progress'
      else 'needs_review' end;
  end if;
  tab := case when operational in ('delivered','cancelled') then operational
    when reason is not null then 'needs_review' when presence='in_workshop' then 'in_workshop'
    when presence='with_customer' and (manager_presence='with_customer' or temporary_release or
    (e#>>'{vehicle_condition,arrival_confirmation}'='pending' and e#>>'{vehicle_condition,visit_purpose}'='inspection')) then 'with_customer' else 'needs_review' end;
  return jsonb_build_object('stage',case when reason is not null then 'needs_review' else stage end,
    'operationalStage',operational,'reviewReason',reason,'centerTab',tab,'presence',presence,'managerPresenceAttested',manager_presence is not null);
end;
$function$
$manager_definition$;
end $manager_patch$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('public.vehicle_visit_center_page_v3(uuid,text,jsonb,integer,integer)'::regprocedure) into definition;
 if md5(definition)<>'dac505c3a0e73a67ea7840870b47a4b9' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: vehicle_visit_center_page_v3';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION public.vehicle_visit_center_page_v3(p_tenant_id uuid, p_tab text DEFAULT 'in_workshop'::text, p_filters jsonb DEFAULT '{}'::jsonb, p_page integer DEFAULT 1, p_page_size integer DEFAULT 30)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
  -- SECURITY INVOKER is essential: source-table RLS, notably inspection
  -- releases and insurance-company visibility, remains the caller's boundary.
  -- Private projection/helper grants remain revoked. Only the stage-only,
  -- tenant/active-profile guarded evidence bridge has a narrow execute grant.
  if auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or public.get_user_role() is null or public.get_user_role()::text not in ('admin','manager','supervisor','technician','insurance')
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid()
      and p.tenant_id=p_tenant_id and p.account_status='active') then
    raise exception 'VEHICLE_CENTER_TENANT_MISMATCH' using errcode='42501';
  end if;
  if p_tab is null or p_tab not in ('in_workshop','awaiting_arrival','with_customer','delivered','cancelled','needs_review')
    or p_page is null or p_page<1 or p_page_size is null or p_page_size<1 or p_page_size>100
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'VEHICLE_CENTER_INVALID_REQUEST'; end if;
  if coalesce(p_filters->>'channel','all') not in ('all','cash','insurance') then raise exception 'VEHICLE_CENTER_INVALID_REQUEST'; end if;
  with center_rows as materialized (
with center_vehicles as materialized (select * from public.vehicles where tenant_id=p_tenant_id), center_customers as materialized (select * from public.customers where tenant_id=p_tenant_id), center_insurance_companies as materialized (select * from public.insurance_companies where tenant_id=p_tenant_id), center_vehicle_visit_workflows as materialized (select * from public.vehicle_visit_workflows where tenant_id=p_tenant_id), center_vehicle_handover_records as materialized (select * from public.vehicle_handover_records where tenant_id=p_tenant_id), center_vehicle_inspection_releases as materialized (select * from public.vehicle_inspection_releases where tenant_id=p_tenant_id), entries as materialized (
  select e.* from public.vehicle_entries e
  where e.tenant_id=p_tenant_id and p_tenant_id=(select public.get_user_tenant_id())
    and (select auth.uid()) is not null and e.deleted_at is null
), claims as materialized (
  select c.* from public.insurance_claims c
  where c.tenant_id=p_tenant_id and p_tenant_id=(select public.get_user_tenant_id())
    and (select auth.uid()) is not null and c.deleted_at is null
), orders as materialized (
  select o.* from public.job_orders o
  where o.tenant_id=p_tenant_id and p_tenant_id=(select public.get_user_tenant_id())
    and (select auth.uid()) is not null and o.deleted_at is null
), claim_data as (
  select c.id, jsonb_build_object(
    'id',c.id,'tenant_id',c.tenant_id,'vehicle_id',c.vehicle_id,'customer_id',c.customer_id,'claim_number',c.claim_number,
    'status',c.status,'repair_stage',c.repair_stage,'vehicle_presence_status',c.vehicle_presence_status,
    'workshop_arrival_date',c.workshop_arrival_date,'created_at',c.created_at,'approved_at',c.approved_at,'insurance_approved_at',c.insurance_approved_at,
    'work_started_at',c.work_started_at,'work_completed_at',c.work_completed_at,'delivered_at',c.delivered_at,'vehicle_delivered_at',c.vehicle_delivered_at,
    'cancelled_handover_signed_at',c.cancelled_handover_signed_at,'insurance_company',c.insurance_company,
    'vehicle_owner_name',c.vehicle_owner_name,'vehicle_owner_phone',c.vehicle_owner_phone,'vehicle_make',c.vehicle_make,'vehicle_model',c.vehicle_model,'vehicle_plate',c.vehicle_plate,
    'vehicle',case when v.id is null then null else jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'brand',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,'vin_number',v.vin_number) end,
    'customer',case when cu.id is null then null else jsonb_build_object('id',cu.id,'tenant_id',cu.tenant_id,'name',cu.name,'phone',cu.phone) end
  ) payload from claims c
  left join center_vehicles v on v.id=c.vehicle_id and v.tenant_id=p_tenant_id
  left join center_customers cu on cu.id=c.customer_id and cu.tenant_id=p_tenant_id
), order_data as (
  select o.id, jsonb_build_object('id',o.id,'tenant_id',o.tenant_id,'vehicle_id',o.vehicle_id,'claim_id',o.claim_id,
    'vehicle_entry_id',o.vehicle_entry_id,'order_number',o.order_number,'status',o.status,'technician_name',o.technician_name,
    'work_order_type',o.work_order_type,'work_started_at',o.work_started_at,'work_completed_at',o.work_completed_at,
    'vehicle_presence_status',o.vehicle_presence_status,'vehicle_delivered_at',o.vehicle_delivered_at) payload from orders o
), entry_data as (
  select e.id::text item_key, e.arrival_date,
    (to_jsonb(e) - array['declaration_ar','declaration_en','damage_map','vehicle_contents']) || jsonb_build_object(
      'claim',coalesce(cd.payload,reverse_claim.payload),'converted_claim',ccd.payload,
      'work_order',coalesce(od.payload,inferred_order.payload),'converted_work_order',cod.payload,
      '__inferredClaimLink',cd.payload is null and ccd.payload is null and reverse_claim.candidates>0,
      '__inferredOrderLink',e.work_order_id is null and e.converted_work_order_id is null and inferred_order.candidates>0,
      'vehicle',case when v.id is null then null else jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'brand',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,'vin_number',v.vin_number) end,
      'customer',case when cu.id is null then null else jsonb_build_object('id',cu.id,'tenant_id',cu.tenant_id,'name',cu.name,'phone',cu.phone) end,
      'insurance_company',case when ic.id is null then null else jsonb_build_object('id',ic.id,'name',ic.name) end
    ) entry, to_jsonb(w) workflow,
    exists(select 1 from center_vehicle_handover_records h where h.tenant_id=p_tenant_id and h.vehicle_entry_id=e.id
      and h.status='finalized' and h.work_order_id in (e.work_order_id,e.converted_work_order_id)) final_handover,
    exists(select 1 from center_vehicle_inspection_releases r where r.tenant_id=p_tenant_id and r.vehicle_entry_id=e.id
      and r.status='signed' and r.returned_at is null) temporary_release,
    null::text evidence_stage, false claim_only
  from entries e
  left join claim_data cd on cd.id=e.insurance_claim_id
  left join claim_data ccd on ccd.id=e.converted_claim_id
  left join order_data od on od.id=e.work_order_id
  left join order_data cod on cod.id=e.converted_work_order_id
  left join center_vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=p_tenant_id
  left join center_vehicles v on v.id=e.vehicle_id and v.tenant_id=p_tenant_id
  left join center_customers cu on cu.id=e.customer_id and cu.tenant_id=p_tenant_id
  left join center_insurance_companies ic on ic.id=e.insurance_company_id and ic.tenant_id=p_tenant_id
  left join lateral (
    select count(*) candidates,case when count(*)=1 then jsonb_agg(d.payload)->0 end payload from claims c join claim_data d on d.id=c.id
    where c.vehicle_entry_id=e.id and c.vehicle_id=e.vehicle_id
      and e.insurance_claim_id is null and e.converted_claim_id is null
  ) reverse_claim on true
  left join lateral (
    select count(*) candidates, case when count(*)=1 and ((jsonb_agg(d.payload)->0->>'vehicle_entry_id') is null
      or (jsonb_agg(d.payload)->0->>'vehicle_entry_id')=e.id::text) then (jsonb_agg(d.payload)->0) end payload
    from orders o join order_data d on d.id=o.id
    where o.claim_id=coalesce(e.insurance_claim_id,e.converted_claim_id,(reverse_claim.payload->>'id')::uuid)
      and o.vehicle_id=e.vehicle_id and e.work_order_id is null and e.converted_work_order_id is null
  ) inferred_order on true
), claim_only_data as (
  select 'claim:'||c.id item_key,
    (coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat')::date arrival_date,
    jsonb_build_object('id','claim:'||c.id,'tenant_id',c.tenant_id,'_claimOnly',true,'entry_number','',
      'status',c.status,'arrival_date',to_char(coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat','YYYY-MM-DD'),
      'arrival_time',to_char(coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat','HH24:MI'),
      '_arrivalSource',case when c.workshop_arrival_date is null then 'claim_registration' else 'workshop_arrival_date' end,
      'created_at',c.created_at,'vehicle_id',c.vehicle_id,'customer_id',c.customer_id,'insurance_claim_id',c.id,
      'vehicle_location',case when c.vehicle_id is null then null when c.vehicle_presence_status='in_workshop' then 'داخل الورشة' when c.vehicle_presence_status='with_customer' then 'مع العميل' end,
      'claim',d.payload,'work_order',co.payload,
      'vehicle',coalesce(nullif(d.payload->'vehicle','null'),'{}'::jsonb) || jsonb_build_object(
        'tenant_id',c.tenant_id,'brand',coalesce(nullif(d.payload->'vehicle'->>'brand',''),c.vehicle_make,''),
        'model',coalesce(nullif(d.payload->'vehicle'->>'model',''),c.vehicle_model,''),'plate_number',coalesce(nullif(d.payload->'vehicle'->>'plate_number',''),c.vehicle_plate,'')),
      'customer',coalesce(nullif(d.payload->'customer','null'),'{}'::jsonb) || jsonb_build_object('tenant_id',c.tenant_id,
        'name',coalesce(nullif(d.payload->'customer'->>'name',''),c.vehicle_owner_name,''),'phone',coalesce(nullif(d.payload->'customer'->>'phone',''),c.vehicle_owner_phone,'')),
      'vehicle_snapshot',jsonb_build_object('make',c.vehicle_make,'model',c.vehicle_model,'plate_number',c.vehicle_plate),
      'customer_snapshot',jsonb_build_object('name',c.vehicle_owner_name,'phone',c.vehicle_owner_phone),
      'insurance_snapshot',jsonb_build_object('claim_number',c.claim_number,'company_name',c.insurance_company)
    ) entry, null::jsonb workflow, false final_handover, false temporary_release, 'arrived'::text evidence_stage, true claim_only,
    co.candidates>1 duplicate_order
  from claims c join claim_data d on d.id=c.id
  left join lateral (
    select count(*) candidates,case when count(*)=1 then jsonb_agg(od.payload)->0 end payload
    from orders o join order_data od on od.id=o.id where o.claim_id=c.id and o.vehicle_id=c.vehicle_id
  ) co on true
  where not exists(select 1 from entries e where e.insurance_claim_id=c.id or e.converted_claim_id=c.id
    or (c.vehicle_entry_id=e.id and c.vehicle_id=e.vehicle_id
      and (e.insurance_claim_id is null or e.insurance_claim_id=c.id) and (e.converted_claim_id is null or e.converted_claim_id=c.id)
      and (e.insurance_claim_id=c.id or e.converted_claim_id=c.id or
        (select count(*) from claims c2 where c2.vehicle_entry_id=e.id and c2.vehicle_id=e.vehicle_id)=1)))
), raw_rows as (
  select ed.*, false duplicate_order from entry_data ed union all select * from claim_only_data
), projection_batch as materialized (
    select * from public.vehicle_visit_center_projection_batch_v1(p_tenant_id,coalesce((select jsonb_agg(jsonb_build_object(
      'entry',entry,'workflow',workflow,'final_handover',final_handover,'temporary_release',temporary_release))from raw_rows),'[]'::jsonb))
), resolved as materialized (
  select r.*, case
    when coalesce((r.entry->>'_claimOnly')::boolean,false)
      and r.entry->'claim'->>'status' in ('cancelled','rejected') then p.projection || jsonb_build_object(
        'stage','cancelled','operationalStage','cancelled','reviewReason','claim_without_entry','centerTab','cancelled')
    when p.projection->>'centerTab'='with_customer' and r.entry->>'vehicle_location'='مع العميل'
      and not r.temporary_release
      and not coalesce((p.projection->>'managerPresenceAttested')::boolean,false)
      and r.entry#>>'{vehicle_condition,arrival_confirmation}'='pending'
      and r.entry#>>'{vehicle_condition,visit_purpose}'='inspection'
      then jsonb_set(p.projection,'{centerTab}','"awaiting_arrival"'::jsonb)
    else p.projection end as projection
  from raw_rows r join projection_batch p on p.item_key=r.item_key
), duplicates as (
  -- Whole-tenant scope, before filters/pages: a duplicate on another page must
  -- not turn into an apparently valid active arrival on this page.
  select r.*,
    (duplicate_order and projection->>'operationalStage' not in ('delivered','cancelled')) or (entry->>'vehicle_id' is not null and projection->>'operationalStage' not in ('delivered','cancelled')
      and count(*) filter(where projection->>'operationalStage' not in ('delivered','cancelled')) over (
        partition by claim_only,entry->>'vehicle_id',case when claim_only then arrival_date end)>1) duplicate_open
  from resolved r
)
select jsonb_build_object('itemKey',item_key,'entry',entry,'workflow',workflow,'arrivalDate',arrival_date,
    'hasFinalHandover',final_handover,'hasSignedTemporaryRelease',temporary_release,'duplicateOpenVisit',duplicate_open,
    'technician',coalesce(entry->'work_order'->>'technician_name',entry->'converted_work_order'->>'technician_name',''))
  || projection || case when duplicate_open then jsonb_build_object('stage','needs_review','operationalStage','needs_review',
    'reviewReason',coalesce(projection->>'reviewReason','duplicate_open_visit'),'centerTab','needs_review') else '{}'::jsonb end
from duplicates
  ), filtered as materialized (
    select r from center_rows data(r)
    where (coalesce(p_filters->>'search','')='' or position(lower(trim(p_filters->>'search')) in lower(concat_ws(' ',
      r->'entry'->>'entry_number',r->'entry'->'customer'->>'name',r->'entry'->'customer'->>'phone',
      r->'entry'->'customer_snapshot'->>'name',r->'entry'->'customer_snapshot'->>'phone',
      r->'entry'->'vehicle'->>'plate_number',r->'entry'->'vehicle'->>'plate_letters',r->'entry'->'vehicle'->>'vin_number',
      r->'entry'->'vehicle'->>'brand',r->'entry'->'vehicle'->>'model',r->'entry'->'vehicle_snapshot'->>'plate_number',
      r->'entry'->'vehicle_snapshot'->>'vin',r->'entry'->'vehicle_snapshot'->>'make',r->'entry'->'vehicle_snapshot'->>'model',
      r->'entry'->'claim'->>'claim_number',r->'entry'->'converted_claim'->>'claim_number',
      r->'entry'->'work_order'->>'order_number',r->'entry'->'converted_work_order'->>'order_number',
      r->'entry'->'insurance_snapshot'->>'claim_number',r->'entry'->'insurance_snapshot'->>'company_name'))) > 0)

    -- supervisor_channel_filter_v1: same contract as getVehicleVisitBillingKind.
    and (coalesce(p_filters->>'channel','all')='all' or p_filters->>'channel' = case when
      nullif(r->'entry'->>'insurance_claim_id','') is not null
      or nullif(r->'entry'->>'converted_claim_id','') is not null
      or nullif(r->'entry'->>'insurance_company_id','') is not null
      or r->'entry'->'insurance_snapshot'->'is_insurance_related'='true'::jsonb
      or nullif(btrim(r->'entry'->'insurance_snapshot'->>'claim_number'),'') is not null
      or nullif(btrim(r->'entry'->'insurance_snapshot'->>'company_name'),'') is not null
      or coalesce(nullif(r->'entry'->'work_order','null'::jsonb),nullif(r->'entry'->'converted_work_order','null'::jsonb))->>'work_order_type'='insurance'
      then 'insurance' else 'cash' end)
    and (coalesce(p_filters->>'status','all')='all' or r->'entry'->>'status'=p_filters->>'status')
    and (nullif(p_filters->>'from','') is null or (r->>'arrivalDate')::date >= (p_filters->>'from')::date)
    and (nullif(p_filters->>'to','') is null or (r->>'arrivalDate')::date <= (p_filters->>'to')::date)
    and (coalesce(p_filters->>'technician','all')='all' or r->>'technician'=p_filters->>'technician')
    and (coalesce(p_filters->>'location','all')='all' or r->>'presence'=p_filters->>'location')
    and (coalesce((p_filters->>'minDays')::integer,0)<=0 or
      greatest(0,extract(epoch from (now()-((r->>'arrivalDate')||'T00:00:00+04:00')::timestamptz))/86400) >= (p_filters->>'minDays')::integer)
  ), stage_filtered as materialized (
    select r from filtered where coalesce(p_filters->>'stage','all')='all'
      or (p_filters->>'stage'='needs_review' and r->>'reviewReason' is not null)
      or r->>'operationalStage'=p_filters->>'stage'
  ), selected as materialized (
    select r from stage_filtered where r->>'centerTab'=p_tab
  ), page_candidates as materialized (
    select r from selected order by r->>'arrivalDate' desc nulls last,r->'entry'->>'arrival_time' desc nulls last,r->>'itemKey'
    limit p_page_size offset ((p_page::bigint-1)*p_page_size)
  ), page_rows as (
    -- Decorate only the visible page. Signed intake fields, date filters and
    -- sorting keep their original meaning; operational clocks use this map.
    select case when r#>>'{workflow,manager_adjustment,version}'='1'
      and r#>>'{workflow,manager_adjustment,entry_id}'=r#>>'{entry,id}'
      and r#>>'{workflow,manager_adjustment,tenant_id}'=r#>>'{entry,tenant_id}'
      and r#>>'{workflow,manager_adjustment,vehicle_id}'=r#>>'{entry,vehicle_id}'
      then jsonb_set(r,'{workflow,effective_stage_dates}',coalesce(public.vehicle_visit_effective_stage_dates((r#>>'{entry,id}')::uuid),'null'::jsonb))
      else r end r from page_candidates
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(r order by r->>'arrivalDate' desc nulls last,r->'entry'->>'arrival_time' desc nulls last,r->>'itemKey') from page_rows),'[]'::jsonb),
    'page',p_page,'pageSize',p_page_size,'total',(select count(*) from selected),
    'scopeToken',(select md5(coalesce(string_agg(md5(r::text),'' order by r->>'itemKey'),'')) from selected),
    'tabs',(select jsonb_object_agg(tab,(select count(*) from stage_filtered where r->>'centerTab'=tab))
      from unnest(array['in_workshop','awaiting_arrival','with_customer','delivered','cancelled','needs_review']) tab),
    'stages',(select jsonb_object_agg(stage,(select count(*) from filtered where r->>'centerTab'=p_tab
      and (r->>'operationalStage'=stage or (stage='needs_review' and r->>'reviewReason' is not null))))
      from unnest(array['arrived','approved','in_progress','ready','delivered','cancelled','needs_review']) stage),
    'technicians',coalesce((select jsonb_agg(name order by name) from (
      select distinct r->>'technician' name from filtered where r->>'centerTab'=p_tab and nullif(r->>'technician','') is not null
    ) names),'[]'::jsonb),
    'entryCount',(select count(*) from selected where not coalesce((r->'entry'->>'_claimOnly')::boolean,false)),
    'claimOnlyCount',(select count(*) from selected where coalesce((r->'entry'->>'_claimOnly')::boolean,false))
  ) into result;
  return result;
end;
$function$
$manager_definition$;
end $manager_patch$;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('public.vehicle_review_visit_context(uuid)'::regprocedure) into definition;
 if md5(definition)<>'7889fd1f2e6c0d5204de5c5ad4ae10c7' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: vehicle_review_visit_context';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION public.vehicle_review_visit_context(p_entry_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
 if auth.uid() is null or not exists(select 1 from public.vehicle_entries e join public.profiles p on p.tenant_id=e.tenant_id and p.user_id=auth.uid()
 where e.id=p_entry_id and e.tenant_id=public.get_user_tenant_id() and e.deleted_at is null and p.account_status='active' and p.disabled_at is null)
 then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 return app_private.review_visit_context(p_entry_id)||jsonb_build_object('review_findings',(select notes from public.vehicle_visit_transitions where entry_id=p_entry_id and tenant_id=public.get_user_tenant_id() and to_stage='ready' and coalesce(requirements->>'action','')<>'manager_adjustment' order by revision desc limit 1));
end $function$
$manager_definition$;
end $manager_patch$;

-- The portal may show active review work while its original order is delivered.
-- Only live trusted workflow state changes tracking; frozen order consent stays.
create function app_private.vehicle_visit_manager_portal_stage(p_tenant uuid,p_vehicle uuid,p_customer uuid,p_order uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('stage',w.stage,'updated_at',w.changed_at)
 from public.vehicle_entries e join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=e.tenant_id
 where e.tenant_id=p_tenant and e.vehicle_id=p_vehicle and e.customer_id=p_customer and e.deleted_at is null
  and e.status not in ('Cancelled','Draft') and w.stage in ('arrived','approved','in_progress','ready')
  and (coalesce(e.work_order_id,e.converted_work_order_id)=p_order or exists(
    select 1 from public.vehicle_review_returns r join public.vehicle_handover_records h on h.id=r.source_handover_id and h.tenant_id=r.tenant_id
    where r.return_entry_id=e.id and r.tenant_id=e.tenant_id and h.status='finalized' and h.work_order_id=p_order))
  and (app_private.vehicle_visit_manager_stage_active(e,w) or exists(select 1 from public.vehicle_review_returns r where r.return_entry_id=e.id and r.tenant_id=e.tenant_id))
  and not exists(select 1 from public.vehicle_handover_records h where h.vehicle_entry_id=e.id and h.tenant_id=e.tenant_id and h.status='finalized')
 order by e.created_at desc,e.id desc limit 1
$$;
revoke all on function app_private.vehicle_visit_manager_portal_stage(uuid,uuid,uuid,uuid) from public,anon,authenticated,service_role;

do $manager_patch$
declare definition text;
begin
 select pg_get_functiondef('public.customer_vehicle_portal_read(text,text)'::regprocedure) into definition;
 if md5(definition)<>'fcc4440217f681f075f93206d9cfc1d4' then raise exception 'VEHICLE_VISIT_MANAGER_SOURCE_DRIFT: customer_vehicle_portal_read';end if;
 execute $manager_definition$CREATE OR REPLACE FUNCTION public.customer_vehicle_portal_read(p_token text, p_session text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare p public.vehicle_customer_portals;v public.vehicles;c public.customers;entries jsonb;j public.job_orders;cl public.insurance_claims;h public.vehicle_handover_records;order_data jsonb;delivery jsonb;sig public.customer_portal_tokens;consent public.vehicle_customer_order_consents;content jsonb;tracking jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into v from public.vehicles where id=p.vehicle_id and tenant_id=p.tenant_id;
 select * into c from public.customers where id=p.customer_id and tenant_id=p.tenant_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entry_number',e.entry_number,'revision',e.intake_revision,'arrival_date',e.arrival_date,'arrival_time',e.arrival_time,
 'running_status',coalesce(e.vehicle_condition->>'running_status','unknown'),'mileage',e.vehicle_snapshot->'mileage','condition',e.vehicle_condition->>'condition_description','notes',e.vehicle_condition->>'additional_notes',
 'review_reason',e.vehicle_condition#>>'{review_return,reason}','new_damage',e.vehicle_condition->'new_damage','new_damage_notes',e.vehicle_condition->>'new_damage_notes','review_source_entry_id',e.vehicle_condition#>>'{review_return,source_entry_id}',
 'declaration_ar',e.declaration_ar,'declaration_en',e.declaration_en,'signed',s.id is not null,'legacy_signature',s.id is not null and s.intake_revision is null and e.custody_receipt_required is false and e.intake_revision=1,'has_frozen_document',r.id is not null and frozen.id is not null,'signer_name',s.signer_name,'signed_at',s.signed_at,'signature_data_url',s.signature_data_url,'signature_id',s.id,'receipt_id',r.id,
 'signer_id_number',case when frozen.id is not null and s.intake_revision is not null and frozen.snapshot#>>'{delivered_by,full_name}'=s.signer_name then frozen.snapshot#>>'{delivered_by,id_number}' else null end,
 'delivered_by',case when s.id is null then jsonb_build_object('full_name',e.delivered_by->>'full_name','id_number',e.delivered_by->>'id_number')
  when frozen.id is not null then jsonb_build_object('full_name',frozen.snapshot#>>'{delivered_by,full_name}','id_number',case when frozen.snapshot#>>'{delivered_by,full_name}'=s.signer_name then frozen.snapshot#>>'{delivered_by,id_number}' else null end)
  else null end,'receipt_number',r.receipt_number,
 'releases',(select coalesce(jsonb_agg((app_private.portal_release_content(x)||jsonb_build_object('digest',encode(extensions.digest(app_private.portal_release_content(x)::text,'sha256'),'hex'),'id',x.id,'release_number',x.release_number,'status',x.status,'declaration_ar',x.declaration_ar,'declaration_en',x.declaration_en,'released_at',x.released_at,'signer_name',x.signer_name,'signed_at',x.signed_at,'signature_data_url',x.signature_data_url,'recipient_name',x.form_data->>'recipient_name')) order by x.created_at desc),'[]'::jsonb) from public.vehicle_inspection_releases x where x.vehicle_entry_id=e.id and x.tenant_id=p.tenant_id and x.status in ('awaiting_signature','signed'))) order by e.created_at desc),'[]'::jsonb) into entries
 from public.vehicle_entries e left join lateral(select * from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and (s.intake_revision=e.intake_revision or (e.custody_receipt_required is false and e.intake_revision=1 and s.intake_revision is null)) order by case when s.intake_revision=e.intake_revision then 0 else 1 end,s.created_at desc,s.id desc limit 1)s on true
 left join public.vehicle_entry_custody_receipts r on r.signature_id=s.id and r.tenant_id=e.tenant_id
 left join public.vehicle_entry_signed_revisions frozen on frozen.id=r.revision_id and frozen.tenant_id=e.tenant_id and frozen.vehicle_entry_id=e.id and frozen.signature_id=s.id and frozen.revision=e.intake_revision
 where e.tenant_id=p.tenant_id and e.vehicle_id=p.vehicle_id and e.customer_id=p.customer_id and e.deleted_at is null and e.status in ('Received','Issued','Converted to Claim','Converted to Work Order');
 select * into j from public.job_orders where tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null order by created_at desc limit 1;
 if j.id is not null then
 select * into cl from public.insurance_claims where id=j.claim_id and tenant_id=p.tenant_id;
 select * into sig from public.customer_portal_tokens where job_order_id=j.id and tenant_id=p.tenant_id and revoked_at is null;
 order_data:=jsonb_build_object('enabled',case when j.claim_id is null then exists(select 1 from public.vehicle_visit_workflows w join public.vehicle_entries e on e.id=w.entry_id and e.tenant_id=w.tenant_id
  where w.entry_id=j.vehicle_entry_id and w.tenant_id=p.tenant_id and ((not app_private.vehicle_visit_manager_stage_active(e,w) and w.stage in ('approved','in_progress','ready','delivered'))
   or (app_private.vehicle_visit_manager_stage_active(e,w) and exists(select 1 from public.vehicle_visit_transitions x where x.entry_id=e.id and x.tenant_id=e.tenant_id
     and x.to_stage='approved' and x.requirements->>'customer_approved'='true' and coalesce(x.requirements->>'action','')<>'manager_adjustment')))) else cl.status::text in ('approved','paid') end,
 'status',j.status);
 select * into consent from public.vehicle_customer_order_consents where job_order_id=j.id and tenant_id=p.tenant_id and signature_token_id=sig.id and signed_at=sig.signed_at and signature_data_url=sig.signature_data_url and signer_name=sig.signer_name order by signed_at desc,id desc limit 1;
 content:=coalesce(consent.content,app_private.portal_order_content(j));
 order_data:=order_data||content||jsonb_build_object('digest',coalesce(consent.digest,encode(extensions.digest(content::text,'sha256'),'hex')),'signed',consent.job_order_id is not null or sig.signed_at is not null,'legacy_signature',consent.job_order_id is null and sig.signed_at is not null,'signer_name',coalesce(consent.signer_name,sig.signer_name),'signed_at',coalesce(consent.signed_at,sig.signed_at),'signature_data_url',consent.signature_data_url);
 tracking:=jsonb_build_object('stage_key',case j.status::text when 'delivered' then 'delivered' when 'completed' then 'quality' when 'in_progress' then 'in_repair' when 'waiting_parts' then 'parts_in_transit' when 'inspection' then 'inspection' else 'received' end,
 'progress_pct',case j.status::text when 'delivered' then 100 when 'completed' then 90 when 'in_progress' then 70 when 'waiting_parts' then 55 when 'inspection' then 20 else 10 end,'updated_at',j.updated_at,
 'photos',(select coalesce(jsonb_agg(jsonb_build_object('url',coalesce(x->>'url',x->>'dataUrl'),'caption',x->>'caption','phase',coalesce(x->>'phase','in_progress'))),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(j.photos)='array' then j.photos else '[]'::jsonb end) x where coalesce(x->>'internal','false')='false' and coalesce(x->>'is_customer_visible','true')='true' and coalesce(x->>'url',x->>'dataUrl') is not null),
 'feedback',(select jsonb_build_object('rating',rating,'comment',comment,'created_at',created_at) from public.customer_feedback where tenant_id=p.tenant_id and job_order_id=j.id limit 1),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('message',note,'created_at',submitted_at) order by submitted_at desc),'[]'::jsonb) from (select note,submitted_at from public.customer_portal_notes where tenant_id=p.tenant_id and job_order_id=j.id and status in ('approved','pending') order by submitted_at desc limit 20)n));
 -- Overlay only the operational tracking projection; do not reissue signed
 -- order content or expose accounting while correcting workshop stages.
 content:=app_private.vehicle_visit_manager_portal_stage(p.tenant_id,p.vehicle_id,p.customer_id,j.id);
 if content is not null then
  tracking:=tracking||jsonb_build_object('stage_key',case content->>'stage' when 'arrived' then 'received' when 'approved' then 'inspection' when 'in_progress' then 'in_repair' when 'ready' then 'quality' end,
   'progress_pct',case content->>'stage' when 'arrived' then 10 when 'approved' then 20 when 'in_progress' then 70 when 'ready' then 90 end,'updated_at',content->'updated_at');
 end if;
 order_data:=order_data||jsonb_build_object('tracking',tracking);
 if not coalesce((order_data->>'enabled')::boolean,false) then order_data:=jsonb_build_object('enabled',false);end if;
 end if;
 select h0.* into h from public.vehicle_handover_records h0 where h0.tenant_id=p.tenant_id and h0.vehicle_id=p.vehicle_id and h0.customer_id=p.customer_id and h0.status='finalized' order by h0.delivered_at desc,h0.created_at desc limit 1;
 delivery:=case when h.id is null or not exists(select 1 from public.vehicle_customer_delivery_approvals a where a.handover_id=h.id and a.tenant_id=p.tenant_id) then jsonb_build_object('enabled',false) else jsonb_build_object('enabled',true,'receipt_number',h.receipt_number,'delivered_at',h.delivered_at,'recipient_name',h.recipient_name,'signature_data_url',h.signature_data_url,'work_summary',h.work_summary) end;
 return jsonb_build_object('vehicle',jsonb_build_object('make',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters),'customer',jsonb_build_object('name',c.name),'entries',entries,'order',order_data,'delivery',delivery,'expires_at',app_private.portal_expiry(p));
end $function$
$manager_definition$;
end $manager_patch$;

-- Seven-argument overload freezes the chosen delivery time before finalization.
-- The existing six-argument API remains unchanged for compatible clients.
CREATE OR REPLACE FUNCTION public.deliver_vehicle_review_visit(p_entry_id uuid, p_request_id uuid, p_receipt_id uuid, p_recipient text, p_signature text, p_notes text, p_occurred_at timestamp with time zone)
 RETURNS vehicle_handover_records
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare e public.vehicle_entries; h public.vehicle_handover_records; source_h public.vehicle_handover_records; actor uuid:=auth.uid(); t uuid:=public.get_user_tenant_id(); staff text;
begin
 if actor is null or not app_private.custody_can('Deliver',t) or not exists(select 1 from public.profiles where user_id=actor and tenant_id=t and account_status='active' and disabled_at is null and role::text in ('admin','manager','supervisor')) then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 if p_occurred_at is null or not isfinite(p_occurred_at) or p_occurred_at>clock_timestamp()+interval '5 minutes' then raise exception 'VEHICLE_VISIT_MANAGER_TIME_INVALID';end if;
 if p_request_id is null or p_receipt_id is null or length(trim(coalesce(p_recipient,''))) not between 2 and 200
 or p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature)>1500000 or length(trim(coalesce(p_notes,''))) not between 5 and 2000 then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED'; end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':review-delivery:'||p_request_id::text,0));
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=t and deleted_at is null for update;
 if not found or e.status='Cancelled' then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into h from public.vehicle_handover_records where tenant_id=t and snapshot_json->>'reviewDeliveryRequest'=p_request_id::text;
 if found then
  if h.vehicle_entry_id<>e.id or h.snapshot_json->>'custodyReceiptId'<>p_receipt_id::text or h.delivered_at is distinct from p_occurred_at or h.recipient_name is distinct from trim(p_recipient) or h.signature_data_url is distinct from p_signature or h.work_summary is distinct from trim(p_notes) then raise exception 'REVIEW_RETURN_REQUEST_CONFLICT'; end if;
  return public.finalize_vehicle_handover(h.id);
 end if;
 if not exists(select 1 from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=t and stage='ready') then raise exception 'REVIEW_RETURN_NOT_READY'; end if;
 select sh.* into source_h from public.vehicle_review_returns r join public.vehicle_handover_records sh on sh.id=r.source_handover_id and sh.tenant_id=r.tenant_id where r.return_entry_id=e.id and r.tenant_id=t and sh.status='finalized' and sh.vehicle_id=e.vehicle_id;
 if not found then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 if not exists(select 1 from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=t and vehicle_entry_id=e.id and vehicle_id=e.vehicle_id and status='issued' and exists(select 1 from public.vehicle_entry_signed_revisions sr where sr.id=vehicle_entry_custody_receipts.revision_id and sr.revision=e.intake_revision)) then raise exception 'CUSTODY_NOT_VALID'; end if;
 if p_occurred_at<greatest((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat',source_h.delivered_at,
   (app_private.vehicle_visit_manager_stage_dates(e,(select w from public.vehicle_visit_workflows w where w.entry_id=e.id and w.tenant_id=t))->>'arrived')::timestamptz,
   (app_private.vehicle_visit_manager_stage_dates(e,(select w from public.vehicle_visit_workflows w where w.entry_id=e.id and w.tenant_id=t))->>'ready')::timestamptz,
   (select case when app_private.vehicle_visit_manager_presence(e,w) is not null then (w.manager_adjustment->>'presence_occurred_at')::timestamptz else null end from public.vehicle_visit_workflows w where w.entry_id=e.id and w.tenant_id=t),
   (select x.occurred_at from public.vehicle_visit_transitions x where x.entry_id=e.id and x.tenant_id=t order by x.revision desc limit 1)) then raise exception 'VEHICLE_VISIT_MANAGER_DATE_ORDER';end if;
 select full_name into staff from public.profiles where user_id=actor and tenant_id=t;
 insert into public.vehicle_handover_records(tenant_id,vehicle_entry_id,work_order_id,claim_id,vehicle_id,customer_id,recipient_name,signature_data_url,workshop_representative,delivered_at,work_summary,snapshot_json)
 values(t,e.id,source_h.work_order_id,source_h.claim_id,e.vehicle_id,e.customer_id,trim(p_recipient),p_signature,staff,p_occurred_at,trim(p_notes),
 jsonb_build_object('custodyReceiptId',p_receipt_id,'reviewDeliveryRequest',p_request_id,'reviewDeliveryOccurredAt',p_occurred_at,'reviewSource',app_private.review_visit_context(e.id),'signatureMethod','electronic')) returning * into h;
 return public.finalize_vehicle_handover(h.id);
end $function$
;
revoke all on function public.deliver_vehicle_review_visit(uuid,uuid,uuid,text,text,text,timestamptz) from public,anon,authenticated,service_role;
grant execute on function public.deliver_vehicle_review_visit(uuid,uuid,uuid,text,text,text,timestamptz) to authenticated;
