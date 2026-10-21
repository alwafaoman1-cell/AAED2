-- Validate tenant/vehicle identity for new claim links and explicit repeat visits.
-- No existing rows are changed by this migration.
create or replace function app_private.guard_one_primary_work_order_per_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.claim_id is null or new.deleted_at is not null then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and old.claim_id is not distinct from new.claim_id
     and old.tenant_id is not distinct from new.tenant_id
     and old.vehicle_id is not distinct from new.vehicle_id
     and old.parent_work_order_id is not distinct from new.parent_work_order_id
     and old.deleted_at is null then
    return new;
  end if;

  if not exists (
    select 1 from public.insurance_claims c
    where c.id = new.claim_id
      and c.tenant_id = new.tenant_id
      and c.deleted_at is null
      and (c.vehicle_id is null or c.vehicle_id = new.vehicle_id)
  ) then
    raise exception 'Work order claim does not belong to this tenant and vehicle'
      using errcode = '23503', constraint = 'job_orders_claim_tenant_vehicle_guard';
  end if;

  if new.parent_work_order_id is not null then
    if not exists (
      select 1 from public.job_orders parent
      where parent.id = new.parent_work_order_id
        and parent.tenant_id = new.tenant_id
        and parent.claim_id = new.claim_id
        and parent.vehicle_id = new.vehicle_id
        and parent.deleted_at is null
        and parent.parent_work_order_id is null
    ) then
      raise exception 'Repeat visit must reference the primary order for this claim and vehicle'
        using errcode = '23514', constraint = 'job_orders_repeat_visit_parent_guard';
    end if;
    return new;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.tenant_id::text || ':' || new.claim_id::text, 0)
  );
  if exists (
    select 1 from public.job_orders jo
    where jo.tenant_id = new.tenant_id
      and jo.claim_id = new.claim_id
      and jo.deleted_at is null
      and jo.parent_work_order_id is null
      and jo.id <> new.id
  ) then
    raise exception 'A primary work order already exists for this insurance claim'
      using errcode = '23505', constraint = 'job_orders_one_primary_per_claim';
  end if;
  return new;
end;
$$;

revoke all on function app_private.guard_one_primary_work_order_per_claim()
  from public, anon, authenticated;
