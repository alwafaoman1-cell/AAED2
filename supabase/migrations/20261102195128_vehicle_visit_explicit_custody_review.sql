-- Development-first: a manager may attest that a physically present vehicle is
-- in the workshop. Historical custody is never changed by a page read or backfill.
create function public.reconcile_vehicle_visit_custody(p_entry_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_actor uuid := auth.uid();
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
  v_old jsonb;
begin
  if v_actor is null or v_tenant is null or public.get_user_role()::text not in ('admin','manager') then
    raise exception 'VEHICLE_VISIT_PERMISSION_DENIED';
  end if;
  if length(trim(coalesce(p_reason,''))) < 8 or length(p_reason) > 1000 then
    raise exception 'VEHICLE_VISIT_REASON_REQUIRED';
  end if;
  select * into v_entry from public.vehicle_entries
    where id = p_entry_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found then raise exception 'VEHICLE_VISIT_NOT_FOUND'; end if;
  if v_entry.vehicle_location is distinct from 'داخل الورشة'
    or v_entry.status = 'Cancelled'
    or public.vehicle_visit_has_conflicting_entry(p_entry_id) then
    raise exception 'VEHICLE_VISIT_CUSTODY_REVIEW_REQUIRED';
  end if;
  select * into v_claim from public.insurance_claims
    where id = coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id)
      and tenant_id = v_tenant and deleted_at is null for update;
  select * into v_order from public.job_orders
    where id = coalesce(v_entry.work_order_id,v_entry.converted_work_order_id)
      and tenant_id = v_tenant and deleted_at is null for update;
  if (v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null
      and v_entry.insurance_claim_id <> v_entry.converted_claim_id)
    or (v_entry.work_order_id is not null and v_entry.converted_work_order_id is not null
      and v_entry.work_order_id <> v_entry.converted_work_order_id)
    or (coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id) is not null and v_claim.id is null)
    or (coalesce(v_entry.work_order_id,v_entry.converted_work_order_id) is not null and v_order.id is null)
    or (v_claim.id is not null and v_claim.vehicle_id is distinct from v_entry.vehicle_id)
    or (v_order.id is not null and v_order.vehicle_id is distinct from v_entry.vehicle_id) then
    raise exception 'VEHICLE_VISIT_LINK_REVIEW_REQUIRED';
  end if;
  if (v_claim.id is not null and
        (v_claim.status::text in ('cancelled','rejected') or v_claim.vehicle_delivered_at is not null
          or v_claim.delivered_at is not null))
    or (v_order.id is not null and
        (v_order.status::text = 'delivered' or v_order.vehicle_delivered_at is not null))
    or exists (select 1 from public.vehicle_handover_records h
      where h.tenant_id = v_tenant and h.vehicle_entry_id = p_entry_id and h.status = 'finalized')
    or exists (select 1 from public.vehicle_inspection_releases r
      where r.tenant_id = v_tenant and r.vehicle_entry_id = p_entry_id
        and r.status = 'signed' and r.returned_at is null) then
    raise exception 'VEHICLE_VISIT_SIGNED_RELEASE_REVIEW_REQUIRED';
  end if;
  if (v_claim.id is not null and coalesce(v_claim.vehicle_presence_status,'') not in ('in_workshop','with_customer'))
    or (v_order.id is not null and coalesce(v_order.vehicle_presence_status,'') not in ('in_workshop','with_customer')) then
    raise exception 'VEHICLE_VISIT_CUSTODY_REVIEW_REQUIRED';
  end if;
  if coalesce(v_claim.vehicle_presence_status,'') <> 'with_customer'
    and coalesce(v_order.vehicle_presence_status,'') <> 'with_customer' then
    raise exception 'VEHICLE_VISIT_CUSTODY_NOT_CONFLICTING';
  end if;
  v_old := jsonb_build_object('entry_location',v_entry.vehicle_location,
    'claim_id',v_claim.id,'claim_presence',v_claim.vehicle_presence_status,
    'order_id',v_order.id,'order_presence',v_order.vehicle_presence_status);
  if v_claim.id is not null and v_claim.vehicle_presence_status = 'with_customer' then
    update public.insurance_claims set vehicle_presence_status = 'in_workshop', updated_at = now()
      where id = v_claim.id and tenant_id = v_tenant;
  end if;
  if v_order.id is not null and v_order.vehicle_presence_status = 'with_customer' then
    update public.job_orders set vehicle_presence_status = 'in_workshop', updated_at = now()
      where id = v_order.id and tenant_id = v_tenant;
  end if;
  insert into public.vehicle_entry_audit_logs
    (tenant_id,vehicle_entry_id,user_id,action,old_value,new_value,reason)
  values(v_tenant,p_entry_id,v_actor,'vehicle_visit.custody_reconciled',v_old,
    jsonb_build_object('entry_location','داخل الورشة','claim_presence',
      case when v_claim.id is null then null else 'in_workshop' end,'order_presence',
      case when v_order.id is null then null else 'in_workshop' end),trim(p_reason));
end;
$$;

-- An insurance entry with no linked claim must never be approved through the
-- cash acknowledgement branch, even if a client forges the RPC payload.
create function public.vehicle_visit_insurance_approval_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.stage = 'approved' and old.stage is distinct from 'approved'
    and exists (select 1 from public.vehicle_entries e
      left join public.job_orders o on o.id = coalesce(e.work_order_id,e.converted_work_order_id)
        and o.tenant_id = e.tenant_id
      where e.id = new.entry_id and e.tenant_id = new.tenant_id
        and e.insurance_claim_id is null and e.converted_claim_id is null
        and (e.insurance_company_id is not null
          or nullif(trim(e.insurance_snapshot->>'claim_number'),'') is not null
          or nullif(trim(e.insurance_snapshot->>'company_name'),'') is not null
          or o.work_order_type = 'insurance')) then
    raise exception 'VEHICLE_VISIT_CLAIM_REQUIRED_FOR_INSURANCE';
  end if;
  return new;
end;
$$;
create trigger trg_vehicle_visit_insurance_approval_guard
  before update of stage on public.vehicle_visit_workflows
  for each row execute function public.vehicle_visit_insurance_approval_guard();

revoke all on function public.reconcile_vehicle_visit_custody(uuid,text),
  public.vehicle_visit_insurance_approval_guard() from public, anon, authenticated;
grant execute on function public.reconcile_vehicle_visit_custody(uuid,text) to authenticated;
