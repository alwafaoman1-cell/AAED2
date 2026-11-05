-- A completed temporary release is a signed historical document. Its customer
-- read link must never reopen it or authorize another signature. Reuse the
-- existing token table/public receipt renderer, with signing already consumed.
create function public.create_vehicle_inspection_release_view_link(
  p_release_id uuid, p_expires_hours integer default 168
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_token text;
  v_expiry timestamptz;
begin
  if auth.uid() is null or v_tenant is null or coalesce(public.get_user_role()::text,'') not in ('admin','manager','insurance','supervisor')
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=v_tenant and p.account_status='active' and p.disabled_at is null)
    then raise exception 'inspection_release_permission_denied' using errcode='42501'; end if;
  select * into v_release from public.vehicle_inspection_releases where id=p_release_id and tenant_id=v_tenant;
  if not found then raise exception 'inspection_release_not_found'; end if;
  select * into v_entry from public.vehicle_entries where id=v_release.vehicle_entry_id and tenant_id=v_tenant and deleted_at is null for update;
  if not found or v_entry.status not in ('Received','Issued','Converted to Claim','Converted to Work Order') then raise exception 'entry_unavailable'; end if;
  select * into v_release from public.vehicle_inspection_releases where id=p_release_id and tenant_id=v_tenant for update;
  if not found or v_release.status<>'signed' or v_release.released_at is null or v_release.returned_at is not null
    or v_entry.vehicle_location is distinct from 'مع العميل' then raise exception 'inspection_release_not_finalized'; end if;
  if (v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null and v_entry.insurance_claim_id<>v_entry.converted_claim_id)
    or (v_entry.work_order_id is not null and v_entry.converted_work_order_id is not null and v_entry.work_order_id<>v_entry.converted_work_order_id)
    or coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id) is distinct from v_release.claim_id
    or coalesce(v_entry.work_order_id,v_entry.converted_work_order_id) is distinct from v_release.work_order_id then raise exception 'inspection_release_link_conflict'; end if;
  if v_release.claim_id is not null and not exists(select 1 from public.insurance_claims c
    where c.id=v_release.claim_id and c.tenant_id=v_tenant and c.deleted_at is null and c.vehicle_id=v_entry.vehicle_id
      and c.vehicle_presence_status='with_customer' and c.status::text not in ('cancelled','rejected','paid') and c.delivered_at is null and c.vehicle_delivered_at is null)
    then raise exception 'linked_claim_not_active'; end if;
  if v_release.work_order_id is not null and not exists(select 1 from public.job_orders j
    where j.id=v_release.work_order_id and j.tenant_id=v_tenant and j.deleted_at is null and j.vehicle_id=v_entry.vehicle_id
      and j.claim_id is not distinct from v_release.claim_id and j.vehicle_presence_status='with_customer' and j.status::text<>'delivered' and j.vehicle_delivered_at is null)
    then raise exception 'linked_work_order_not_active'; end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_expiry := now()+make_interval(hours=>greatest(1,least(coalesce(p_expires_hours,168),168)));
  insert into public.vehicle_inspection_release_links(tenant_id,release_id,token_hash,expires_at,consumed_at,created_by)
    values(v_tenant,v_release.id,encode(extensions.digest(v_token,'sha256'),'hex'),v_expiry,now(),auth.uid());
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(v_tenant,v_entry.id,auth.uid(),'vehicle_inspection_release.view_link_created',jsonb_build_object('release_id',v_release.id,'expires_at',v_expiry,'view_only',true));
  return jsonb_build_object('token',v_token,'expires_at',v_expiry,'view_only',true,'release_id',v_release.id);
end;
$$;
revoke all on function public.create_vehicle_inspection_release_view_link(uuid,integer) from public,anon,authenticated;
grant execute on function public.create_vehicle_inspection_release_view_link(uuid,integer) to authenticated;
comment on function public.create_vehicle_inspection_release_view_link(uuid,integer) is 'Staff-only same-tenant capability for an already signed temporary release. Consumed at creation: cannot authorize signing, never reopens a release.';
