-- Preserve legacy review claims/orders exactly as recorded and signed. One
-- pre-feature Production review already has its own pending claim. Its four
-- stored financial FKs and signed snapshot are historical evidence, not new
-- review authorizations. Operational review stages still use review_returns'
-- source handover/claim/order. No claim is cleared, cancelled or reassigned.
create or replace function app_private.guard_review_financial_links()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if TG_TABLE_NAME='vehicle_entries' then
  if exists(select 1 from public.vehicle_review_returns r where r.return_entry_id=NEW.id and r.tenant_id=NEW.tenant_id) then
   if TG_OP='UPDATE' then
    if row(NEW.insurance_claim_id,NEW.converted_claim_id,NEW.work_order_id,NEW.converted_work_order_id)
       is distinct from row(OLD.insurance_claim_id,OLD.converted_claim_id,OLD.work_order_id,OLD.converted_work_order_id)
    then raise exception 'REVIEW_RETURN_SOURCE_ONLY';end if;
   elsif coalesce(NEW.insurance_claim_id,NEW.converted_claim_id,NEW.work_order_id,NEW.converted_work_order_id) is not null then
    raise exception 'REVIEW_RETURN_SOURCE_ONLY';
   end if;
  end if;
 else
  if TG_OP='UPDATE' then
   if NEW.vehicle_entry_id is not distinct from OLD.vehicle_entry_id then return NEW;end if;
   -- A pre-existing review link is retained; it cannot be detached or moved.
   if exists(select 1 from public.vehicle_review_returns r where r.return_entry_id=OLD.vehicle_entry_id and r.tenant_id=OLD.tenant_id) then
    raise exception 'REVIEW_RETURN_SOURCE_ONLY';
   end if;
  end if;
  if exists(select 1 from public.vehicle_review_returns r where r.return_entry_id=NEW.vehicle_entry_id and r.tenant_id=NEW.tenant_id) then
   raise exception 'REVIEW_RETURN_SOURCE_ONLY';
  end if;
 end if;
 return NEW;
end $$;
revoke all on function app_private.guard_review_financial_links() from public,anon,authenticated,service_role;

-- The public PDF projection uses the report frozen at intake signing. Never
-- replace it with today's editable technical report or return arbitrary keys.
create or replace function public.customer_vehicle_portal_document(p_token text,p_session text,p_entry_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;e public.vehicle_entries;r public.vehicle_entry_signed_revisions;
 c public.vehicle_entry_custody_receipts;snapshot jsonb;d jsonb;technical jsonb;technical_form jsonb;safe_technical jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null;
 if not found then raise exception 'PORTAL_DOCUMENT_UNAVAILABLE';end if;
 select sr.* into r from public.vehicle_entry_signed_revisions sr where sr.vehicle_entry_id=e.id and sr.tenant_id=p.tenant_id and sr.revision=e.intake_revision;
 select * into c from public.vehicle_entry_custody_receipts where revision_id=r.id and tenant_id=p.tenant_id;
 if r.id is null or c.id is null then raise exception 'PORTAL_SIGNED_DOCUMENT_REQUIRED';end if;
 technical:=r.snapshot->'vehicle_technical_declaration';
 technical_form:=technical->'form_data';
 if jsonb_typeof(technical)='object' and nullif(technical->>'id','') is not null and jsonb_typeof(technical_form)='object' then
  safe_technical:=jsonb_build_object('id',technical->'id','revision',technical->'revision','form_data',jsonb_build_object(
   'claim_number',technical_form->'claim_number','registration_number',technical_form->'registration_number','make_model',technical_form->'make_model',
   'non_gcc_vehicle',technical_form->'non_gcc_vehicle','towing',technical_form->'towing','cranking',technical_form->'cranking',
   'engine_oil_level',technical_form->'engine_oil_level','radiator_coolant',technical_form->'radiator_coolant','engine_other_remarks',technical_form->'engine_other_remarks',
   'gear_body_crack',technical_form->'gear_body_crack','gear_oil_leak',technical_form->'gear_oil_leak','gear_other_remarks',technical_form->'gear_other_remarks',
   'previous_improper_repairs',technical_form->'previous_improper_repairs','previous_improper_details',technical_form->'previous_improper_details',
   'airbag_warning',technical_form->'airbag_warning','engine_warning',technical_form->'engine_warning','atm_warning',technical_form->'atm_warning','warning_other',technical_form->'warning_other',
   'chassis_status',technical_form->'chassis_status','chassis_damage_lh',technical_form->'chassis_damage_lh','chassis_damage_rh',technical_form->'chassis_damage_rh',
   'chassis_replace_lh',technical_form->'chassis_replace_lh','chassis_replace_rh',technical_form->'chassis_replace_rh','chassis_notes',technical_form->'chassis_notes',
   'floor_deformation',technical_form->'floor_deformation','body_deformation',technical_form->'body_deformation','body_floor_details',technical_form->'body_floor_details',
   'accessories_modification',technical_form->'accessories_modification','ppe',technical_form->'ppe','accessories_details',technical_form->'accessories_details',
   'other_observations',technical_form->'other_observations','garage_name',technical_form->'garage_name','authorized_person',technical_form->'authorized_person',
   'signer_role',technical_form->'signer_role','signature_data_url',technical_form->'signature_data_url','date',technical_form->'date'));
 end if;
 snapshot:=jsonb_build_object('id',e.id,'entry_number',r.snapshot->'entry_number','arrival_date',r.snapshot->'arrival_date','arrival_time',r.snapshot->'arrival_time','customer_snapshot',r.snapshot->'customer_snapshot','vehicle_snapshot',r.snapshot->'vehicle_snapshot','vehicle_condition',r.snapshot->'vehicle_condition','vehicle_contents',r.snapshot->'vehicle_contents','delivered_by',r.snapshot->'delivered_by','received_by_name',r.snapshot->'received_by_name','declaration_ar',r.snapshot->'declaration_ar','declaration_en',r.snapshot->'declaration_en','vehicle_entry_signatures',r.snapshot->'vehicle_entry_signatures','damage_marks',r.snapshot->'damage_marks','damage_map',r.snapshot->'damage_map','claim',jsonb_build_object('claim_number',r.snapshot#>>'{claim,claim_number}'),'work_order',jsonb_build_object('order_number',r.snapshot#>>'{work_order,order_number}'),'insurance_snapshot',jsonb_build_object('claim_number',r.snapshot#>>'{insurance_snapshot,claim_number}','company_name',r.snapshot#>>'{insurance_snapshot,company_name}','is_insurance_related',r.snapshot#>'{insurance_snapshot,is_insurance_related}','lpo_number',r.snapshot#>>'{insurance_snapshot,lpo_number}'),'vehicle_media','[]'::jsonb,'custody_print_settings',r.snapshot->'custody_print_settings','vehicle_technical_declaration',safe_technical);
 if c.status='used' then
  select jsonb_build_object('handover_id',h.id,'handover_number',h.receipt_number,'recipient_name',h.recipient_name,'delivered_at',h.delivered_at,'confirmed_at',h.finalized_at,'delivered_by_name',h.workshop_representative,'signature_data_url',h.signature_data_url,'review_notes',h.work_summary)
  into d from public.vehicle_handover_records h join public.vehicle_customer_delivery_approvals a on a.handover_id=h.id and a.tenant_id=p.tenant_id
  where h.id=c.handover_id and h.tenant_id=p.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized';
 end if;
 return jsonb_build_object('receipt',to_jsonb(c),'entry',snapshot,'revision',r.revision,'delivery_confirmation',d,'review_context',app_private.review_visit_context(e.id));
end $$;
revoke all on function public.customer_vehicle_portal_document(text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.customer_vehicle_portal_document(text,text,uuid) to anon,authenticated;

-- Legacy delivered-by signatures with an unknown intake revision remain
-- historical evidence on legacy, receipt-exempt revision one. Prefer an exact
-- current signature when one exists. Neither an unsigned form nor a fabricated
-- signature time/receipt is created from the historical ink. A material edit to
-- revision two still requires and permits its own fresh customer signature.
create or replace function public.customer_vehicle_portal_read(p_token text,p_session text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;v public.vehicles;c public.customers;entries jsonb;j public.job_orders;cl public.insurance_claims;h public.vehicle_handover_records;order_data jsonb;delivery jsonb;sig public.customer_portal_tokens;consent public.vehicle_customer_order_consents;content jsonb;tracking jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into v from public.vehicles where id=p.vehicle_id and tenant_id=p.tenant_id;
 select * into c from public.customers where id=p.customer_id and tenant_id=p.tenant_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entry_number',e.entry_number,'revision',e.intake_revision,'arrival_date',e.arrival_date,'arrival_time',e.arrival_time,
 'running_status',coalesce(e.vehicle_condition->>'running_status','unknown'),'mileage',e.vehicle_snapshot->'mileage','condition',e.vehicle_condition->>'condition_description','notes',e.vehicle_condition->>'additional_notes',
 'review_reason',e.vehicle_condition#>>'{review_return,reason}','new_damage',e.vehicle_condition->'new_damage','new_damage_notes',e.vehicle_condition->>'new_damage_notes','review_source_entry_id',e.vehicle_condition#>>'{review_return,source_entry_id}',
 'declaration_ar',e.declaration_ar,'declaration_en',e.declaration_en,'signed',s.id is not null,'legacy_signature',s.id is not null and s.intake_revision is null and e.custody_receipt_required is false and e.intake_revision=1,'has_frozen_document',r.id is not null and frozen.id is not null,'signer_name',s.signer_name,'signed_at',s.signed_at,'signature_data_url',s.signature_data_url,'receipt_number',r.receipt_number,
 'releases',(select coalesce(jsonb_agg((app_private.portal_release_content(x)||jsonb_build_object('digest',encode(extensions.digest(app_private.portal_release_content(x)::text,'sha256'),'hex'),'id',x.id,'release_number',x.release_number,'status',x.status,'declaration_ar',x.declaration_ar,'declaration_en',x.declaration_en,'released_at',x.released_at,'signer_name',x.signer_name,'signed_at',x.signed_at,'signature_data_url',x.signature_data_url,'recipient_name',x.form_data->>'recipient_name')) order by x.created_at desc),'[]'::jsonb) from public.vehicle_inspection_releases x where x.vehicle_entry_id=e.id and x.tenant_id=p.tenant_id and x.status in ('awaiting_signature','signed'))) order by e.created_at desc),'[]'::jsonb) into entries
 from public.vehicle_entries e left join lateral(select * from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and (s.intake_revision=e.intake_revision or (e.custody_receipt_required is false and e.intake_revision=1 and s.intake_revision is null)) order by case when s.intake_revision=e.intake_revision then 0 else 1 end,s.created_at desc,s.id desc limit 1)s on true
 left join public.vehicle_entry_custody_receipts r on r.signature_id=s.id and r.tenant_id=e.tenant_id
 left join public.vehicle_entry_signed_revisions frozen on frozen.id=r.revision_id and frozen.tenant_id=e.tenant_id and frozen.vehicle_entry_id=e.id and frozen.signature_id=s.id and frozen.revision=e.intake_revision
 where e.tenant_id=p.tenant_id and e.vehicle_id=p.vehicle_id and e.customer_id=p.customer_id and e.deleted_at is null and e.status in ('Received','Issued','Converted to Claim','Converted to Work Order');
 select * into j from public.job_orders where tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null order by created_at desc limit 1;
 if j.id is not null then
 select * into cl from public.insurance_claims where id=j.claim_id and tenant_id=p.tenant_id;
 select * into sig from public.customer_portal_tokens where job_order_id=j.id and tenant_id=p.tenant_id and revoked_at is null;
 order_data:=jsonb_build_object('enabled',case when j.claim_id is null then exists(select 1 from public.vehicle_visit_workflows where entry_id=j.vehicle_entry_id and stage in ('approved','in_progress','ready','delivered')) else cl.status::text in ('approved','paid') end,
 'status',j.status);
 select * into consent from public.vehicle_customer_order_consents where job_order_id=j.id and tenant_id=p.tenant_id and signature_token_id=sig.id and signed_at=sig.signed_at and signature_data_url=sig.signature_data_url and signer_name=sig.signer_name order by signed_at desc,id desc limit 1;
 content:=coalesce(consent.content,app_private.portal_order_content(j));
 order_data:=order_data||content||jsonb_build_object('digest',coalesce(consent.digest,encode(extensions.digest(content::text,'sha256'),'hex')),'signed',consent.job_order_id is not null or sig.signed_at is not null,'legacy_signature',consent.job_order_id is null and sig.signed_at is not null,'signer_name',coalesce(consent.signer_name,sig.signer_name),'signed_at',coalesce(consent.signed_at,sig.signed_at),'signature_data_url',consent.signature_data_url);
 tracking:=jsonb_build_object('stage_key',case j.status::text when 'delivered' then 'delivered' when 'completed' then 'quality' when 'in_progress' then 'in_repair' when 'waiting_parts' then 'parts_in_transit' when 'inspection' then 'inspection' else 'received' end,
 'progress_pct',case j.status::text when 'delivered' then 100 when 'completed' then 90 when 'in_progress' then 70 when 'waiting_parts' then 55 when 'inspection' then 20 else 10 end,'updated_at',j.updated_at,
 'photos',(select coalesce(jsonb_agg(jsonb_build_object('url',coalesce(x->>'url',x->>'dataUrl'),'caption',x->>'caption','phase',coalesce(x->>'phase','in_progress'))),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(j.photos)='array' then j.photos else '[]'::jsonb end) x where coalesce(x->>'internal','false')='false' and coalesce(x->>'is_customer_visible','true')='true' and coalesce(x->>'url',x->>'dataUrl') is not null),
 'feedback',(select jsonb_build_object('rating',rating,'comment',comment,'created_at',created_at) from public.customer_feedback where tenant_id=p.tenant_id and job_order_id=j.id limit 1),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('message',note,'created_at',submitted_at) order by submitted_at desc),'[]'::jsonb) from (select note,submitted_at from public.customer_portal_notes where tenant_id=p.tenant_id and job_order_id=j.id and status in ('approved','pending') order by submitted_at desc limit 20)n));
 order_data:=order_data||jsonb_build_object('tracking',tracking);
 if not coalesce((order_data->>'enabled')::boolean,false) then order_data:=jsonb_build_object('enabled',false);end if;
 end if;
 select h0.* into h from public.vehicle_handover_records h0 where h0.tenant_id=p.tenant_id and h0.vehicle_id=p.vehicle_id and h0.customer_id=p.customer_id and h0.status='finalized' order by h0.delivered_at desc,h0.created_at desc limit 1;
 delivery:=case when h.id is null or not exists(select 1 from public.vehicle_customer_delivery_approvals a where a.handover_id=h.id and a.tenant_id=p.tenant_id) then jsonb_build_object('enabled',false) else jsonb_build_object('enabled',true,'receipt_number',h.receipt_number,'delivered_at',h.delivered_at,'recipient_name',h.recipient_name,'signature_data_url',h.signature_data_url,'work_summary',h.work_summary) end;
 return jsonb_build_object('vehicle',jsonb_build_object('make',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters),'customer',jsonb_build_object('name',c.name),'entries',entries,'order',order_data,'delivery',delivery,'expires_at',app_private.portal_expiry(p));
end $$;

revoke all on function public.customer_vehicle_portal_read(text,text) from public,anon,authenticated,service_role;
grant execute on function public.customer_vehicle_portal_read(text,text) to anon,authenticated;

create or replace function public.customer_vehicle_portal_sign(p_token text,p_session text,p_entry_id uuid,p_revision integer,p_name text,p_signature text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;e public.vehicle_entries;l public.vehicle_entry_signature_links;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null and status<>'Cancelled' for update;
 if not found or e.intake_revision<>p_revision or p_consent is distinct from true then raise exception 'PORTAL_STALE_OR_CONSENT_REQUIRED';end if;
 if e.custody_receipt_required is false and e.intake_revision=1
  and exists(select 1 from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and s.intake_revision is null)
  and not exists(select 1 from public.vehicle_entry_signatures current_signature where current_signature.vehicle_entry_id=e.id and current_signature.tenant_id=e.tenant_id and current_signature.signature_role='delivered_by' and current_signature.intake_revision=e.intake_revision)
 then raise exception 'PORTAL_LEGACY_SIGNATURE_RETAINED';end if;
 insert into public.vehicle_entry_signature_links(tenant_id,vehicle_entry_id,intake_revision,expires_at,created_by,portal_session_id) values(e.tenant_id,e.id,e.intake_revision,clock_timestamp()+interval '5 minutes',p.created_by,(select id from public.vehicle_customer_portal_sessions where secret_hash=encode(extensions.digest(p_session,'sha256'),'hex') and portal_id=p.id)) returning * into l;
 perform public.submit_vehicle_entry_customer_signature(l.token,p_signature,p_name,null);
 insert into public.vehicle_customer_portal_audit(portal_id,action,details) values(p.id,'intake_signed',jsonb_build_object('entry_id',e.id,'revision',e.intake_revision));
 return jsonb_build_object('signed',true);
end $$;
revoke all on function public.customer_vehicle_portal_sign(text,text,uuid,integer,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.customer_vehicle_portal_sign(text,text,uuid,integer,text,text,boolean) to anon,authenticated;

-- The old URLs must reach the plate challenge immediately after cutover. Only
-- still-active capabilities for the current vehicle owner are considered.
-- This writes new portal/audit rows only. ON CONFLICT never changes an existing
-- portal's token, enabled flag, access version, creator or expiry override.
with legacy_capabilities as (
 select e.tenant_id,e.vehicle_id,e.customer_id,'intake'::text as source
 from public.vehicle_entry_signature_links l
 join public.vehicle_entries e on e.id=l.vehicle_entry_id and e.tenant_id=l.tenant_id
 where l.revoked_at is null and l.expires_at>clock_timestamp() and e.deleted_at is null and e.status<>'Cancelled'
 union all
 select j.tenant_id,j.vehicle_id,j.customer_id,'order'
 from public.customer_portal_tokens t
 join public.job_orders j on j.id=t.job_order_id and j.tenant_id=t.tenant_id
 where t.revoked_at is null and j.deleted_at is null
 union all
 select e.tenant_id,e.vehicle_id,e.customer_id,'release'
 from public.vehicle_inspection_release_links l
 join public.vehicle_inspection_releases x on x.id=l.release_id and x.tenant_id=l.tenant_id
 join public.vehicle_entries e on e.id=x.vehicle_entry_id and e.tenant_id=x.tenant_id
 where l.revoked_at is null and l.expires_at>clock_timestamp() and x.status in ('awaiting_signature','signed') and e.deleted_at is null and e.status<>'Cancelled'
), legacy_pairs as (
 select tenant_id,vehicle_id,customer_id,jsonb_agg(distinct source) as sources
 from legacy_capabilities group by tenant_id,vehicle_id,customer_id
), eligible as (
 select x.* from legacy_pairs x
 join public.vehicles v on v.id=x.vehicle_id and v.tenant_id=x.tenant_id and v.customer_id=x.customer_id and v.deleted_at is null
 join public.customers c on c.id=x.customer_id and c.tenant_id=x.tenant_id and c.deleted_at is null
 where app_private.portal_plate_digits(v.plate_number)<>'' and app_private.portal_plate_letters(v.plate_letters)<>''
 and (
  exists(select 1 from public.vehicle_entries e left join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=e.tenant_id
   where e.tenant_id=x.tenant_id and e.vehicle_id=x.vehicle_id and e.customer_id=x.customer_id and e.deleted_at is null
    and e.status not in ('Cancelled','Draft') and coalesce(w.stage,'arrived') not in ('delivered','cancelled'))
  or exists(select 1 from public.vehicle_handover_records h where h.tenant_id=x.tenant_id and h.vehicle_id=x.vehicle_id and h.customer_id=x.customer_id
   and h.status='finalized' and h.delivered_at>clock_timestamp()-interval '10 days')
 )
), inserted as (
 insert into public.vehicle_customer_portals(tenant_id,vehicle_id,customer_id,created_by)
 select tenant_id,vehicle_id,customer_id,null from eligible
 on conflict(tenant_id,vehicle_id,customer_id) do nothing
 returning id,tenant_id,vehicle_id,customer_id
)
insert into public.vehicle_customer_portal_audit(portal_id,actor_id,action,details)
select p.id,null,'legacy_link_bootstrap',jsonb_build_object('migration','20261114151950_vehicle_portal_production_compatibility','source','migration','legacy_capability_types',e.sources)
from inserted p join eligible e on e.tenant_id=p.tenant_id and e.vehicle_id=p.vehicle_id and e.customer_id=p.customer_id;
