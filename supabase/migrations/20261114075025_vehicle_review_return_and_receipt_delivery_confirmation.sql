-- New review arrivals are separate visits. Prior deliveries, signatures, billing
-- and already-used receipts are never reopened or copied into the new visit.
create table public.vehicle_review_returns (
 id uuid primary key default gen_random_uuid(),
 tenant_id uuid not null references public.tenants(id),
 request_id uuid not null,
 source_entry_id uuid not null references public.vehicle_entries(id),
 source_handover_id uuid not null references public.vehicle_handover_records(id),
 return_entry_id uuid not null unique references public.vehicle_entries(id),
 reason text not null check(length(trim(reason)) between 5 and 2000),
 arrival_condition text not null check(length(trim(arrival_condition)) between 3 and 2000),
 notes text not null default '' check(length(notes)<=4000),
 arrived_at timestamptz not null, recorded_at timestamptz not null default clock_timestamp(),
 recorded_by uuid not null, unique(tenant_id,request_id),
 check(source_entry_id<>return_entry_id)
);
alter table public.vehicle_review_returns enable row level security;
revoke all on public.vehicle_review_returns from public,anon,authenticated,service_role;
create index vehicle_review_returns_source on public.vehicle_review_returns(tenant_id,source_entry_id);
create trigger review_return_immutable before update or delete on public.vehicle_review_returns
 for each row execute function app_private.custody_immutable();

create function app_private.guard_review_return_context() returns trigger
language plpgsql set search_path='' as $$
begin
 if TG_OP='INSERT' and NEW.vehicle_condition ? 'review_return' then
  if current_user<>'postgres' or nullif(current_setting('app.vehicle_review_return',true),'')
   is distinct from NEW.vehicle_condition#>>'{review_return,request_id}' then
   raise exception 'REVIEW_RETURN_CONTEXT_IMMUTABLE';
  end if;
 elsif TG_OP='UPDATE' and OLD.vehicle_condition->'review_return' is distinct from NEW.vehicle_condition->'review_return' then
  raise exception 'REVIEW_RETURN_CONTEXT_IMMUTABLE';
 end if;
 return NEW;
end $$;
revoke all on function app_private.guard_review_return_context() from public,anon,authenticated,service_role;
create trigger review_return_context_guard before insert or update on public.vehicle_entries
 for each row execute function app_private.guard_review_return_context();

create function public.create_vehicle_review_return(
 p_source_entry_id uuid,p_request_id uuid,p_reason text,p_condition text,p_notes text,
 p_delivered_by text,p_confirm_arrival boolean
) returns jsonb language plpgsql security definer set search_path='' as $$
declare
 t uuid:=public.get_user_tenant_id(); actor uuid:=auth.uid(); old public.vehicle_entries;
 h public.vehicle_handover_records; existing public.vehicle_review_returns;
 customer_data jsonb; vehicle_data jsonb; meta jsonb; form jsonb; saved jsonb; new_id uuid;
 arrival timestamptz; receiver text; previous_guard text;
begin
 if actor is null or t is null or not exists(select 1 from public.profiles p
  where p.user_id=actor and p.tenant_id=t and p.account_status='active' and p.disabled_at is null
   and p.role::text in ('admin','manager','supervisor','insurance')) then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 if p_request_id is null or p_confirm_arrival is distinct from true
  or length(trim(coalesce(p_reason,''))) not between 5 and 2000
  or length(trim(coalesce(p_condition,''))) not between 3 and 2000
  or length(coalesce(p_notes,''))>4000 or length(trim(coalesce(p_delivered_by,''))) not between 2 and 200 then
  raise exception 'REVIEW_RETURN_DETAILS_REQUIRED';
 end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':review-return:'||p_request_id::text,0));
 select * into old from public.vehicle_entries where id=p_source_entry_id and tenant_id=t and deleted_at is null for update;
 if not found or old.status='Cancelled' then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into existing from public.vehicle_review_returns where tenant_id=t and request_id=p_request_id;
 if found then
  if existing.source_entry_id<>old.id then raise exception 'REVIEW_RETURN_REQUEST_CONFLICT'; end if;
  return jsonb_build_object('entry_id',existing.return_entry_id,'existing',true);
 end if;
 -- Repeated opening of the source does not create a second active review visit.
 select r.* into existing from public.vehicle_review_returns r join public.vehicle_entries e on e.id=r.return_entry_id
  left join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=t
  where r.tenant_id=t and r.source_entry_id=old.id and e.deleted_at is null and e.status<>'Cancelled'
   and coalesce(w.stage,'arrived') not in ('delivered','cancelled') order by r.recorded_at desc limit 1;
 if found then return jsonb_build_object('entry_id',existing.return_entry_id,'existing',true); end if;
 select * into h from public.vehicle_handover_records where tenant_id=t and vehicle_entry_id=old.id
  and vehicle_id=old.vehicle_id and status='finalized' order by delivered_at desc,finalized_at desc limit 1;
 if not found or h.finalized_at is null or (nullif(h.signature_data_url,'') is null
   and coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false) is not true)
  or not exists(select 1 from public.vehicle_visit_workflows w where w.entry_id=old.id and w.tenant_id=t and w.stage='delivered')
  or exists(select 1 from public.vehicle_handover_records newer where newer.tenant_id=t and newer.vehicle_id=old.vehicle_id
   and newer.status='finalized' and newer.delivered_at>h.delivered_at) then raise exception 'REVIEW_RETURN_DELIVERY_REQUIRED'; end if;
 arrival:=clock_timestamp();
 if arrival<h.delivered_at then raise exception 'REVIEW_RETURN_DELIVERY_REQUIRED'; end if;
 select to_jsonb(c) into customer_data from public.customers c where c.id=old.customer_id and c.tenant_id=t and c.deleted_at is null;
 select jsonb_build_object('plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,
  'make',v.brand,'model',v.model,'year',v.year,'color',v.color,'vin',coalesce(v.vin,v.vin_number))
  into vehicle_data from public.vehicles v where v.id=old.vehicle_id and v.tenant_id=t and v.deleted_at is null;
 if customer_data is null or vehicle_data is null then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select full_name into receiver from public.profiles where user_id=actor and tenant_id=t;
 meta:=jsonb_build_object('request_id',p_request_id,'source_entry_id',old.id,'source_entry_number',old.entry_number,
  'source_handover_id',h.id,'source_handover_number',h.receipt_number,'previous_delivered_at',h.delivered_at,
  'reason',trim(p_reason),'arrival_condition',trim(p_condition),'notes',trim(coalesce(p_notes,'')),'arrived_at',arrival);
 form:=jsonb_build_object('status','Issued','customer_id',old.customer_id,'vehicle_id',old.vehicle_id,
  'customer',customer_data,'vehicle',vehicle_data,'arrival_date',(arrival at time zone 'Asia/Muscat')::date,
  'arrival_time',(arrival at time zone 'Asia/Muscat')::time,'vehicle_location','داخل الورشة',
  'received_by_name',receiver,'delivered_by',jsonb_build_object('full_name',trim(p_delivered_by)),
  'condition',jsonb_build_object('visit_purpose','workshop','condition_description',trim(p_condition),
   'additional_notes',trim(coalesce(p_notes,'')),'review_return',meta),
  'contents','{}'::jsonb,'damage_marks','[]'::jsonb,
  'insurance',jsonb_build_object('is_insurance_related',coalesce(old.insurance_claim_id,old.converted_claim_id) is not null
   or coalesce((old.insurance_snapshot->>'is_insurance_related')::boolean,false)),
  'declaration_ar',old.declaration_ar,'declaration_en',old.declaration_en);
 previous_guard:=current_setting('app.vehicle_review_return',true);
 perform set_config('app.vehicle_review_return',p_request_id::text,true);
 saved:=public.save_vehicle_entry_intake(null,null,form,null,null);
 perform set_config('app.vehicle_review_return',coalesce(previous_guard,''),true);
 new_id:=(saved->'entry'->>'id')::uuid;
 if new_id is null then raise exception 'REVIEW_RETURN_SAVE_NOT_CONFIRMED'; end if;
 insert into public.vehicle_review_returns(tenant_id,request_id,source_entry_id,source_handover_id,return_entry_id,
  reason,arrival_condition,notes,arrived_at,recorded_by)
 values(t,p_request_id,old.id,h.id,new_id,trim(p_reason),trim(p_condition),trim(coalesce(p_notes,'')),arrival,actor);
 insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
 values(t,new_id,actor,'vehicle_entry.review_return_created',meta);
 return jsonb_build_object('entry_id',new_id,'existing',false);
end $$;
revoke all on function public.create_vehicle_review_return(uuid,uuid,text,text,text,text,boolean) from public,anon,service_role;
grant execute on function public.create_vehicle_review_return(uuid,uuid,text,text,text,text,boolean) to authenticated;

-- Delivery confirmation is a separate, live appendix. The signed intake snapshot
-- and its original signature remain byte-for-byte unchanged.
create or replace function public.vehicle_intake_receipt_document(p_receipt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.vehicle_entry_custody_receipts; r public.vehicle_entry_signed_revisions; delivery jsonb;
begin
 select * into c from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=public.get_user_tenant_id();
 if not found or not app_private.custody_can('Print',c.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select * into r from public.vehicle_entry_signed_revisions where id=c.revision_id and tenant_id=c.tenant_id;
 if c.status='used' then
  select jsonb_build_object('handover_id',h.id,'handover_number',h.receipt_number,'recipient_name',h.recipient_name,
   'delivered_at',h.delivered_at,'confirmed_at',h.finalized_at,'delivered_by_name',h.workshop_representative,
   'signature_data_url',h.signature_data_url,'paper_signature_confirmed',coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false))
  into delivery from public.vehicle_handover_records h where h.id=c.handover_id and h.tenant_id=c.tenant_id
   and h.vehicle_entry_id=c.vehicle_entry_id and h.vehicle_id=c.vehicle_id and h.status='finalized'
   and (nullif(h.signature_data_url,'') is not null or coalesce((h.snapshot_json->>'paperSignatureConfirmed')::boolean,false));
 end if;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id)
 values(c.tenant_id,c.vehicle_entry_id,c.id,'document_viewed',auth.uid());
 return jsonb_build_object('receipt',to_jsonb(c),'entry',r.snapshot,'revision',r.revision,'delivery_confirmation',delivery);
end $$;
