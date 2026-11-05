-- REVIEW/TRIAL ONLY: no backfill, no RLS/grant expansion and no Atomic RPC edit.
-- The source INSERT and this archive-only UPDATE share one transaction. A later
-- error rolls both back. UPDATE/UPSERT-conflict edits never fire these triggers.
create function app_private.reactivate_vehicle_after_active_operation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $reactivate$
declare
  v_actor uuid := auth.uid();
  v_tenant uuid;
  v_role text;
  v_source jsonb;
  v_status text;
  v_stage text;
  v_vehicle public.vehicles%rowtype;
begin
  if tg_op <> 'INSERT' or tg_when <> 'AFTER' or tg_level <> 'ROW' or tg_nargs <> 0
    or tg_relid not in ('public.vehicle_entries'::regclass, 'public.job_orders'::regclass, 'public.insurance_claims'::regclass) then
    raise exception 'VEHICLE_OPERATION_TRIGGER_CONTEXT' using errcode = '42501';
  end if;
  -- Trusted actorless historical/system imports retain their original behavior.
  -- Never infer workshop admission or restore a vehicle for such an import.
  if v_actor is null then return new; end if;
  v_tenant := public.get_user_tenant_id();
  v_role := public.get_user_role()::text;
  if v_tenant is null or new.tenant_id is distinct from v_tenant
    or v_role is null or v_role not in ('admin','manager','insurance','supervisor','technician')
    or not exists (
      select 1 from public.profiles p where p.user_id = v_actor and p.tenant_id = v_tenant
        and p.account_status = 'active'
        and (p.role::text in ('admin','manager','insurance','supervisor','technician')
          or exists (select 1 from public.user_roles r where r.user_id = v_actor and r.tenant_id = v_tenant
            and r.role::text in ('admin','manager','insurance','supervisor','technician')))
    ) then
    raise exception 'VEHICLE_OPERATION_ACTOR_FORBIDDEN' using errcode = '42501';
  end if;
  -- This late-sorted trigger reads the actual stored row after the existing
  -- source/link triggers. No client fields can select an arbitrary relation.
  if tg_relid = 'public.vehicle_entries'::regclass then
    select to_jsonb(e) into v_source from public.vehicle_entries e where e.id = new.id and e.tenant_id = v_tenant;
  elsif tg_relid = 'public.job_orders'::regclass then
    select to_jsonb(j) into v_source from public.job_orders j where j.id = new.id and j.tenant_id = v_tenant;
  else
    select to_jsonb(c) into v_source from public.insurance_claims c where c.id = new.id and c.tenant_id = v_tenant;
  end if;
  if v_source is null then return new; end if;
  if (v_source->>'vehicle_id') is distinct from new.vehicle_id::text then
    raise exception 'VEHICLE_OPERATION_SOURCE_CHANGED' using errcode = '23514';
  end if;
  v_status := lower(btrim(coalesce(v_source->>'status','')));
  v_stage := lower(btrim(coalesce(v_source->>'repair_stage','')));
  if nullif(v_source->>'deleted_at','') is not null
    or nullif(v_source->>'archived_at','') is not null
    or coalesce((v_source->>'archived')::boolean, false)
    or v_status in ('cancelled','canceled','closed','delivered','rejected','voided','ملغى','ملغي','مغلق','تم التسليم')
    or v_stage in ('cancelled','canceled','closed','delivered','rejected')
    or nullif(v_source->>'delivered_at','') is not null
    or nullif(v_source->>'vehicle_delivered_at','') is not null
    or nullif(v_source->>'closed_at','') is not null
    or nullif(v_source->>'cancelled_at','') is not null then return new;
  end if;
  -- 'paid' is a financial state and 'completed' may mean ready for collection;
  -- neither is invented as delivery. We never change custody, stages or money.
  if new.vehicle_id is null then return new; end if;
  select v.* into v_vehicle from public.vehicles v
    where v.id = new.vehicle_id and v.tenant_id = v_tenant for update;
  if not found then
    raise exception 'VEHICLE_OPERATION_VEHICLE_UNAVAILABLE' using errcode = '42501';
  end if;
  if v_vehicle.deleted_at is not null then
    raise exception 'VEHICLE_OPERATION_VEHICLE_DELETED' using errcode = '23514';
  end if;
  update public.vehicles v set archived = false, archived_at = null, archived_reason = null
    where v.id = new.vehicle_id and v.tenant_id = v_tenant and v.deleted_at is null
      and (v.archived or v.archived_at is not null);
  return new;
end
$reactivate$;

-- Internal callback only: not an authenticated RPC or a service-role API.
revoke all on function app_private.reactivate_vehicle_after_active_operation()
  from public, anon, authenticated, service_role;

create trigger zz_reactivate_vehicle_after_new_entry
after insert on public.vehicle_entries for each row
execute function app_private.reactivate_vehicle_after_active_operation();


create trigger zz_reactivate_vehicle_after_new_order
after insert on public.job_orders for each row
execute function app_private.reactivate_vehicle_after_active_operation();

create trigger zz_reactivate_vehicle_after_new_claim
after insert on public.insurance_claims for each row
execute function app_private.reactivate_vehicle_after_active_operation();
