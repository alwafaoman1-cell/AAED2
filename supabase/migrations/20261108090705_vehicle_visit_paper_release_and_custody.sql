-- Selective lifecycle release only. No backfill, financial writes or historical
-- status repair. Both signature methods share the same custody transaction.
do $guard$
begin
  if md5(pg_get_functiondef('public.submit_vehicle_inspection_release_signature(text,text,text,text)'::regprocedure)) <> '49b28f2dd8e95ed62270bb52e81271a3' then
    raise exception 'INSPECTION_RELEASE_DEFINITION_REVIEW_REQUIRED';
  end if;
end;
$guard$;

create function app_private.apply_inspection_release_custody(p_release_id uuid)
returns void language plpgsql security invoker set search_path='' as $custody$
declare
  r public.vehicle_inspection_releases%rowtype;
  e public.vehicle_entries%rowtype;
  c public.insurance_claims%rowtype;
  j public.job_orders%rowtype;
  w public.vehicle_visit_workflows%rowtype;
  occurred timestamptz;
begin
  -- Both callers have locked entry -> release, before acquiring source locks.
  select * into r from public.vehicle_inspection_releases where id=p_release_id;
  if not found or r.status<>'signed' or r.returned_at is not null or r.released_at is null then
    raise exception 'inspection_release_not_signed';
  end if;
  select * into e from public.vehicle_entries
    where id=r.vehicle_entry_id and tenant_id=r.tenant_id and deleted_at is null for update;
  if not found or e.vehicle_id is null or e.status not in ('Received','Issued','Converted to Claim','Converted to Work Order')
    or e.vehicle_location is distinct from 'داخل الورشة'
    or coalesce(e.insurance_claim_id,e.converted_claim_id) is distinct from r.claim_id
    or coalesce(e.work_order_id,e.converted_work_order_id) is distinct from r.work_order_id
    or (e.insurance_claim_id is not null and e.converted_claim_id is not null and e.insurance_claim_id<>e.converted_claim_id)
    or (e.work_order_id is not null and e.converted_work_order_id is not null and e.work_order_id<>e.converted_work_order_id)
    or public.vehicle_visit_has_conflicting_entry(e.id) then raise exception 'VEHICLE_VISIT_LINK_REVIEW_REQUIRED'; end if;
  if exists(select 1 from public.vehicle_inspection_releases x where x.tenant_id=r.tenant_id
    and x.vehicle_entry_id=e.id and x.id<>r.id and x.status='signed' and x.returned_at is null) then
    raise exception 'inspection_release_already_active';
  end if;
  select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=r.tenant_id for update;
  if found and (w.stage in ('cancelled','delivered') or w.review_reason is not null) then
    raise exception 'VEHICLE_VISIT_REVIEW_REQUIRED';
  end if;
  occurred:=r.released_at;
  if occurred>clock_timestamp()+interval '5 minutes'
    or occurred<((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')
    or exists(select 1 from public.vehicle_visit_transitions t where t.tenant_id=r.tenant_id
      and t.entry_id=e.id and t.occurred_at>occurred) then raise exception 'VEHICLE_VISIT_TIME_INVALID'; end if;
  if r.claim_id is not null then
    select * into c from public.insurance_claims where id=r.claim_id and tenant_id=r.tenant_id and deleted_at is null for update;
    if not found or c.status in ('paid','cancelled','rejected') or c.delivered_at is not null or c.vehicle_delivered_at is not null
      or c.vehicle_id is distinct from e.vehicle_id then raise exception 'linked_claim_not_active'; end if;
  end if;
  if r.work_order_id is not null then
    select * into j from public.job_orders where id=r.work_order_id and tenant_id=r.tenant_id and deleted_at is null for update;
    if not found or lower(trim(coalesce(j.status::text,''))) in ('delivered','cancelled','canceled','تم التسليم','ملغى','ملغي')
      or j.vehicle_delivered_at is not null or j.vehicle_id is distinct from e.vehicle_id
      or j.claim_id is distinct from r.claim_id then raise exception 'linked_work_order_not_active'; end if;
  end if;
  if exists(select 1 from public.vehicle_handover_records h where h.tenant_id=r.tenant_id
    and h.vehicle_entry_id=e.id and h.status='finalized') then raise exception 'VEHICLE_VISIT_REVIEW_REQUIRED'; end if;
  update public.vehicle_entries set vehicle_location='مع العميل',vehicle_location_bay=null,updated_at=now()
    where id=e.id and tenant_id=r.tenant_id;
  update public.insurance_claims set vehicle_presence_status='with_customer',vehicle_location_section=null,vehicle_location_bay=null,
    vehicle_location_note='Temporary inspection release '||r.release_number,vehicle_location_updated_at=now(),
    temporary_inspection_release_id=r.id,updated_at=now() where id=c.id and tenant_id=r.tenant_id;
  update public.job_orders set vehicle_presence_status='with_customer',vehicle_location_section=null,vehicle_location_bay=null,
    vehicle_location_note='Temporary inspection release '||r.release_number,temporary_inspection_release_id=r.id,updated_at=now()
    where id=j.id and tenant_id=r.tenant_id;
  update public.claim_work_order_operations set vehicle_presence_status='with_customer',vehicle_location_section=null,vehicle_location_bay=null,
    vehicle_location_note='Temporary inspection release '||r.release_number,vehicle_location_updated_at=now(),updated_at=now(),last_changed_from='system',last_changed_by=auth.uid()
    where tenant_id=r.tenant_id and ((r.claim_id is not null and claim_id=r.claim_id) or (r.work_order_id is not null and work_order_id=r.work_order_id));
  -- An explicit exit is a new event, not an edit of the prior stage's date.
  perform public.sync_vehicle_visit_from_source(e.id,'entry');
  update public.vehicle_visit_workflows set revision=revision+1,changed_at=now(),changed_by=auth.uid()
    where entry_id=e.id and tenant_id=r.tenant_id returning * into w;
  if found then
    insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source,requirements)
      values(r.tenant_id,e.id,w.revision,w.stage,w.stage,occurred,auth.uid(),auth.uid(),'manual',
        jsonb_build_object('action','temporary_exit','release_id',r.id,'signature_method',coalesce(r.entry_snapshot#>>'{release_acknowledgement,method}','electronic')));
  end if;
end;
$custody$;
revoke all on function app_private.apply_inspection_release_custody(uuid) from public,anon,authenticated;

create function public.finalize_vehicle_inspection_release_paper(
  p_release_id uuid,p_expected_updated_at timestamptz,p_released_at timestamptz,p_paper_confirmed boolean
) returns jsonb language plpgsql security definer set search_path='' as $paper$
declare
  tenant uuid:=public.vehicle_inspection_release_staff_tenant(); actor uuid:=auth.uid();
  r public.vehicle_inspection_releases%rowtype; e public.vehicle_entries%rowtype;
  acknowledged timestamptz:=clock_timestamp();
begin
  if not exists(select 1 from public.profiles p where p.user_id=actor and p.tenant_id=tenant
    and p.account_status='active' and p.disabled_at is null) then raise exception 'inspection_release_not_authorized' using errcode='42501'; end if;
  if p_paper_confirmed is distinct from true or p_released_at is null then raise exception 'INSPECTION_RELEASE_PAPER_EVIDENCE_REQUIRED'; end if;
  select * into r from public.vehicle_inspection_releases where id=p_release_id and tenant_id=tenant;
  if not found then raise exception 'inspection_release_not_found'; end if;
  select * into e from public.vehicle_entries where id=r.vehicle_entry_id and tenant_id=tenant and deleted_at is null for update;
  if not found then raise exception 'entry_unavailable'; end if;
  select * into r from public.vehicle_inspection_releases where id=p_release_id and tenant_id=tenant for update;
  if not found then raise exception 'inspection_release_not_found'; end if;
  if r.status='signed' and r.returned_at is null and r.entry_snapshot#>>'{release_acknowledgement,method}'='paper'
    and r.entry_snapshot#>>'{release_acknowledgement,request_revision}'=p_expected_updated_at::text then return to_jsonb(r); end if;
  if r.status<>'draft' or p_expected_updated_at is null or r.updated_at is distinct from p_expected_updated_at then
    raise exception 'INSPECTION_RELEASE_STALE' using errcode='40001';
  end if;
  if nullif(trim(r.form_data->>'recipient_name'),'') is null or nullif(trim(r.form_data->>'recipient_id_number'),'') is null
    or nullif(trim(r.form_data->>'staff_name'),'') is null then raise exception 'INSPECTION_RELEASE_PAPER_EVIDENCE_REQUIRED'; end if;
  update public.vehicle_inspection_releases set status='signed',signature_data_url=null,
    signer_name=trim(form_data->>'recipient_name'),signed_at=acknowledged,released_at=p_released_at,updated_at=acknowledged,
    entry_snapshot=entry_snapshot||jsonb_build_object('release_acknowledgement',jsonb_build_object('method','paper','confirmed',true,
      'confirmed_by',actor,'confirmed_at',acknowledged,'request_revision',p_expected_updated_at::text))
    where id=r.id and tenant_id=tenant returning * into r;
  perform app_private.apply_inspection_release_custody(r.id);
  update public.vehicle_inspection_release_links set revoked_at=acknowledged where release_id=r.id and tenant_id=tenant and revoked_at is null;
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(tenant,e.id,actor,'vehicle_inspection_release.paper_signed',jsonb_build_object('release_id',r.id,'released_at',p_released_at,'acknowledged_at',acknowledged));
  return to_jsonb(r);
end;
$paper$;
revoke all on function public.finalize_vehicle_inspection_release_paper(uuid,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.finalize_vehicle_inspection_release_paper(uuid,timestamptz,timestamptz,boolean) to authenticated;

create or replace function public.submit_vehicle_inspection_release_signature(p_token text,p_signature text,p_signer_name text,p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path='public','extensions' as $signature$
declare
  v_link public.vehicle_inspection_release_links%rowtype;
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_now timestamptz;
begin
  if p_token is null or p_token!~'^[a-f0-9]{64}$' then raise exception 'invalid_link'; end if;
  if nullif(trim(coalesce(p_signer_name,'')),'') is null or length(trim(p_signer_name))>160 then raise exception 'invalid_signer_name'; end if;
  if p_signature is null or p_signature!~'^data:image/png;base64,[A-Za-z0-9+/=]+$' or length(p_signature)>1500000 then raise exception 'invalid_signature'; end if;
  select * into v_link from public.vehicle_inspection_release_links where token_hash=encode(extensions.digest(p_token,'sha256'),'hex');
  if not found then raise exception 'invalid_link'; end if;
  select * into v_release from public.vehicle_inspection_releases where id=v_link.release_id and tenant_id=v_link.tenant_id;
  if not found then raise exception 'release_unavailable'; end if;
  select * into v_entry from public.vehicle_entries where id=v_release.vehicle_entry_id and tenant_id=v_link.tenant_id
    and deleted_at is null and status in ('Received','Issued','Converted to Claim','Converted to Work Order') for update;
  if not found then raise exception 'entry_unavailable'; end if;
  select * into v_release from public.vehicle_inspection_releases where id=v_link.release_id and tenant_id=v_link.tenant_id for update;
  if not found then raise exception 'release_unavailable'; end if;
  select * into v_link from public.vehicle_inspection_release_links where id=v_link.id
    and token_hash=encode(extensions.digest(p_token,'sha256'),'hex') for update;
  if not found or v_link.revoked_at is not null then raise exception 'invalid_link'; end if;
  if v_link.expires_at<=clock_timestamp() then raise exception 'expired_link'; end if;
  if v_release.status='signed' then return jsonb_build_object('ok',true,'already_signed',true,'signed_at',v_release.signed_at); end if;
  if v_release.status<>'awaiting_signature' or v_link.consumed_at is not null then raise exception 'release_unavailable'; end if;
  if lower(trim(p_signer_name))<>lower(trim(v_release.form_data->>'recipient_name')) then raise exception 'signer_must_match_named_recipient'; end if;
  v_now:=clock_timestamp();
  update public.vehicle_inspection_releases set status='signed',signature_data_url=p_signature,signer_name=trim(p_signer_name),
    signer_user_agent=left(nullif(trim(coalesce(p_user_agent,'')),''),500),signed_at=v_now,released_at=v_now,updated_at=v_now
    where id=v_release.id;
  perform app_private.apply_inspection_release_custody(v_release.id);
  update public.vehicle_inspection_release_links set consumed_at=v_now where id=v_link.id;
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(v_link.tenant_id,v_release.vehicle_entry_id,null,'vehicle_inspection_release.customer_signed',
      jsonb_build_object('release_id',v_release.id,'signed_at',v_now,'signer_name',trim(p_signer_name)));
  return jsonb_build_object('ok',true,'signed_at',v_now,'release_number',v_release.release_number);
end;
$signature$;
