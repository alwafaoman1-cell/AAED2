-- No data changes. The signed payload remains immutable; only its missing
-- legacy entry FK can be associated during an explicitly audited maintenance.
do $preflight$
begin
  if md5(pg_get_functiondef('public.guard_vehicle_handover_immutability()'::regprocedure)) <> 'bdc8f333f21ad4124375519a4d0f863d' then
    raise exception 'HANDOVER_GUARD_DEFINITION_REVIEW_REQUIRED';
  end if;
end;
$preflight$;
create or replace function public.guard_vehicle_handover_immutability()
returns trigger language plpgsql set search_path='public' as $guard$
declare
  v_transition text := current_setting('app.vehicle_handover_transition', true);
  e public.vehicle_entries%rowtype;
begin
  if tg_op='DELETE' then raise exception 'VEHICLE_HANDOVER_DELETE_FORBIDDEN'; end if;
  if v_transition='link_legacy_entry' then
    if current_user<>'postgres' or auth.uid() is null
      or old.status<>'finalized' or old.finalized_at is null
      or old.vehicle_entry_id is not null or new.vehicle_entry_id is null
      or (to_jsonb(new)-array['vehicle_entry_id','updated_at','updated_by'])
        is distinct from (to_jsonb(old)-array['vehicle_entry_id','updated_at','updated_by'])
      or nullif(old.signature_data_url,'') is null then
      raise exception 'HANDOVER_LEGACY_LINK_METADATA_ONLY';
    end if;
    select * into e from public.vehicle_entries where id=new.vehicle_entry_id for update;
    if not found or e.deleted_at is not null or e.tenant_id<>old.tenant_id
      or e.vehicle_id is distinct from old.vehicle_id
      or coalesce(e.work_order_id,e.converted_work_order_id) is distinct from old.work_order_id
      or coalesce(e.insurance_claim_id,e.converted_claim_id) is distinct from old.claim_id
      or e.arrival_date>(old.delivered_at at time zone 'Asia/Muscat')::date
      or (e.vehicle_condition->>'arrival_time_precision' is distinct from 'date_only'
        and ((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')>old.delivered_at)
      or not exists(select 1 from public.profiles p where p.user_id=auth.uid()
        and p.tenant_id=old.tenant_id and p.account_status='active' and p.disabled_at is null
        and p.role::text in ('admin','owner'))
      or not exists(select 1 from public.job_orders j where j.id=old.work_order_id
        and j.tenant_id=old.tenant_id and j.vehicle_id=old.vehicle_id
        and j.claim_id is not distinct from old.claim_id and j.deleted_at is null
        and j.vehicle_entry_id=e.id)
      or (old.claim_id is not null and not exists(select 1 from public.insurance_claims c
        where c.id=old.claim_id and c.tenant_id=old.tenant_id and c.vehicle_id=old.vehicle_id
        and c.deleted_at is null and c.vehicle_entry_id=e.id))
      or exists(select 1 from public.vehicle_handover_records h where h.id<>old.id
        and h.tenant_id=old.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized')
      or not exists(select 1 from public.vehicle_entry_audit_logs a where a.tenant_id=e.tenant_id
        and a.vehicle_entry_id=e.id and a.user_id=auth.uid()
        and a.action='vehicle_entry.legacy_visit_reconciled'
        and a.created_at=transaction_timestamp() and nullif(trim(a.reason),'') is not null
        and a.new_value->>'handover_id'=old.id::text) then
      raise exception 'HANDOVER_LEGACY_LINK_EVIDENCE_REQUIRED';
    end if;
  elsif old.status in ('finalized','cancelled') and coalesce(v_transition,'')<>'cancel' then
    raise exception 'VEHICLE_HANDOVER_FINALIZED_IMMUTABLE';
  end if;
  if old.status='draft' and new.status<>'draft' and coalesce(v_transition,'')<>'finalize' then
    raise exception 'VEHICLE_HANDOVER_TRANSITION_REQUIRES_RPC';
  end if;
  new.updated_at:=now();new.updated_by:=auth.uid();return new;
end;
$guard$;
-- CREATE OR REPLACE preserves the trigger bindings, owner and existing ACL.
