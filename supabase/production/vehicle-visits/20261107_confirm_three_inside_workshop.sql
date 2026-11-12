-- Owner-attested, bounded custody correction. Not a migration or a backfill.
-- The trusted runner supplies exactly three locked, version-checked targets.
-- Do not call this from a browser or widen any RPC/RLS grant to execute it.
do $custody$
declare
  targets jsonb := current_setting('app.confirmed_custody_targets')::jsonb;
  actor uuid := auth.uid(); tenant uuid := public.get_user_tenant_id();
  target record; before_entry public.vehicle_entries%rowtype;
  after_entry public.vehicle_entries%rowtype;
begin
  if actor is null or tenant is null or coalesce(public.get_user_role()::text,'') not in ('admin','manager')
    or not exists(select 1 from public.profiles p where p.user_id=actor and p.tenant_id=tenant
      and p.account_status='active' and p.disabled_at is null) then
    raise exception 'CUSTODY_CORRECTION_PERMISSION_DENIED' using errcode='42501';
  end if;
  if jsonb_typeof(targets)<>'array' or jsonb_array_length(targets)<>3
    or (select count(distinct value->>'entry_id') from jsonb_array_elements(targets))<>3 then
    raise exception 'CUSTODY_CORRECTION_TARGETS_INVALID';
  end if;
  for target in select * from jsonb_to_recordset(targets) as t(
    entry_id uuid, expected_updated_at timestamptz, expected_location text, reason text
  ) loop
    if target.expected_updated_at is null or target.expected_location is null
      or length(trim(coalesce(target.reason,'')))<8 then raise exception 'CUSTODY_CORRECTION_ATTESTATION_REQUIRED'; end if;
    select * into before_entry from public.vehicle_entries e
      where e.id=target.entry_id and e.tenant_id=tenant and e.deleted_at is null for update;
    if not found or before_entry.updated_at is distinct from target.expected_updated_at
      or before_entry.vehicle_location is distinct from target.expected_location then
      raise exception 'CUSTODY_CORRECTION_STALE' using errcode='40001';
    end if;
    if before_entry.vehicle_location not in ('داخل الورشة','ساحة الورشة الخارجية') then
      raise exception 'CUSTODY_CORRECTION_LOCATION_REVIEW_REQUIRED';
    end if;
    -- The confirmed external workshop yard is part of workshop custody. Keep
    -- its existing bay, snapshots and original wording in the immutable audit.
    -- All linked-record/release/delivery guards still run in the existing RPC.
    if before_entry.vehicle_location='ساحة الورشة الخارجية' then
      update public.vehicle_entries e set vehicle_location='داخل الورشة'
        where e.id=before_entry.id and e.tenant_id=tenant
          and e.updated_at=target.expected_updated_at returning * into after_entry;
      if not found then raise exception 'CUSTODY_CORRECTION_STALE' using errcode='40001'; end if;
      insert into public.vehicle_entry_audit_logs(
        tenant_id,vehicle_entry_id,user_id,action,old_value,new_value,reason
      ) values(tenant,before_entry.id,actor,'vehicle_visit.confirmed_workshop_yard_normalized',
        to_jsonb(before_entry),to_jsonb(after_entry),target.reason);
    end if;
    perform public.reconcile_vehicle_visit_custody(before_entry.id,target.reason);
    select * into after_entry from public.vehicle_entries e where e.id=before_entry.id and e.tenant_id=tenant;
    if after_entry.vehicle_location<>'داخل الورشة'
      or after_entry.vehicle_id is distinct from before_entry.vehicle_id
      or after_entry.customer_id is distinct from before_entry.customer_id
      or after_entry.arrival_date is distinct from before_entry.arrival_date
      or after_entry.arrival_time is distinct from before_entry.arrival_time
      or after_entry.vehicle_location_bay is distinct from before_entry.vehicle_location_bay then
      raise exception 'CUSTODY_CORRECTION_INVARIANT_FAILED';
    end if;
  end loop;
end;
$custody$;
