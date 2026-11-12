-- Closed-list owner-confirmed relationship correction; not a registry merge.
-- Expected before-images and target IDs are supplied only by the trusted runner.
do $identity$
declare
  targets jsonb:=current_setting('app.confirmed_vehicle_identity_targets')::jsonb;
  actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); t record;
  e public.vehicle_entries%rowtype; c public.insurance_claims%rowtype;
  j public.job_orders%rowtype; v public.vehicles%rowtype;
  before_e jsonb; before_c jsonb; before_j jsonb; before_ops jsonb;
begin
  if actor is null or tenant is null or coalesce(public.get_user_role()::text,'') not in ('admin','manager')
    or not exists(select 1 from public.profiles p where p.user_id=actor and p.tenant_id=tenant
      and p.account_status='active' and p.disabled_at is null) then
    raise exception 'IDENTITY_CORRECTION_PERMISSION_DENIED' using errcode='42501';
  end if;
  if jsonb_typeof(targets)<>'array' or jsonb_array_length(targets)<>3
    or (select count(distinct value->>'entry_id') from jsonb_array_elements(targets))<>3 then
    raise exception 'IDENTITY_CORRECTION_TARGETS_INVALID';
  end if;
  for t in select * from jsonb_to_recordset(targets) as r(
    entry_id uuid,claim_id uuid,order_id uuid,target_vehicle_id uuid,plate text,letters text,country text,
    expected_entry jsonb,expected_claim jsonb,expected_order jsonb,reason text
  ) loop
    if length(trim(coalesce(t.reason,'')))<8 or t.expected_entry is null or t.expected_claim is null
      or t.expected_order is null then raise exception 'IDENTITY_CORRECTION_ATTESTATION_REQUIRED'; end if;
    select * into v from public.vehicles where id=t.target_vehicle_id and tenant_id=tenant and deleted_at is null for share;
    if not found or v.plate_number is distinct from t.plate or v.plate_letters is distinct from t.letters
      or v.plate_country is distinct from t.country then raise exception 'IDENTITY_CORRECTION_PLATE_MISMATCH'; end if;
    select * into e from public.vehicle_entries where id=t.entry_id and tenant_id=tenant and deleted_at is null for update;
    if not found or to_jsonb(e) is distinct from t.expected_entry then raise exception 'IDENTITY_CORRECTION_STALE' using errcode='40001'; end if;
    select * into c from public.insurance_claims where id=t.claim_id and tenant_id=tenant and deleted_at is null for update;
    if not found or to_jsonb(c) is distinct from t.expected_claim then raise exception 'IDENTITY_CORRECTION_STALE' using errcode='40001'; end if;
    select * into j from public.job_orders where id=t.order_id and tenant_id=tenant and deleted_at is null for update;
    if not found or to_jsonb(j) is distinct from t.expected_order then raise exception 'IDENTITY_CORRECTION_STALE' using errcode='40001'; end if;
    if coalesce(e.insurance_claim_id,e.converted_claim_id) is distinct from c.id
      or (e.insurance_claim_id is not null and e.converted_claim_id is not null and e.insurance_claim_id<>e.converted_claim_id)
      or j.claim_id is distinct from c.id or j.work_order_type is distinct from 'insurance' or j.parent_work_order_id is not null
      or (j.vehicle_entry_id is not null and j.vehicle_entry_id<>e.id)
      or (e.work_order_id is not null and e.work_order_id<>j.id)
      or (e.converted_work_order_id is not null and e.converted_work_order_id<>j.id)
      or exists(select 1 from public.job_orders other where other.tenant_id=tenant and other.claim_id=c.id
        and other.id<>j.id and other.deleted_at is null and other.parent_work_order_id is null) then
      raise exception 'IDENTITY_CORRECTION_LINK_CONFLICT';
    end if;
    if exists(select 1 from public.vehicle_entries other where other.tenant_id=tenant and other.id<>e.id
      and other.deleted_at is null and other.vehicle_id=v.id) then raise exception 'IDENTITY_CORRECTION_VISIT_AMBIGUOUS'; end if;
    if e.vehicle_id is distinct from v.id and exists(select 1 from public.vehicle_entry_signatures s
      where s.tenant_id=tenant and s.vehicle_entry_id=e.id and s.signed_at is not null) then
      raise exception 'IDENTITY_CORRECTION_SIGNED_ENTRY_LOCKED';
    end if;
    before_e:=to_jsonb(e);before_c:=to_jsonb(c);before_j:=to_jsonb(j);
    select coalesce(jsonb_agg(to_jsonb(op) order by op.id),'[]'::jsonb) into before_ops
      from public.claim_work_order_operations op where op.tenant_id=tenant and op.work_order_id=j.id;
    if c.vehicle_id is distinct from v.id then
      update public.insurance_claims set vehicle_id=v.id where id=c.id and tenant_id=tenant;
    end if;
    if e.vehicle_id is distinct from v.id then
      -- The unsigned Lexus entry already spells W 86765 in its saved snapshot.
      -- Preserve that snapshot, visit customer and all original date fields.
      update public.vehicle_entries set vehicle_id=v.id where id=e.id and tenant_id=tenant;
    end if;
    if j.vehicle_id is distinct from v.id then
      update public.job_orders set vehicle_id=v.id where id=j.id and tenant_id=tenant;
    end if;
    if exists(select 1 from public.claim_work_order_operations op where op.tenant_id=tenant and op.work_order_id=j.id
      and (op.claim_id is distinct from c.id or (op.vehicle_id is not null and op.vehicle_id not in(j.vehicle_id,v.id)))) then
      raise exception 'IDENTITY_CORRECTION_OPERATION_CONFLICT';
    end if;
    update public.claim_work_order_operations set vehicle_id=v.id,updated_at=now()
      where tenant_id=tenant and work_order_id=j.id and vehicle_id is distinct from v.id;
    -- Preserve the already explicit entry links and all status fields. This
    -- identity-only correction must not run the separate link/status workflow
    -- or force a historical Tesla backlink through the closed-order guard.
    insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,old_value,new_value,reason)
      values(tenant,e.id,actor,'vehicle_visit.owner_confirmed_identity_corrected',
        jsonb_build_object('entry',before_e,'claim',before_c,'order',before_j,'operations',before_ops),
        jsonb_build_object('target_vehicle_id',v.id,'plate',t.plate,'letters',t.letters,'country',t.country,
          'entry',(select to_jsonb(x)from public.vehicle_entries x where x.id=e.id and x.tenant_id=tenant),
          'claim',(select to_jsonb(x)from public.insurance_claims x where x.id=c.id and x.tenant_id=tenant),
          'order',(select to_jsonb(x)from public.job_orders x where x.id=j.id and x.tenant_id=tenant)),t.reason);
  end loop;
end;
$identity$;
