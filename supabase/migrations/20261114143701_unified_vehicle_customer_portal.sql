-- Vehicle-scoped portal. Capability + plate challenge; no bearer-only data API.
create table public.vehicle_customer_portals(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),vehicle_id uuid not null references public.vehicles(id),customer_id uuid not null references public.customers(id),
 token text not null unique default encode(extensions.gen_random_bytes(32),'hex'),enabled boolean not null default true,access_version integer not null default 1,
 override_until timestamptz,created_at timestamptz not null default clock_timestamp(),created_by uuid,updated_at timestamptz not null default clock_timestamp(),unique(tenant_id,vehicle_id,customer_id));
create table public.vehicle_customer_portal_sessions(id uuid primary key default gen_random_uuid(),portal_id uuid not null references public.vehicle_customer_portals(id),secret_hash text not null unique,access_version integer not null,expires_at timestamptz not null,created_at timestamptz not null default clock_timestamp());
create table public.vehicle_customer_portal_attempts(portal_id uuid primary key references public.vehicle_customer_portals(id),window_at timestamptz not null default clock_timestamp(),failures integer not null default 0);
create table public.vehicle_customer_portal_audit(id uuid primary key default gen_random_uuid(),portal_id uuid not null references public.vehicle_customer_portals(id),actor_id uuid,action text not null,occurred_at timestamptz not null default clock_timestamp(),details jsonb not null default '{}');
create table public.vehicle_customer_delivery_approvals(handover_id uuid primary key references public.vehicle_handover_records(id),tenant_id uuid not null references public.tenants(id),approved_at timestamptz not null default clock_timestamp(),approved_by uuid not null);
alter table public.vehicle_customer_portals enable row level security;
alter table public.vehicle_customer_portal_sessions enable row level security;
alter table public.vehicle_customer_portal_attempts enable row level security;
alter table public.vehicle_customer_portal_audit enable row level security;
alter table public.vehicle_customer_delivery_approvals enable row level security;
revoke all on public.vehicle_customer_portals,public.vehicle_customer_portal_sessions,public.vehicle_customer_portal_attempts,public.vehicle_customer_portal_audit,public.vehicle_customer_delivery_approvals from public,anon,authenticated,service_role;
create trigger portal_audit_immutable before update or delete on public.vehicle_customer_portal_audit for each row execute function app_private.custody_immutable();
create trigger portal_delivery_approval_immutable before update or delete on public.vehicle_customer_delivery_approvals for each row execute function app_private.custody_immutable();
create table public.vehicle_customer_order_consents(id uuid primary key default gen_random_uuid(),job_order_id uuid not null references public.job_orders(id),signature_token_id uuid not null references public.customer_portal_tokens(id),tenant_id uuid not null references public.tenants(id),content jsonb not null,digest text not null,signature_data_url text not null,signer_name text not null,signed_at timestamptz not null);
create index portal_order_consents_parent on public.vehicle_customer_order_consents(tenant_id,job_order_id,signature_token_id,signed_at);
alter table public.vehicle_customer_order_consents enable row level security;
revoke all on public.vehicle_customer_order_consents from public,anon,authenticated,service_role;
create trigger portal_order_consent_immutable before update or delete on public.vehicle_customer_order_consents for each row execute function app_private.custody_immutable();
create function app_private.portal_order_content(j public.job_orders) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',j.id,'order_number',j.order_number,'work_summary',j.description,'diagnosis',j.diagnosis,
 'work_items',(select coalesce(jsonb_agg(jsonb_build_object('title',x->>'title','note',x->>'note') order by ord),'[]'::jsonb) from jsonb_array_elements(case when jsonb_typeof(j.work_items)='array' then j.work_items else '[]'::jsonb end) with ordinality t(x,ord)),
 'declaration_ar','أوافق على بنود الأعمال المذكورة أعلاه وأفوّض الورشة بالقيام بالإصلاحات.','declaration_en','I agree to the work listed above and authorize the workshop to carry out the repairs.')
$$;
create function app_private.portal_release_content(r public.vehicle_inspection_releases) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',r.id,'release_number',r.release_number,'declaration_ar',r.declaration_ar,'declaration_en',r.declaration_en,'form_data',jsonb_build_object(
 'inspection_summary',r.form_data->>'inspection_summary','inspected_items',r.form_data->>'inspected_items','uninspected_items',r.form_data->>'uninspected_items','visible_damage',r.form_data->>'visible_damage','pending_action',r.form_data->>'pending_action','exit_condition',r.form_data->>'exit_condition','contents_handed_over',r.form_data->>'contents_handed_over','keys_handed_over',r.form_data->>'keys_handed_over','recipient_name',r.form_data->>'recipient_name','recipient_id_number',r.form_data->>'recipient_id_number','recipient_phone',r.form_data->>'recipient_phone','recipient_relation',r.form_data->>'recipient_relation','staff_name',r.form_data->>'staff_name','notes',r.form_data->>'notes'))
$$;
create index vehicle_portal_sessions_parent on public.vehicle_customer_portal_sessions(portal_id,expires_at);

create function app_private.portal_expiry(p public.vehicle_customer_portals) returns timestamptz language sql stable security definer set search_path='' as $$
 select case when exists(select 1 from public.vehicle_entries e left join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=e.tenant_id
 where e.tenant_id=p.tenant_id and e.vehicle_id=p.vehicle_id and e.customer_id=p.customer_id and e.deleted_at is null and e.status not in ('Cancelled','Draft') and coalesce(w.stage,'arrived') not in ('delivered','cancelled')) then null
 else coalesce(greatest(p.override_until,(select max(h.delivered_at)+interval '10 days' from public.vehicle_handover_records h where h.tenant_id=p.tenant_id and h.vehicle_id=p.vehicle_id and h.customer_id=p.customer_id and h.status='finalized')),'-infinity'::timestamptz) end
$$;
create function app_private.portal_active(p public.vehicle_customer_portals) returns boolean language sql stable security definer set search_path='' as $$
 select p.id is not null and p.enabled and exists(select 1 from public.vehicles v where v.id=p.vehicle_id and v.tenant_id=p.tenant_id and v.customer_id=p.customer_id and v.deleted_at is null)
 and (app_private.portal_expiry(p) is null or app_private.portal_expiry(p)>clock_timestamp())
$$;
create function app_private.portal_require(p_token text,p_session text) returns public.vehicle_customer_portals language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;
begin
 select * into p from public.vehicle_customer_portals where token=p_token for share;
 if not found or not app_private.portal_active(p) or not exists(select 1 from public.vehicle_customer_portal_sessions s where s.portal_id=p.id and s.access_version=p.access_version and s.expires_at>clock_timestamp() and s.secret_hash=encode(extensions.digest(coalesce(p_session,''),'sha256'),'hex')) then raise exception 'PORTAL_ACCESS_REQUIRED'; end if;
 return p;
end $$;
create function app_private.portal_plate_letters(p text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(translate(upper(trim(coalesce(p,''))),'ابتثجحخدذرزسشصضطظعغفقكلمنهوي','ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),'[^A-Z]','','g')
$$;
create function app_private.portal_plate_digits(p text) returns text language sql immutable set search_path='' as $$
 select regexp_replace(translate(coalesce(p,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g')
$$;
create function public.customer_vehicle_portal_unlock(p_token text,p_plate_digits text,p_plate_letters text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;v public.vehicles;a public.vehicle_customer_portal_attempts;secret text;expiry timestamptz;
begin
 select * into p from public.vehicle_customer_portals where token=p_token for update;
 if not found or not app_private.portal_active(p) then return jsonb_build_object('error','PORTAL_UNAVAILABLE'); end if;
 insert into public.vehicle_customer_portal_attempts(portal_id) values(p.id) on conflict do nothing;
 select * into a from public.vehicle_customer_portal_attempts where portal_id=p.id for update;
 if a.window_at<clock_timestamp()-interval '5 minutes' then update public.vehicle_customer_portal_attempts set window_at=clock_timestamp(),failures=0 where portal_id=p.id; a.failures:=0; end if;
 if a.failures>=8 then return jsonb_build_object('error','PORTAL_TRY_LATER'); end if;
 select * into v from public.vehicles where id=p.vehicle_id and tenant_id=p.tenant_id;
 if app_private.portal_plate_digits(p_plate_digits)='' or app_private.portal_plate_letters(p_plate_letters)='' or
 app_private.portal_plate_digits(p_plate_digits) is distinct from app_private.portal_plate_digits(v.plate_number)
 or app_private.portal_plate_letters(p_plate_letters) is distinct from app_private.portal_plate_letters(v.plate_letters) then
 update public.vehicle_customer_portal_attempts set failures=failures+1 where portal_id=p.id; return jsonb_build_object('error','PORTAL_PLATE_MISMATCH'); end if;
 update public.vehicle_customer_portal_attempts set failures=0 where portal_id=p.id;
 secret:=encode(extensions.gen_random_bytes(32),'hex');expiry:=least(clock_timestamp()+interval '30 minutes',app_private.portal_expiry(p));
 insert into public.vehicle_customer_portal_sessions(portal_id,secret_hash,access_version,expires_at) values(p.id,encode(extensions.digest(secret,'sha256'),'hex'),p.access_version,expiry);
 insert into public.vehicle_customer_portal_audit(portal_id,action) values(p.id,'plate_verified');
 return jsonb_build_object('session',secret,'expires_at',expiry);
end $$;

create function app_private.portal_staff_entry(p_entry uuid,p_manager boolean default false) returns public.vehicle_entries language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;
begin
 select * into e from public.vehicle_entries where id=p_entry and tenant_id=public.get_user_tenant_id() and deleted_at is null;
 if not found or not exists(select 1 from public.profiles where user_id=auth.uid() and tenant_id=e.tenant_id and account_status='active' and disabled_at is null and (role::text in ('admin','manager') or(not p_manager and role::text in ('insurance','supervisor','technician')))) then raise exception 'PORTAL_FORBIDDEN'; end if;return e;
end $$;
create function public.vehicle_customer_portal_context(p_entry_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;p public.vehicle_customer_portals;v public.vehicles;c public.customers;pending uuid;
begin
 e:=app_private.portal_staff_entry(p_entry_id,false);
 select * into p from public.vehicle_customer_portals where tenant_id=e.tenant_id and vehicle_id=e.vehicle_id and customer_id=e.customer_id;
 if not found then return null;end if;
 select * into v from public.vehicles where id=e.vehicle_id and tenant_id=e.tenant_id;select * into c from public.customers where id=e.customer_id and tenant_id=e.tenant_id;
 select h.id into pending from public.vehicle_handover_records h where h.vehicle_entry_id=e.id and h.tenant_id=e.tenant_id and h.status='finalized' and not exists(select 1 from public.vehicle_customer_delivery_approvals a where a.handover_id=h.id) order by h.finalized_at desc limit 1;
 return jsonb_build_object('token',p.token,'enabled',p.enabled,'expires_at',app_private.portal_expiry(p),'vehicle_make',v.brand,'vehicle_model',v.model,'vehicle_year',v.year,'customer_name',c.name,'pending_handover_id',pending);
end $$;
create function public.ensure_vehicle_customer_portal(p_entry_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;p public.vehicle_customer_portals;
begin
 e:=app_private.portal_staff_entry(p_entry_id,false);
 if e.vehicle_id is null or e.customer_id is null then raise exception 'PORTAL_VEHICLE_REQUIRED';end if;
 if not exists(select 1 from public.vehicles v where v.id=e.vehicle_id and v.tenant_id=e.tenant_id and v.customer_id=e.customer_id and v.deleted_at is null and app_private.portal_plate_digits(v.plate_number)<>'' and app_private.portal_plate_letters(v.plate_letters)<>'') then raise exception 'PORTAL_PLATE_REQUIRED';end if;
 insert into public.vehicle_customer_portals(tenant_id,vehicle_id,customer_id,created_by) values(e.tenant_id,e.vehicle_id,e.customer_id,auth.uid()) on conflict(tenant_id,vehicle_id,customer_id) do nothing returning * into p;
 if found then insert into public.vehicle_customer_portal_audit(portal_id,actor_id,action) values(p.id,auth.uid(),'created');end if;
 return public.vehicle_customer_portal_context(e.id);
end $$;
create function public.set_vehicle_customer_portal_enabled(p_entry_id uuid,p_enabled boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;p public.vehicle_customer_portals;
begin
 e:=app_private.portal_staff_entry(p_entry_id,true);
 update public.vehicle_customer_portals set enabled=p_enabled,access_version=access_version+1,override_until=case when p_enabled and app_private.portal_expiry(vehicle_customer_portals)<clock_timestamp() then clock_timestamp()+interval '10 days' else override_until end,updated_at=clock_timestamp() where tenant_id=e.tenant_id and vehicle_id=e.vehicle_id and customer_id=e.customer_id returning * into p;
 if not found then raise exception 'PORTAL_NOT_PREPARED';end if;
 insert into public.vehicle_customer_portal_audit(portal_id,actor_id,action) values(p.id,auth.uid(),case when p_enabled then 'enabled' else 'disabled' end);
 return public.vehicle_customer_portal_context(e.id);
end $$;
create function public.approve_vehicle_customer_portal_delivery(p_entry_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;h public.vehicle_handover_records;p public.vehicle_customer_portals;
begin
 e:=app_private.portal_staff_entry(p_entry_id,true);
 select * into h from public.vehicle_handover_records where vehicle_entry_id=e.id and tenant_id=e.tenant_id and status='finalized' order by finalized_at desc limit 1;
 if not found then raise exception 'PORTAL_FINAL_HANDOVER_REQUIRED';end if;
 perform public.ensure_vehicle_customer_portal(e.id);
 insert into public.vehicle_customer_delivery_approvals(handover_id,tenant_id,approved_by) values(h.id,e.tenant_id,auth.uid()) on conflict do nothing;
 select * into p from public.vehicle_customer_portals where tenant_id=e.tenant_id and vehicle_id=e.vehicle_id and customer_id=e.customer_id;
 insert into public.vehicle_customer_portal_audit(portal_id,actor_id,action,details) values(p.id,auth.uid(),'delivery_approved',jsonb_build_object('handover_id',h.id));
 return public.vehicle_customer_portal_context(e.id);
end $$;
create function public.vehicle_customer_portal_entry_for_order(p_job_order_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare j public.job_orders;e public.vehicle_entries;
begin
 select * into j from public.job_orders where id=p_job_order_id and tenant_id=public.get_user_tenant_id() and deleted_at is null;
 if not found then raise exception 'PORTAL_FORBIDDEN';end if;
 select * into e from public.vehicle_entries where tenant_id=j.tenant_id and vehicle_id=j.vehicle_id and customer_id=j.customer_id and deleted_at is null order by created_at desc limit 1;
 if not found then raise exception 'PORTAL_VEHICLE_REQUIRED';end if;
 perform app_private.portal_staff_entry(e.id,false);return jsonb_build_object('entry_id',e.id);
end $$;
create function public.customer_vehicle_portal_resolve(p_key text) returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('token',p.token) from public.vehicle_customer_portals p where p.token=p_key or exists(
 select 1 from public.vehicle_entries e where e.vehicle_id=p.vehicle_id and e.customer_id=p.customer_id and e.tenant_id=p.tenant_id and
 (exists(select 1 from public.vehicle_entry_signature_links l where l.vehicle_entry_id=e.id and l.tenant_id=e.tenant_id and l.token=p_key)
 or exists(select 1 from public.job_orders j left join public.customer_portal_tokens t on t.job_order_id=j.id where j.vehicle_id=e.vehicle_id and j.customer_id=e.customer_id and j.tenant_id=e.tenant_id and (j.tracking_token::text=p_key or t.token=p_key))
 or exists(select 1 from public.vehicle_inspection_releases r join public.vehicle_inspection_release_links l on l.release_id=r.id where r.vehicle_entry_id=e.id and r.tenant_id=e.tenant_id and l.token_hash=encode(extensions.digest(p_key,'sha256'),'hex')))) limit 1
$$;

create function public.customer_vehicle_portal_read(p_token text,p_session text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;v public.vehicles;c public.customers;entries jsonb;j public.job_orders;cl public.insurance_claims;h public.vehicle_handover_records;order_data jsonb;delivery jsonb;sig public.customer_portal_tokens;consent public.vehicle_customer_order_consents;content jsonb;tracking jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into v from public.vehicles where id=p.vehicle_id and tenant_id=p.tenant_id;
 select * into c from public.customers where id=p.customer_id and tenant_id=p.tenant_id;
 select coalesce(jsonb_agg(jsonb_build_object('id',e.id,'entry_number',e.entry_number,'revision',e.intake_revision,'arrival_date',e.arrival_date,'arrival_time',e.arrival_time,
 'running_status',coalesce(e.vehicle_condition->>'running_status','unknown'),'mileage',e.vehicle_snapshot->'mileage','condition',e.vehicle_condition->>'condition_description','notes',e.vehicle_condition->>'additional_notes',
 'review_reason',e.vehicle_condition#>>'{review_return,reason}','new_damage',e.vehicle_condition->'new_damage','new_damage_notes',e.vehicle_condition->>'new_damage_notes','review_source_entry_id',e.vehicle_condition#>>'{review_return,source_entry_id}',
 'declaration_ar',e.declaration_ar,'declaration_en',e.declaration_en,'signed',s.id is not null,'signer_name',s.signer_name,'signed_at',s.signed_at,'signature_data_url',s.signature_data_url,'receipt_number',r.receipt_number,
 'releases',(select coalesce(jsonb_agg((app_private.portal_release_content(x)||jsonb_build_object('digest',encode(extensions.digest(app_private.portal_release_content(x)::text,'sha256'),'hex'),'id',x.id,'release_number',x.release_number,'status',x.status,'declaration_ar',x.declaration_ar,'declaration_en',x.declaration_en,'released_at',x.released_at,'signer_name',x.signer_name,'signed_at',x.signed_at,'signature_data_url',x.signature_data_url,'recipient_name',x.form_data->>'recipient_name')) order by x.created_at desc),'[]'::jsonb) from public.vehicle_inspection_releases x where x.vehicle_entry_id=e.id and x.tenant_id=p.tenant_id and x.status in ('awaiting_signature','signed'))) order by e.created_at desc),'[]'::jsonb) into entries
 from public.vehicle_entries e left join lateral(select * from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and s.intake_revision=e.intake_revision order by s.created_at desc limit 1)s on true
 left join public.vehicle_entry_custody_receipts r on r.signature_id=s.id
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

alter table public.vehicle_entry_signature_links add column portal_session_id uuid references public.vehicle_customer_portal_sessions(id);
create or replace function app_private.custody_link_revision() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;
begin
 select * into e from public.vehicle_entries where id=NEW.vehicle_entry_id and tenant_id=NEW.tenant_id and deleted_at is null for update;
 if not found then raise exception 'CUSTODY_FORBIDDEN';end if;
 if NEW.portal_session_id is not null then
  if not exists(select 1 from public.vehicle_customer_portal_sessions s join public.vehicle_customer_portals p on p.id=s.portal_id where s.id=NEW.portal_session_id and s.expires_at>clock_timestamp() and s.access_version=p.access_version and app_private.portal_active(p) and p.tenant_id=e.tenant_id and p.vehicle_id=e.vehicle_id and p.customer_id=e.customer_id) then raise exception 'CUSTODY_FORBIDDEN';end if;
 elsif not app_private.custody_can('Issue',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN';end if;
 NEW.intake_revision:=e.intake_revision;return NEW;
end $$;
create function public.customer_vehicle_portal_sign(p_token text,p_session text,p_entry_id uuid,p_revision integer,p_name text,p_signature text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;e public.vehicle_entries;l public.vehicle_entry_signature_links;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null and status<>'Cancelled' for update;
 if not found or e.intake_revision<>p_revision or p_consent is distinct from true then raise exception 'PORTAL_STALE_OR_CONSENT_REQUIRED';end if;
 insert into public.vehicle_entry_signature_links(tenant_id,vehicle_entry_id,intake_revision,expires_at,created_by,portal_session_id) values(e.tenant_id,e.id,e.intake_revision,clock_timestamp()+interval '5 minutes',p.created_by,(select id from public.vehicle_customer_portal_sessions where secret_hash=encode(extensions.digest(p_session,'sha256'),'hex') and portal_id=p.id)) returning * into l;
 perform public.submit_vehicle_entry_customer_signature(l.token,p_signature,p_name,null);
 insert into public.vehicle_customer_portal_audit(portal_id,action,details) values(p.id,'intake_signed',jsonb_build_object('entry_id',e.id,'revision',e.intake_revision));
 return jsonb_build_object('signed',true);
end $$;
create function public.customer_vehicle_portal_sign_order(p_token text,p_session text,p_order_id uuid,p_order_digest text,p_name text,p_signature text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;j public.job_orders;token_value text;view_data jsonb;content jsonb;sig public.customer_portal_tokens;
begin
 p:=app_private.portal_require(p_token,p_session);view_data:=public.customer_vehicle_portal_read(p_token,p_session);
 if coalesce((view_data#>>'{order,enabled}')::boolean,false) is not true or p_consent is distinct from true then raise exception 'PORTAL_ORDER_NOT_APPROVED';end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 200 or p_signature !~ '^data:image/png;base64,[A-Za-z0-9+/=]+$' or p_signature is null or length(p_signature)>1500000 then raise exception 'PORTAL_INVALID_SIGNATURE';end if;
 select * into j from public.job_orders where tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null order by created_at desc limit 1 for update;
 content:=app_private.portal_order_content(j);
 if j.id is distinct from p_order_id or p_order_digest is distinct from encode(extensions.digest(content::text,'sha256'),'hex') then raise exception 'PORTAL_ORDER_CHANGED';end if;
 insert into public.customer_portal_tokens(tenant_id,job_order_id,token) values(p.tenant_id,j.id,encode(extensions.gen_random_bytes(32),'hex')) on conflict(job_order_id) do nothing;
 select token into token_value from public.customer_portal_tokens where tenant_id=p.tenant_id and job_order_id=j.id and revoked_at is null;
 if exists(select 1 from public.customer_portal_tokens where token=token_value and signed_at is not null) then return jsonb_build_object('signed',true);end if;
 perform public.submit_work_order_signature(token_value,p_signature,p_name,null,null);
 select * into sig from public.customer_portal_tokens where token=token_value;
 insert into public.vehicle_customer_order_consents(job_order_id,signature_token_id,tenant_id,content,digest,signature_data_url,signer_name,signed_at) values(j.id,sig.id,p.tenant_id,content,p_order_digest,sig.signature_data_url,sig.signer_name,sig.signed_at);
 insert into public.vehicle_customer_portal_audit(portal_id,action,details) values(p.id,'order_signed',jsonb_build_object('job_order_id',j.id,'digest',p_order_digest));
 return jsonb_build_object('signed',true);
end $$;
create function public.customer_vehicle_portal_sign_release(p_token text,p_session text,p_release_id uuid,p_release_digest text,p_name text,p_signature text,p_consent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;r public.vehicle_inspection_releases;e public.vehicle_entries;secret text;
begin
 p:=app_private.portal_require(p_token,p_session);
 select x.* into r from public.vehicle_inspection_releases x join public.vehicle_entries v on v.id=x.vehicle_entry_id and v.tenant_id=x.tenant_id where x.id=p_release_id and x.tenant_id=p.tenant_id and v.vehicle_id=p.vehicle_id and v.customer_id=p.customer_id;
 if not found or p_consent is distinct from true then raise exception 'PORTAL_RELEASE_UNAVAILABLE';end if;
 perform 1 from public.vehicle_entries where id=r.vehicle_entry_id and tenant_id=p.tenant_id for update;
 select * into r from public.vehicle_inspection_releases where id=p_release_id and tenant_id=p.tenant_id for update;
 if p_release_digest is distinct from encode(extensions.digest(app_private.portal_release_content(r)::text,'sha256'),'hex') then raise exception 'PORTAL_RELEASE_CHANGED';end if;
 secret:=encode(extensions.gen_random_bytes(32),'hex');insert into public.vehicle_inspection_release_links(tenant_id,release_id,token_hash,expires_at) values(p.tenant_id,r.id,encode(extensions.digest(secret,'sha256'),'hex'),clock_timestamp()+interval '5 minutes');
 perform public.submit_vehicle_inspection_release_signature(secret,p_signature,p_name,null);return jsonb_build_object('signed',true);
end $$;

create function public.customer_vehicle_portal_feedback(p_token text,p_session text,p_order_id uuid,p_rating integer,p_comment text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;j public.job_orders;view_data jsonb;token_value text;
begin
 p:=app_private.portal_require(p_token,p_session);view_data:=public.customer_vehicle_portal_read(p_token,p_session);
 if coalesce((view_data#>>'{order,enabled}')::boolean,false) is not true then raise exception 'PORTAL_ORDER_NOT_APPROVED';end if;
 if length(coalesce(p_comment,''))>2000 then raise exception 'PORTAL_COMMENT_TOO_LONG';end if;
 select * into j from public.job_orders where tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null order by created_at desc limit 1 for update;
 if j.id is distinct from p_order_id then raise exception 'PORTAL_ORDER_CHANGED';end if;
 insert into public.customer_portal_tokens(tenant_id,job_order_id,token) values(p.tenant_id,j.id,encode(extensions.gen_random_bytes(32),'hex')) on conflict(job_order_id) do nothing;
 select token into token_value from public.customer_portal_tokens where tenant_id=p.tenant_id and job_order_id=j.id and revoked_at is null;
 perform public.submit_customer_feedback(token_value,p_rating,p_comment,null);return jsonb_build_object('ok',true);
end $$;
create function public.customer_vehicle_portal_note(p_token text,p_session text,p_order_id uuid,p_note text) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;j public.job_orders;view_data jsonb;token_value text;
begin
 p:=app_private.portal_require(p_token,p_session);view_data:=public.customer_vehicle_portal_read(p_token,p_session);
 if coalesce((view_data#>>'{order,enabled}')::boolean,false) is not true then raise exception 'PORTAL_ORDER_NOT_APPROVED';end if;
 
 select * into j from public.job_orders where tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null order by created_at desc limit 1 for update;
 if j.id is distinct from p_order_id then raise exception 'PORTAL_ORDER_CHANGED';end if;
 insert into public.customer_portal_tokens(tenant_id,job_order_id,token) values(p.tenant_id,j.id,encode(extensions.gen_random_bytes(32),'hex')) on conflict(job_order_id) do nothing;
 select token into token_value from public.customer_portal_tokens where tenant_id=p.tenant_id and job_order_id=j.id and revoked_at is null;
 perform public.submit_portal_note(token_value,p_note,null,null,null);return jsonb_build_object('ok',true);
end $$;
create function public.customer_vehicle_portal_document(p_token text,p_session text,p_entry_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;e public.vehicle_entries;r public.vehicle_entry_signed_revisions;c public.vehicle_entry_custody_receipts;snapshot jsonb;d jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null;
 if not found then raise exception 'PORTAL_DOCUMENT_UNAVAILABLE';end if;
 select sr.* into r from public.vehicle_entry_signed_revisions sr where sr.vehicle_entry_id=e.id and sr.tenant_id=p.tenant_id and sr.revision=e.intake_revision;
 select * into c from public.vehicle_entry_custody_receipts where revision_id=r.id and tenant_id=p.tenant_id;
 if r.id is null or c.id is null then raise exception 'PORTAL_SIGNED_DOCUMENT_REQUIRED';end if;
 snapshot:=jsonb_build_object('id',e.id,'entry_number',r.snapshot->'entry_number','arrival_date',r.snapshot->'arrival_date','arrival_time',r.snapshot->'arrival_time','customer_snapshot',r.snapshot->'customer_snapshot','vehicle_snapshot',r.snapshot->'vehicle_snapshot','vehicle_condition',r.snapshot->'vehicle_condition','vehicle_contents',r.snapshot->'vehicle_contents','delivered_by',r.snapshot->'delivered_by','received_by_name',r.snapshot->'received_by_name','declaration_ar',r.snapshot->'declaration_ar','declaration_en',r.snapshot->'declaration_en','vehicle_entry_signatures',r.snapshot->'vehicle_entry_signatures','damage_marks',r.snapshot->'damage_marks','damage_map',r.snapshot->'damage_map','claim',jsonb_build_object('claim_number',r.snapshot#>>'{claim,claim_number}'),'work_order',jsonb_build_object('order_number',r.snapshot#>>'{work_order,order_number}'),'insurance_snapshot',jsonb_build_object('claim_number',r.snapshot#>>'{insurance_snapshot,claim_number}','company_name',r.snapshot#>>'{insurance_snapshot,company_name}','is_insurance_related',r.snapshot#>'{insurance_snapshot,is_insurance_related}','lpo_number',r.snapshot#>>'{insurance_snapshot,lpo_number}'),'vehicle_media','[]'::jsonb,'custody_print_settings',r.snapshot->'custody_print_settings');
 if c.status='used' then select jsonb_build_object('handover_id',h.id,'handover_number',h.receipt_number,'recipient_name',h.recipient_name,'delivered_at',h.delivered_at,'confirmed_at',h.finalized_at,'delivered_by_name',h.workshop_representative,'signature_data_url',h.signature_data_url,'review_notes',h.work_summary) into d from public.vehicle_handover_records h join public.vehicle_customer_delivery_approvals a on a.handover_id=h.id and a.tenant_id=p.tenant_id where h.id=c.handover_id and h.tenant_id=p.tenant_id and h.vehicle_entry_id=e.id and h.status='finalized';end if;
 return jsonb_build_object('receipt',to_jsonb(c),'entry',snapshot,'revision',r.revision,'delivery_confirmation',d,'review_context',app_private.review_visit_context(e.id));
end $$;

-- All old bearer-only customer routines are closed; staff and new session-bound
-- wrappers continue calling their original implementations with owner privileges.
do $$ declare f record;begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
 (p.proname like 'get_public_tracking%' or p.proname like 'get_public_work_order%' or p.proname like 'get_work_order_for_sign%' or p.proname like 'submit_work_order_signature%' or p.proname like 'get_vehicle_entry_for_customer_signature%' or p.proname like 'submit_vehicle_entry_customer_signature%' or p.proname like 'get_vehicle_inspection_release_for_signature%' or p.proname like 'submit_vehicle_inspection_release_signature%' or p.proname in ('submit_customer_feedback','submit_portal_feedback','submit_portal_note','submit_customer_portal_feedback','submit_customer_portal_note'))
 loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='app_private' and p.proname like 'portal_%'
 loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);end loop;
 for f in select p.oid::regprocedure as signature,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'customer_vehicle_portal_%' or p.proname in('vehicle_customer_portal_context','ensure_vehicle_customer_portal','set_vehicle_customer_portal_enabled','approve_vehicle_customer_portal_delivery','vehicle_customer_portal_entry_for_order'))
 loop execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);if f.proname like 'customer_vehicle_portal_%' then execute format('grant execute on function %s to anon,authenticated',f.signature);else execute format('grant execute on function %s to authenticated',f.signature);end if;end loop;
end $$;

CREATE OR REPLACE FUNCTION public.create_vehicle_review_return(p_source_entry_id uuid, p_request_id uuid, p_reason text, p_condition text, p_notes text, p_delivered_by text, p_confirm_arrival boolean, p_mileage numeric, p_running_status text, p_new_damage boolean, p_new_damage_notes text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
 t uuid:=public.get_user_tenant_id(); actor uuid:=auth.uid(); old public.vehicle_entries;
 h public.vehicle_handover_records; existing public.vehicle_review_returns;
 customer_data jsonb; vehicle_data jsonb; meta jsonb; form jsonb; saved jsonb; new_id uuid;
 arrival timestamptz; receiver text; previous_guard text;
begin
 if actor is null or t is null or not exists(select 1 from public.profiles p
  where p.user_id=actor and p.tenant_id=t and p.account_status='active' and p.disabled_at is null
   and p.role::text in ('admin','manager','supervisor','insurance')) then raise exception 'REVIEW_RETURN_FORBIDDEN'; end if;
 if p_mileage is null or p_mileage<0 or p_mileage>99999999 or p_running_status not in ('running','not_running') or p_running_status is null or p_new_damage is null or (p_new_damage and length(trim(coalesce(p_new_damage_notes,'')))<3) or length(coalesce(p_new_damage_notes,''))>2000 then raise exception 'REVIEW_RETURN_DETAILS_REQUIRED';end if;
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
  'mileage',p_mileage,'running_status',p_running_status,'new_damage',p_new_damage,'new_damage_notes',trim(coalesce(p_new_damage_notes,'')),'reason',trim(p_reason),'arrival_condition',trim(p_condition),'notes',trim(coalesce(p_notes,'')),'arrived_at',arrival);
 form:=jsonb_build_object('status','Issued','customer_id',old.customer_id,'vehicle_id',old.vehicle_id,
  'customer',customer_data,'vehicle',vehicle_data||jsonb_build_object('mileage',p_mileage),'arrival_date',(arrival at time zone 'Asia/Muscat')::date,
  'arrival_time',(arrival at time zone 'Asia/Muscat')::time,'vehicle_location','داخل الورشة',
  'received_by_name',receiver,'delivered_by',jsonb_build_object('full_name',trim(p_delivered_by)),
  'condition',jsonb_build_object('running_status',p_running_status,'new_damage',p_new_damage,'new_damage_notes',trim(coalesce(p_new_damage_notes,'')),'visit_purpose','workshop','condition_description',trim(p_condition),
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
end $function$
;
revoke all on function public.create_vehicle_review_return(uuid,uuid,text,text,text,text,boolean,numeric,text,boolean,text) from public,anon,service_role;
grant execute on function public.create_vehicle_review_return(uuid,uuid,text,text,text,text,boolean,numeric,text,boolean,text) to authenticated;
create or replace function public.create_vehicle_review_return(p_source_entry_id uuid,p_request_id uuid,p_reason text,p_condition text,p_notes text,p_delivered_by text,p_confirm_arrival boolean) returns jsonb language plpgsql security definer set search_path='' as $$begin raise exception 'REVIEW_RETURN_DETAILS_REQUIRED';end $$;
create function app_private.guard_new_intake_running_status() returns trigger language plpgsql set search_path='' as $$
begin
 if NEW.status='Issued' and (TG_OP='INSERT' or OLD.status='Draft') and coalesce(NEW.vehicle_condition->>'running_status','unknown') not in ('running','not_running') then raise exception 'VEHICLE_INTAKE_RUNNING_STATUS_REQUIRED';end if;
 return NEW;
end $$;
revoke all on function app_private.guard_new_intake_running_status() from public,anon,authenticated,service_role;
create trigger new_intake_running_status before insert or update of status on public.vehicle_entries for each row execute function app_private.guard_new_intake_running_status();

create or replace function app_private.advance_review_visit(p_entry uuid,p_revision integer,p_target text,p_at timestamptz,p_notes text,p_reason text,p_responsible uuid) returns public.vehicle_visit_workflows
language plpgsql set search_path='' as $$
declare e public.vehicle_entries; w public.vehicle_visit_workflows; old_stage text; actor uuid:=auth.uid(); tenant uuid:=public.get_user_tenant_id(); role_name text;
begin
 select p.role::text into role_name from public.profiles p where p.user_id=actor and p.tenant_id=tenant and p.account_status='active' and p.disabled_at is null;
 if role_name is null or role_name not in ('admin','manager','supervisor','technician') then raise exception 'VEHICLE_VISIT_PERMISSION_DENIED'; end if;
 select * into e from public.vehicle_entries where id=p_entry and tenant_id=tenant and deleted_at is null for update;
 if not found or app_private.review_visit_context(e.id) is null then raise exception 'REVIEW_RETURN_SOURCE_INVALID'; end if;
 select * into w from public.vehicle_visit_workflows where entry_id=e.id and tenant_id=tenant for update;
 if not found or w.revision<>p_revision then raise exception 'VEHICLE_VISIT_STALE_REVISION'; end if;
 if w.stage in ('delivered','cancelled') then raise exception 'REVIEW_RETURN_TERMINAL'; end if;
 if p_at is null or p_at>clock_timestamp()+interval '5 minutes' or p_at<((e.arrival_date+e.arrival_time) at time zone 'Asia/Muscat')
 or p_at<coalesce((select occurred_at from public.vehicle_visit_transitions where entry_id=e.id order by revision desc limit 1),'-infinity'::timestamptz)
 then raise exception 'VEHICLE_VISIT_TIME_INVALID'; end if;
 if length(coalesce(p_notes,''))>2000 or length(coalesce(p_reason,''))>1000 then raise exception 'VEHICLE_VISIT_DETAILS_TOO_LONG'; end if;
 if not exists(select 1 from public.profiles where user_id=coalesce(p_responsible,actor) and tenant_id=tenant and account_status='active' and disabled_at is null) then raise exception 'VEHICLE_VISIT_RESPONSIBLE_INVALID'; end if;
 if p_target<>'cancelled' and not exists(select 1 from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id and s.signature_role='delivered_by' and s.intake_revision=e.intake_revision) then raise exception 'REVIEW_RETURN_SIGNATURE_REQUIRED';end if;
 if p_target='cancelled' then
  if role_name not in ('admin','manager') or length(trim(coalesce(p_reason,'')))<5 then raise exception 'VEHICLE_VISIT_REASON_REQUIRED'; end if;
 elsif not ((w.stage in ('arrived','approved') and p_target='in_progress') or (w.stage='in_progress' and p_target='ready')) then
  raise exception 'REVIEW_RETURN_STAGE_INVALID';
 end if;
 if p_target='ready' and (role_name not in ('admin','manager','supervisor') or length(trim(coalesce(p_notes,'')))<5) then raise exception 'REVIEW_RETURN_FINDINGS_REQUIRED'; end if;
 if p_target<>'cancelled' and e.vehicle_location is distinct from 'داخل الورشة' then raise exception 'VEHICLE_VISIT_NOT_IN_WORKSHOP'; end if;
 old_stage:=w.stage;
 update public.vehicle_visit_workflows set stage=p_target,revision=revision+1,changed_at=clock_timestamp(),changed_by=actor,review_reason=null where entry_id=e.id returning * into w;
 insert into public.vehicle_visit_transitions(tenant_id,entry_id,revision,from_stage,to_stage,occurred_at,recorded_by,responsible_user_id,source,notes,reason)
 values(tenant,e.id,w.revision,old_stage,p_target,p_at,actor,coalesce(p_responsible,actor),'manual',nullif(trim(p_notes),''),nullif(trim(p_reason),''));
 if p_target='cancelled' then update public.vehicle_entries set status='Cancelled' where id=e.id; end if;
 return w;
end $$;

create function public.customer_vehicle_portal_media_scope(p_token text,p_session text,p_entry_id uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.vehicle_customer_portals;e public.vehicle_entries;r public.vehicle_entry_signed_revisions;media_ids jsonb;
begin
 p:=app_private.portal_require(p_token,p_session);
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=p.tenant_id and vehicle_id=p.vehicle_id and customer_id=p.customer_id and deleted_at is null and status<>'Cancelled';
 if not found then raise exception 'PORTAL_DOCUMENT_UNAVAILABLE';end if;
 select * into r from public.vehicle_entry_signed_revisions where vehicle_entry_id=e.id and tenant_id=p.tenant_id and revision=e.intake_revision;
 if r.id is not null then select coalesce(jsonb_agg(m->'id'),'[]'::jsonb) into media_ids from jsonb_array_elements(coalesce(r.snapshot->'vehicle_media','[]'::jsonb)) m where m->>'media_type'='image' and m->>'id' ~* '^[a-f0-9-]{36}$';end if;
 return jsonb_build_object('tenant_id',e.tenant_id,'entry_id',e.id,'revision',e.intake_revision,'media_ids',media_ids);
end $$;
revoke all on function public.customer_vehicle_portal_media_scope(text,text,uuid) from public,anon,authenticated;
grant execute on function public.customer_vehicle_portal_media_scope(text,text,uuid) to service_role;

-- Use the bound relation rather than an invoker query into a private table.
CREATE OR REPLACE FUNCTION public.guard_vehicle_handover_immutability()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare
  v_transition text := current_setting('app.vehicle_handover_transition', true);
  e public.vehicle_entries%rowtype;
begin
  if v_transition='cancel' and old.review_return_id is not null then raise exception 'REVIEW_RETURN_TERMINAL'; end if;
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
        and p.role::text in ('admin','owner','manager'))
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
$function$
;


-- Preserve attested temporary custody without weakening final receipt use.
create or replace function app_private.custody_guard_exit_projection() returns trigger
language plpgsql security definer set search_path='' as $$
declare n jsonb:=to_jsonb(NEW); o jsonb:=to_jsonb(OLD); e_id uuid; exiting boolean;
begin
 if TG_TABLE_NAME='vehicle_entries' then
  exiting:=n->>'vehicle_location'='مع العميل' and o->>'vehicle_location' is distinct from n->>'vehicle_location';
  e_id:=NEW.id;
 else
  exiting:=((n->>'vehicle_presence_status'='with_customer' and o->>'vehicle_presence_status' is distinct from n->>'vehicle_presence_status')
   or (n->>'vehicle_delivered_at' is not null and o->>'vehicle_delivered_at' is distinct from n->>'vehicle_delivered_at')
   or (TG_TABLE_NAME='job_orders' and n->>'status'='delivered' and o->>'status' is distinct from n->>'status')
   or (TG_TABLE_NAME='insurance_claims' and ((n->>'delivered_at' is not null and o->>'delivered_at' is distinct from n->>'delivered_at') or (n->>'repair_stage'='delivered' and o->>'repair_stage' is distinct from n->>'repair_stage'))));
  e_id:=(n->>'vehicle_entry_id')::uuid;
 end if;
 if not coalesce(exiting,false) then return NEW; end if;
 if e_id is null then raise exception 'CUSTODY_ENTRY_REQUIRED'; end if;
 -- A signed temporary inspection release changes custody, never final delivery.
 if (TG_TABLE_NAME='vehicle_entries' or
   (n->>'vehicle_delivered_at' is null and n->>'delivered_at' is null
    and n->>'status' is not distinct from o->>'status'
    and n->>'repair_stage' is not distinct from o->>'repair_stage'))
 and exists(select 1 from public.vehicle_inspection_releases r where r.tenant_id=NEW.tenant_id and r.vehicle_entry_id=e_id
  and r.status='signed' and r.returned_at is null and r.released_at>=transaction_timestamp()
  and (nullif(r.signature_data_url,'') is not null or r.entry_snapshot#>>'{release_acknowledgement,method}'='paper')
  and (TG_TABLE_NAME='vehicle_entries' or n->>'temporary_inspection_release_id'=r.id::text)
  and (TG_TABLE_NAME<>'job_orders' or r.work_order_id=NEW.id)
  and (TG_TABLE_NAME<>'insurance_claims' or r.claim_id=NEW.id)) then return NEW;end if;

 if not exists(select 1 from public.vehicle_handover_records h
  where h.tenant_id=NEW.tenant_id and h.vehicle_entry_id=e_id and h.status='finalized'
   and h.finalized_at=transaction_timestamp() and h.finalized_by=auth.uid()
   and (TG_TABLE_NAME<>'job_orders' or h.work_order_id=NEW.id)
   and (TG_TABLE_NAME<>'insurance_claims' or h.claim_id=NEW.id)
   and (exists(select 1 from public.vehicle_entry_custody_receipts c where c.handover_id=h.id and c.tenant_id=h.tenant_id and c.vehicle_entry_id=e_id and c.status='used')
    or exists(select 1 from public.vehicle_entry_custody_audit a where a.tenant_id=h.tenant_id and a.vehicle_entry_id=e_id and a.action='legacy_delivery_exception' and a.details->>'handover_id'=h.id::text))) then
  raise exception 'CUSTODY_RECEIPT_REQUIRED';
 end if;
 return NEW;
end $$;
