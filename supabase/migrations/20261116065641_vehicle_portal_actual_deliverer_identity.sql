-- Capture the actual intake deliverer inside the same transaction as signing.
-- Existing signed rows/snapshots/receipts are never updated or backfilled.
-- Owner/customer records, visit workflow, financial records and final handovers
-- retain their existing behavior. Normal revision/receipt triggers remain active.

-- Match ECMAScript String.trim without accepting raw control characters below.
-- PostgreSQL btrim's default character set only contains the ASCII space.
create function app_private.portal_trim_signer_text(p_value text)
returns text language sql immutable set search_path='' as $$
 select btrim(coalesce(p_value,''),U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
$$;
revoke all on function app_private.portal_trim_signer_text(text) from public,anon,authenticated,service_role;

create function app_private.portal_normalize_intake_id(p_value text)
returns text language sql immutable set search_path='' as $$
 select translate(app_private.portal_trim_signer_text(p_value),
  '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789');
$$;
revoke all on function app_private.portal_normalize_intake_id(text) from public,anon,authenticated,service_role;

-- Cached clients cannot bypass the required identity through the old overload.
create or replace function public.customer_vehicle_portal_sign(
 p_token text,p_session text,p_entry_id uuid,p_revision integer,
 p_name text,p_signature text,p_consent boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 raise exception 'PORTAL_SIGNER_ID_REQUIRED';
end $$;
revoke all on function public.customer_vehicle_portal_sign(text,text,uuid,integer,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.customer_vehicle_portal_sign(text,text,uuid,integer,text,text,boolean) to anon,authenticated;

create function public.customer_vehicle_portal_sign(
 p_token text,p_session text,p_entry_id uuid,p_revision integer,
 p_name text,p_signature text,p_consent boolean,p_id_number text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 p public.vehicle_customer_portals; e public.vehicle_entries;
 l public.vehicle_entry_signature_links; s public.vehicle_entry_signatures;
 frozen public.vehicle_entry_signed_revisions; receipt public.vehicle_entry_custody_receipts;
 v_signer_name text:=app_private.portal_trim_signer_text(p_name); v_signer_id text:=app_private.portal_normalize_intake_id(p_id_number);
 old_id text; same_person boolean; person jsonb; submitted jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 if p_consent is distinct from true then raise exception 'PORTAL_STALE_OR_CONSENT_REQUIRED';end if;
 if length(v_signer_name) not between 1 and 160 or coalesce(p_name,'') ~ U&'[\0001-\001F\007F-\009F]' then
  raise exception 'PORTAL_SIGNER_NAME_REQUIRED';
 end if;
 if length(v_signer_id) not between 1 and 80 or coalesce(p_id_number,'') ~ U&'[\0001-\001F\007F-\009F]' then
  raise exception 'PORTAL_SIGNER_ID_REQUIRED';
 end if;
 if p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature)>1500000 then
  raise exception 'CUSTODY_INVALID_SIGNATURE';
 end if;
 select * into e from public.vehicle_entries
 where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id
  and customer_id=p.customer_id and deleted_at is null and status<>'Cancelled'
 for update;
 if not found then raise exception 'PORTAL_STALE_OR_CONSENT_REQUIRED';end if;

 -- A retry may carry the pre-identity revision. Only the exact request already
 -- bound by this portal's immutable audit can return an existing signed result.
 -- A changed name, ID, ink or request revision must never edit that signed form.
 select * into s from public.vehicle_entry_signatures
 where vehicle_entry_id=e.id and tenant_id=e.tenant_id
  and intake_revision=e.intake_revision and signature_role='delivered_by';
 if found then
  select * into frozen from public.vehicle_entry_signed_revisions
  where vehicle_entry_id=e.id and tenant_id=e.tenant_id and signature_id=s.id and revision=e.intake_revision;
  select * into receipt from public.vehicle_entry_custody_receipts
  where vehicle_entry_id=e.id and tenant_id=e.tenant_id and vehicle_id=e.vehicle_id
   and signature_id=s.id and revision_id=frozen.id;
  if frozen.id is not null and receipt.id is not null
   and s.signer_name=v_signer_name and s.signature_data_url=p_signature
   and frozen.snapshot#>>'{delivered_by,full_name}'=v_signer_name
   and frozen.snapshot#>>'{delivered_by,id_number}'=v_signer_id
   and exists(select 1 from public.vehicle_customer_portal_audit a
    where a.portal_id=p.id and a.action='intake_signed'
     and a.details->>'entry_id'=e.id::text
     and a.details->>'signature_id'=s.id::text
     and a.details->>'expected_revision'=p_revision::text
     and a.details->>'actual_revision'=e.intake_revision::text)
  then
   return jsonb_build_object('signed',true,'entry_id',e.id,'revision',e.intake_revision,
    'signer_name',s.signer_name,'signer_id_number',frozen.snapshot#>>'{delivered_by,id_number}',
    'signature_id',s.id,'receipt_id',receipt.id,'receipt_number',receipt.receipt_number);
  end if;
  raise exception 'PORTAL_ALREADY_SIGNED';
 end if;

 if e.intake_revision is distinct from p_revision then raise exception 'PORTAL_STALE_OR_CONSENT_REQUIRED';end if;
 if e.custody_receipt_required is false and e.intake_revision=1
  and exists(select 1 from public.vehicle_entry_signatures historical
   where historical.vehicle_entry_id=e.id and historical.tenant_id=e.tenant_id
    and historical.signature_role='delivered_by' and historical.intake_revision is null)
 then raise exception 'PORTAL_LEGACY_SIGNATURE_RETAINED';end if;

 old_id:=app_private.portal_normalize_intake_id(e.delivered_by->>'id_number');
 same_person:=case when old_id<>'' then old_id=v_signer_id
  else coalesce(e.delivered_by->>'full_name','')=v_signer_name end;
 person:=e.delivered_by||jsonb_build_object('full_name',v_signer_name,'id_number',v_signer_id);
 if not same_person then
  -- These details were not confirmed for the actual signer. Keep vehicle arrival,
  -- delivery mode and towing details, without attributing someone else's contact.
  person:=person||jsonb_build_object('phone','','relation','');
 end if;
 if person is distinct from e.delivered_by then
  -- This material change intentionally advances the revision through the normal
  -- trigger. Do it BEFORE minting a revision-bound signing capability.
  update public.vehicle_entries set delivered_by=person,updated_at=clock_timestamp()
  where id=e.id and tenant_id=e.tenant_id returning * into e;
 end if;
 insert into public.vehicle_entry_signature_links(
  tenant_id,vehicle_entry_id,intake_revision,expires_at,created_by,portal_session_id)
 values(e.tenant_id,e.id,e.intake_revision,clock_timestamp()+interval '5 minutes',p.created_by,
  (select id from public.vehicle_customer_portal_sessions
   where secret_hash=encode(extensions.digest(p_session,'sha256'),'hex') and portal_id=p.id))
 returning * into l;
 submitted:=public.submit_vehicle_entry_customer_signature(l.token,p_signature,v_signer_name,null);

 select * into s from public.vehicle_entry_signatures
 where id=(submitted->>'signature_id')::uuid and vehicle_entry_id=e.id and tenant_id=e.tenant_id
  and signature_role='delivered_by' and intake_revision=e.intake_revision;
 select * into frozen from public.vehicle_entry_signed_revisions
 where vehicle_entry_id=e.id and tenant_id=e.tenant_id and signature_id=s.id and revision=e.intake_revision;
 select * into receipt from public.vehicle_entry_custody_receipts
 where vehicle_entry_id=e.id and tenant_id=e.tenant_id and vehicle_id=e.vehicle_id
  and signature_id=s.id and revision_id=frozen.id;
 if s.id is null or frozen.id is null or receipt.id is null
  or s.signer_name is distinct from v_signer_name or s.signature_data_url is distinct from p_signature
  or frozen.snapshot#>>'{delivered_by,full_name}' is distinct from v_signer_name
  or frozen.snapshot#>>'{delivered_by,id_number}' is distinct from v_signer_id
 then raise exception 'PORTAL_SIGNATURE_SAVE_FAILED';end if;
 insert into public.vehicle_customer_portal_audit(portal_id,action,details)
 values(p.id,'intake_signed',jsonb_build_object('entry_id',e.id,
  'expected_revision',p_revision,'actual_revision',e.intake_revision,'revision',e.intake_revision,
  'signature_id',s.id,'receipt_id',receipt.id,'unconfirmed_contact_cleared',not same_person));
 return jsonb_build_object('signed',true,'entry_id',e.id,'revision',e.intake_revision,
  'signer_name',s.signer_name,'signer_id_number',frozen.snapshot#>>'{delivered_by,id_number}',
  'signature_id',s.id,'receipt_id',receipt.id,'receipt_number',receipt.receipt_number);
end $$;
revoke all on function public.customer_vehicle_portal_sign(text,text,uuid,integer,text,text,boolean,text) from public,anon,authenticated,service_role;
grant execute on function public.customer_vehicle_portal_sign(text,text,uuid,integer,text,text,boolean,text) to anon,authenticated;

-- Only frozen, signer-matched identity is returned for a signed intake. Live
-- identity is provided solely as a prefill for an unsigned current revision.
create or replace function public.customer_vehicle_portal_read(p_token text,p_session text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;v public.vehicles;c public.customers;entries jsonb;j public.job_orders;cl public.insurance_claims;h public.vehicle_handover_records;order_data jsonb;delivery jsonb;sig public.customer_portal_tokens;consent public.vehicle_customer_order_consents;content jsonb;tracking jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into v from public.vehicles where id=p.vehicle_id and tenant_id=p.tenant_id;
 select * into c from public.customers where id=p.customer_id and tenant_id=p.tenant_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entry_number',e.entry_number,'revision',e.intake_revision,'arrival_date',e.arrival_date,'arrival_time',e.arrival_time,
 'running_status',coalesce(e.vehicle_condition->>'running_status','unknown'),'mileage',e.vehicle_snapshot->'mileage','condition',e.vehicle_condition->>'condition_description','notes',e.vehicle_condition->>'additional_notes',
 'review_reason',e.vehicle_condition#>>'{review_return,reason}','new_damage',e.vehicle_condition->'new_damage','new_damage_notes',e.vehicle_condition->>'new_damage_notes','review_source_entry_id',e.vehicle_condition#>>'{review_return,source_entry_id}',
 'declaration_ar',e.declaration_ar,'declaration_en',e.declaration_en,'signed',s.id is not null,'legacy_signature',s.id is not null and s.intake_revision is null and e.custody_receipt_required is false and e.intake_revision=1,'has_frozen_document',r.id is not null and frozen.id is not null,'signer_name',s.signer_name,'signed_at',s.signed_at,'signature_data_url',s.signature_data_url,'signature_id',s.id,'receipt_id',r.id,
 'signer_id_number',case when frozen.id is not null and s.intake_revision is not null and frozen.snapshot#>>'{delivered_by,full_name}'=s.signer_name then frozen.snapshot#>>'{delivered_by,id_number}' else null end,
 'delivered_by',case when s.id is null then jsonb_build_object('full_name',e.delivered_by->>'full_name','id_number',e.delivered_by->>'id_number')
  when frozen.id is not null then jsonb_build_object('full_name',frozen.snapshot#>>'{delivered_by,full_name}','id_number',case when frozen.snapshot#>>'{delivered_by,full_name}'=s.signer_name then frozen.snapshot#>>'{delivered_by,id_number}' else null end)
  else null end,'receipt_number',r.receipt_number,
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

