-- Correct the UUID selection in the Development-applied guard migration.
-- The first migration is also corrected for fresh environments; this follow-up
-- preserves the already-recorded Development migration sequence.
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
