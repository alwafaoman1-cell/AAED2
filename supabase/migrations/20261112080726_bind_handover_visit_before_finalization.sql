-- Resolve explicit visit references at the write boundary. Never guess by plate,
-- customer, or a historical claim alone. Standalone legacy orders remain valid.
create or replace function app_private.bind_vehicle_handover_visit()
returns trigger language plpgsql security definer set search_path='' as $bind$
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
$bind$;
revoke all on function app_private.bind_vehicle_handover_visit() from public,anon,authenticated;
create trigger trg_00_bind_vehicle_handover_visit
  before insert or update on public.vehicle_handover_records
  for each row execute function app_private.bind_vehicle_handover_visit();

-- Attribution only: the existing maintenance path remains postgres-only,
-- metadata-only, audited, tenant-scoped and fully signature-preserving. The
-- active manager already authorized to correct this visit can be its audit actor.
-- No client role is granted a new function, table privilege, or override.
do $maintenance$
declare d text:=pg_get_functiondef('public.guard_vehicle_handover_immutability()'::regprocedure);
begin
  if md5(d)<>'2e19d87ad2c9e66fe5b09b457e6b0fd3'
    or position('current_user<>''postgres''' in d)=0
    or position('HANDOVER_LEGACY_LINK_METADATA_ONLY' in d)=0
    or position('p.role::text in (''admin'',''owner'')' in d)=0 then
    raise exception 'HANDOVER_GUARD_DEFINITION_REVIEW_REQUIRED';
  end if;
  execute replace(d,'p.role::text in (''admin'',''owner'')','p.role::text in (''admin'',''owner'',''manager'')');
end;
$maintenance$;
