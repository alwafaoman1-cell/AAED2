-- Development applied the preceding trigger migration before the UUID
-- aggregate was exercised. Replace the two functions with the corrected
-- definitions; fresh environments already receive the same definitions.
create or replace function public.vehicle_visit_link_new_claim_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_entry_id uuid;
  v_count integer;
begin
  if new.deleted_at is not null or new.vehicle_entry_id is not null
    or new.claim_id is null or new.vehicle_id is null
    or new.work_order_type is distinct from 'insurance' then return new; end if;
  select count(*), min(e.id::text)::uuid into v_count, v_entry_id
    from public.vehicle_entries e
    join public.insurance_claims c on c.id = new.claim_id
      and c.tenant_id = new.tenant_id and c.vehicle_id = new.vehicle_id
      and c.deleted_at is null and c.status::text not in ('cancelled','rejected')
    where e.tenant_id = new.tenant_id and e.vehicle_id = new.vehicle_id
      and e.deleted_at is null and e.status is distinct from 'Cancelled'
      and (e.insurance_claim_id = c.id or e.converted_claim_id = c.id or c.vehicle_entry_id = e.id)
      and e.work_order_id is null and e.converted_work_order_id is null
      and not exists (select 1 from public.job_orders other
        where other.tenant_id = new.tenant_id and other.deleted_at is null
          and other.vehicle_entry_id = e.id);
  if v_count = 1 then new.vehicle_entry_id := v_entry_id; end if;
  return new;
end;
$$;

create or replace function public.vehicle_visit_link_new_entry_order()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_order_id uuid;
  v_count integer;
  v_claim_id uuid := coalesce(new.insurance_claim_id,new.converted_claim_id);
begin
  if new.deleted_at is not null or new.vehicle_id is null
    or new.work_order_id is not null or new.converted_work_order_id is not null
    or v_claim_id is null or new.status = 'Cancelled' then return new; end if;
  if new.insurance_claim_id is not null and new.converted_claim_id is not null
    and new.insurance_claim_id <> new.converted_claim_id then return new; end if;
  select count(*), min(j.id::text)::uuid into v_count, v_order_id
    from public.job_orders j
    join public.insurance_claims c on c.id = v_claim_id
      and c.tenant_id = new.tenant_id and c.vehicle_id = new.vehicle_id
      and c.deleted_at is null and c.status::text not in ('cancelled','rejected')
    where j.tenant_id = new.tenant_id and j.vehicle_id = new.vehicle_id
      and j.claim_id = v_claim_id and j.work_order_type = 'insurance'
      and j.deleted_at is null and j.status::text <> 'delivered'
      and j.vehicle_delivered_at is null and j.vehicle_entry_id is null
      and not exists (select 1 from public.vehicle_entries other
        where other.tenant_id = new.tenant_id and other.deleted_at is null
          and j.id in (other.work_order_id,other.converted_work_order_id));
  if v_count = 1 then new.work_order_id := v_order_id; end if;
  return new;
end;
$$;

revoke all on function public.vehicle_visit_link_new_claim_order(),
  public.vehicle_visit_link_new_entry_order() from public, anon, authenticated;
