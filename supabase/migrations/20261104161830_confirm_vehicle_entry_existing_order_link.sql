-- Explicit manager-confirmed linking of an existing legacy order/entry.
-- No backfill, plate-based vehicle merge, financial rewrite or new RLS grant.
create function public.confirm_vehicle_entry_work_order_link(
  p_entry_id uuid, p_order_id uuid, p_expected_updated_at timestamptz
) returns jsonb language plpgsql security invoker set search_path = '' as $$
declare
  v_actor uuid := auth.uid(); v_tenant uuid := public.get_user_tenant_id();
  v_entry public.vehicle_entries%rowtype; v_order public.job_orders%rowtype;
  v_claim uuid; v_before jsonb; v_count integer;
begin
  if v_actor is null or v_tenant is null or coalesce(public.get_user_role()::text,'') not in ('admin','manager')
    or not exists(select 1 from public.profiles p where p.user_id=v_actor and p.tenant_id=v_tenant and p.account_status='active') then
    raise exception 'VEHICLE_ENTRY_LINK_FORBIDDEN' using errcode='42501';
  end if;
  select e.* into v_entry from public.vehicle_entries e
    where e.tenant_id=v_tenant and e.id=p_entry_id and e.deleted_at is null for update;
  if not found then raise exception 'VEHICLE_ENTRY_LINK_UNAVAILABLE' using errcode='42501'; end if;
  if p_expected_updated_at is null or v_entry.updated_at is distinct from p_expected_updated_at then
    raise exception 'VEHICLE_ENTRY_LINK_STALE' using errcode='40001';
  end if;
  if v_entry.status='Cancelled' or exists(select 1 from public.vehicle_visit_workflows w
    where w.tenant_id=v_tenant and w.entry_id=p_entry_id and w.stage in ('delivered','cancelled'))
    or exists(select 1 from public.vehicle_handover_records h
      where h.tenant_id=v_tenant and h.vehicle_entry_id=p_entry_id and h.status='finalized') then
    raise exception 'VEHICLE_ENTRY_LINK_CLOSED' using errcode='23514';
  end if;
  select j.* into v_order from public.job_orders j
    where j.tenant_id=v_tenant and j.id=p_order_id and j.deleted_at is null for update;
  if not found or v_order.parent_work_order_id is not null or v_entry.vehicle_id is null
    or v_order.vehicle_id is distinct from v_entry.vehicle_id
    or (v_order.vehicle_entry_id is not null and v_order.vehicle_entry_id<>p_entry_id)
    or (v_entry.work_order_id is not null and v_entry.work_order_id<>p_order_id)
    or (v_entry.converted_work_order_id is not null and v_entry.converted_work_order_id<>p_order_id) then
    raise exception 'VEHICLE_ENTRY_LINK_CONFLICT' using errcode='23514';
  end if;
  if v_order.status::text in ('delivered','cancelled','closed') or v_order.vehicle_delivered_at is not null then
    raise exception 'VEHICLE_ENTRY_LINK_CLOSED' using errcode='23514';
  end if;
  if v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null
    and v_entry.insurance_claim_id<>v_entry.converted_claim_id then
    raise exception 'VEHICLE_ENTRY_LINK_CONFLICT' using errcode='23514';
  end if;
  v_claim := coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id);
  if v_claim is null then
    -- A cash order must already name this exact visit, never be guessed by plate.
    if v_order.claim_id is not null or v_order.work_order_type='insurance' or v_order.vehicle_entry_id is distinct from p_entry_id then
      raise exception 'VEHICLE_ENTRY_LINK_CONFLICT' using errcode='23514';
    end if;
  else
    if v_order.claim_id is distinct from v_claim or v_order.work_order_type is distinct from 'insurance'
      or not exists(select 1 from public.insurance_claims c where c.id=v_claim and c.tenant_id=v_tenant
        and c.vehicle_id=v_entry.vehicle_id and c.deleted_at is null and c.status::text not in ('cancelled','rejected')) then
      raise exception 'VEHICLE_ENTRY_LINK_CONFLICT' using errcode='23514';
    end if;
    select count(*) into v_count from public.job_orders j where j.tenant_id=v_tenant and j.claim_id=v_claim
      and j.deleted_at is null and j.parent_work_order_id is null;
    if v_count<>1 then raise exception 'VEHICLE_ENTRY_LINK_AMBIGUOUS' using errcode='23514'; end if;
  end if;
  if exists(select 1 from public.vehicle_entries e where e.tenant_id=v_tenant and e.id<>p_entry_id and e.deleted_at is null
    and (e.work_order_id=p_order_id or e.converted_work_order_id=p_order_id))
    or exists(select 1 from public.job_orders j where j.tenant_id=v_tenant and j.id<>p_order_id
      and j.vehicle_entry_id=p_entry_id and j.deleted_at is null and j.parent_work_order_id is null) then
    raise exception 'VEHICLE_ENTRY_LINK_AMBIGUOUS' using errcode='23514';
  end if;
  if v_entry.work_order_id=p_order_id and v_entry.converted_work_order_id=p_order_id and v_order.vehicle_entry_id=p_entry_id then
    return jsonb_build_object('entry',to_jsonb(v_entry),'order',jsonb_build_object('id',v_order.id,'tenant_id',v_order.tenant_id,
      'vehicle_id',v_order.vehicle_id,'vehicle_entry_id',v_order.vehicle_entry_id,'claim_id',v_order.claim_id,
      'order_number',v_order.order_number,'work_order_type',v_order.work_order_type),'already_linked',true);
  end if;
  v_before:=jsonb_build_object('work_order_id',v_entry.work_order_id,'converted_work_order_id',v_entry.converted_work_order_id,
    'order_entry_id',v_order.vehicle_entry_id);
  update public.job_orders j set vehicle_entry_id=p_entry_id where j.id=p_order_id and j.tenant_id=v_tenant
    returning * into v_order;
  if not found then raise exception 'VEHICLE_ENTRY_LINK_FORBIDDEN' using errcode='42501'; end if;
  update public.vehicle_entries e set work_order_id=p_order_id,converted_work_order_id=p_order_id,
    status='Converted to Work Order' where e.id=p_entry_id and e.tenant_id=v_tenant returning * into v_entry;
  if not found then raise exception 'VEHICLE_ENTRY_LINK_FORBIDDEN' using errcode='42501'; end if;
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,old_value,new_value,reason)
    values(v_tenant,p_entry_id,v_actor,'vehicle_entry.work_order_link_confirmed',v_before,
      jsonb_build_object('work_order_id',p_order_id,'vehicle_id',v_entry.vehicle_id,'claim_id',v_claim),
      'Manager explicitly confirmed the existing same-vehicle visit/work-order link');
  return jsonb_build_object('entry',to_jsonb(v_entry),'order',jsonb_build_object('id',v_order.id,'tenant_id',v_order.tenant_id,
    'vehicle_id',v_order.vehicle_id,'vehicle_entry_id',v_order.vehicle_entry_id,'claim_id',v_order.claim_id,
    'order_number',v_order.order_number,'work_order_type',v_order.work_order_type),'already_linked',false);
end;
$$;
revoke all on function public.confirm_vehicle_entry_work_order_link(uuid,uuid,timestamptz) from public,anon;
grant execute on function public.confirm_vehicle_entry_work_order_link(uuid,uuid,timestamptz) to authenticated;
