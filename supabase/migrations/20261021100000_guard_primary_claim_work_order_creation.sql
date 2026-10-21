-- A claim may have one active primary work order. An explicit return visit may
-- point at the primary order through parent_work_order_id. This guard is safe
-- to install before historical duplicates are reconciled: it does not alter
-- existing rows and only checks new or changed claim links.

create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;

create or replace function app_private.reuse_primary_claim_work_order_on_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_existing_id uuid;
  v_existing_count integer;
begin
  if new.status::text <> 'approved'
     or old.status::text = 'approved'
     or new.auto_job_order_id is not null then
    return new;
  end if;

  select count(*), (array_agg(jo.id))[1]
    into v_existing_count, v_existing_id
  from public.job_orders jo
  where jo.tenant_id = new.tenant_id
    and jo.deleted_at is null
    and jo.parent_work_order_id is null
    and (jo.claim_id = new.id or jo.id = new.job_order_id);

  if v_existing_count > 1 then
    raise exception 'Multiple primary work orders already exist for this claim'
      using errcode = '23505', constraint = 'job_orders_one_primary_per_claim';
  end if;
  if v_existing_id is not null then
    new.auto_job_order_id := v_existing_id;
    new.job_order_id := v_existing_id;
  end if;
  return new;
end;
$$;

revoke all on function app_private.reuse_primary_claim_work_order_on_approval()
  from public, anon, authenticated;

drop trigger if exists trg_00_reuse_primary_claim_order on public.insurance_claims;
create trigger trg_00_reuse_primary_claim_order
before update of status on public.insurance_claims
for each row execute function app_private.reuse_primary_claim_work_order_on_approval();

create or replace function app_private.guard_one_primary_work_order_per_claim()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.claim_id is null or new.deleted_at is not null
     or new.parent_work_order_id is not null then
    return new;
  end if;

  -- Do not block ordinary edits to a historical duplicate while it is being
  -- reconciled. A changed claim/tenant/parent or restoration must be checked.
  if tg_op = 'UPDATE'
     and old.claim_id is not distinct from new.claim_id
     and old.tenant_id is not distinct from new.tenant_id
     and old.parent_work_order_id is null
     and old.deleted_at is null then
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

-- PostgreSQL runs same-kind BEFORE triggers by name. trg_enforce_job_order_type
-- resolves legacy insurance_claim_number to claim_id before this guard runs.
drop trigger if exists trg_guard_single_primary_claim_order on public.job_orders;
create trigger trg_guard_single_primary_claim_order
before insert or update of tenant_id, claim_id, insurance_claim_number,
  work_order_type, parent_work_order_id, deleted_at, status
on public.job_orders
for each row execute function app_private.guard_one_primary_work_order_per_claim();
