-- Intake evidence is separate from accounting receipts and exit handovers.
-- Existing entries remain legacy; INSERTs after this migration require a receipt.
alter table public.vehicle_entries add column intake_revision integer not null default 1;
alter table public.vehicle_entries add column custody_receipt_required boolean not null default false;
alter table public.vehicle_entries alter column custody_receipt_required set default true;
alter table public.vehicle_entry_signatures add column intake_revision integer;
alter table public.vehicle_entry_signature_links add column intake_revision integer;
create unique index vehicle_entry_signature_revision_unique on public.vehicle_entry_signatures
 (tenant_id,vehicle_entry_id,intake_revision,signature_role) where intake_revision is not null;

create table public.vehicle_entry_signed_revisions (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 vehicle_entry_id uuid not null references public.vehicle_entries(id), revision integer not null,
 signature_id uuid not null unique references public.vehicle_entry_signatures(id),
 snapshot jsonb not null, signed_at timestamptz not null,
 unique(tenant_id,vehicle_entry_id,revision)
);
create table public.vehicle_entry_custody_receipts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 vehicle_entry_id uuid not null references public.vehicle_entries(id), vehicle_id uuid not null references public.vehicles(id),
 revision_id uuid not null unique references public.vehicle_entry_signed_revisions(id),
 signature_id uuid not null unique references public.vehicle_entry_signatures(id),
 receipt_number text not null, verification_token uuid not null unique default gen_random_uuid(),
 status text not null check(status in ('draft','issued','used','cancelled','replaced')) default 'issued',
 issued_at timestamptz not null default clock_timestamp(), issued_by uuid,
 used_at timestamptz, used_by uuid, handover_id uuid unique references public.vehicle_handover_records(id),
 actual_recipient_name text, delivered_at timestamptz,
 cancelled_at timestamptz, cancelled_by uuid, cancellation_reason text,
 unique(tenant_id,receipt_number),
 check((status='used')=(handover_id is not null)),
 check(status<>'used' or (used_at is not null and used_by is not null and nullif(trim(actual_recipient_name),'') is not null))
);
create unique index vehicle_entry_one_active_custody_receipt on public.vehicle_entry_custody_receipts(tenant_id,vehicle_entry_id) where status='issued';
create index vehicle_entry_custody_receipts_entry on public.vehicle_entry_custody_receipts(tenant_id,vehicle_entry_id);
create table public.vehicle_entry_custody_audit (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 vehicle_entry_id uuid not null references public.vehicle_entries(id), receipt_id uuid references public.vehicle_entry_custody_receipts(id),
 action text not null, actor_id uuid, occurred_at timestamptz not null default clock_timestamp(), details jsonb not null default '{}'
);
alter table public.vehicle_entry_signed_revisions enable row level security;
alter table public.vehicle_entry_custody_receipts enable row level security;
alter table public.vehicle_entry_custody_audit enable row level security;
revoke all on public.vehicle_entry_signed_revisions, public.vehicle_entry_custody_receipts, public.vehicle_entry_custody_audit from public,anon,authenticated,service_role;
-- Public signing RPCs own INSERTs; staff signatures use a revision-aware RPC.
revoke insert on public.vehicle_entry_signatures from authenticated;
revoke insert,update,delete on public.vehicle_entry_signature_links from authenticated;

-- Backend uses exactly the same cloud permission keys as the permission editor.
create function app_private.custody_can(p_action text,p_tenant uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare v_role text; v_override text;
begin
 select role::text into v_role from public.profiles
 where user_id=auth.uid() and tenant_id=p_tenant and account_status='active' and disabled_at is null;
 if v_role is null then return false; end if;
 if p_action not in ('Issue','Print','Verify','Deliver','Cancel','History','Legacy exception') then return false; end if;
 if v_role='admin' then return true; end if;
 select value->('Vehicle Intake Receipts::'||p_action)->>v_role into v_override
 from public.tenant_settings where tenant_id=p_tenant and key='alwafa_roles_perms_v1';
 if v_override is not null then return v_override='Y'; end if;
 return case when p_action in ('Issue','Print','Verify','Deliver') then v_role in ('manager','supervisor')
             else v_role='manager' end;
end $$;
revoke all on function app_private.custody_can(text,uuid) from public,anon,authenticated,service_role;

create function public.vehicle_intake_receipt_permissions() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=public.get_user_tenant_id(); result jsonb:='{}'; a text;
begin
 if auth.uid() is null or t is null then raise exception 'CUSTODY_FORBIDDEN'; end if;
 foreach a in array array['Issue','Print','Verify','Deliver','Cancel','History','Legacy exception'] loop
 result:=result||jsonb_build_object(a,app_private.custody_can(a,t)); end loop; return result;
end $$;

create function app_private.custody_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'CUSTODY_SIGNED_EVIDENCE_IMMUTABLE'; end $$;
create trigger custody_revision_immutable before update or delete on public.vehicle_entry_signed_revisions for each row execute function app_private.custody_immutable();
create trigger custody_audit_immutable before update or delete on public.vehicle_entry_custody_audit for each row execute function app_private.custody_immutable();
create trigger custody_signature_immutable before update or delete on public.vehicle_entry_signatures for each row execute function app_private.custody_immutable();

create function app_private.custody_entry_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare changed boolean;
begin
 if TG_OP='INSERT' then NEW.intake_revision:=1; NEW.custody_receipt_required:=true; return NEW; end if;
 NEW.custody_receipt_required:=OLD.custody_receipt_required;
 changed:=row(NEW.vehicle_id,NEW.customer_id,NEW.entry_number,NEW.arrival_date,NEW.arrival_time,NEW.arrival_method,
 NEW.delivered_by,NEW.customer_snapshot,NEW.vehicle_snapshot,NEW.received_by_name,NEW.declaration_ar,NEW.declaration_en,
 NEW.insurance_snapshot,NEW.vehicle_condition-array['arrival_confirmation','arrival_confirmation_at','arrival_request_revision'],NEW.vehicle_contents,NEW.damage_map)
 is distinct from row(OLD.vehicle_id,OLD.customer_id,OLD.entry_number,OLD.arrival_date,OLD.arrival_time,OLD.arrival_method,
 OLD.delivered_by,OLD.customer_snapshot,OLD.vehicle_snapshot,OLD.received_by_name,OLD.declaration_ar,OLD.declaration_en,
 OLD.insurance_snapshot,OLD.vehicle_condition-array['arrival_confirmation','arrival_confirmation_at','arrival_request_revision'],OLD.vehicle_contents,OLD.damage_map);
 -- Child-document triggers may request a revision; client-supplied revision numbers are ignored.
 if changed or (pg_trigger_depth()>1 and NEW.intake_revision=OLD.intake_revision+1) then
  if exists(select 1 from public.vehicle_entry_custody_receipts where vehicle_entry_id=OLD.id and tenant_id=OLD.tenant_id and status='used') then
   raise exception 'CUSTODY_COMPLETED_VISIT_IMMUTABLE';
  end if;
  NEW.intake_revision:=OLD.intake_revision+1;
  with replaced as (update public.vehicle_entry_custody_receipts set status='replaced',cancelled_at=clock_timestamp(),
   cancelled_by=auth.uid(),cancellation_reason='signed_intake_material_change'
   where tenant_id=OLD.tenant_id and vehicle_entry_id=OLD.id and status in ('draft','issued') returning id)
  insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id,details)
  select OLD.tenant_id,OLD.id,id,'replaced',auth.uid(),jsonb_build_object('old_revision',OLD.intake_revision,'new_revision',NEW.intake_revision) from replaced;
 else NEW.intake_revision:=OLD.intake_revision; end if;
 if NEW.status='Cancelled' or NEW.deleted_at is not null then
  with cancelled as(update public.vehicle_entry_custody_receipts set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_reason='entry_cancelled_or_deleted'
  where tenant_id=OLD.tenant_id and vehicle_entry_id=OLD.id and status='issued' returning id)
  insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id,details)
  select OLD.tenant_id,OLD.id,id,'cancelled',auth.uid(),jsonb_build_object('reason','entry_cancelled_or_deleted') from cancelled;
 end if;
 return NEW;
end $$;
create trigger custody_entry_revision before insert or update on public.vehicle_entries for each row execute function app_private.custody_entry_revision();

create function app_private.custody_child_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare v_entry uuid; v_tenant uuid;
begin
 if TG_OP='UPDATE' and to_jsonb(NEW)-array['updated_at','updated_by'] = to_jsonb(OLD)-array['updated_at','updated_by'] then return NEW; end if;
 if TG_OP='DELETE' then v_entry:=OLD.vehicle_entry_id; v_tenant:=OLD.tenant_id; else v_entry:=NEW.vehicle_entry_id; v_tenant:=NEW.tenant_id; end if;
 if TG_OP='UPDATE' and (NEW.vehicle_entry_id,NEW.tenant_id) is distinct from (OLD.vehicle_entry_id,OLD.tenant_id) then raise exception 'CUSTODY_CHILD_REPARENT_FORBIDDEN'; end if;
 update public.vehicle_entries set intake_revision=intake_revision+1 where id=v_entry and tenant_id=v_tenant;
 if TG_OP='DELETE' then return OLD; end if; return NEW;
end $$;
create trigger custody_damage_revision after insert or update or delete on public.vehicle_entry_damage_marks for each row execute function app_private.custody_child_revision();
create trigger custody_technical_revision after insert or update or delete on public.vehicle_technical_declarations for each row execute function app_private.custody_child_revision();
create trigger custody_photo_insert after insert on public.vehicle_media for each row when (NEW.vehicle_entry_id is not null and NEW.media_type='image') execute function app_private.custody_child_revision();
create trigger custody_photo_update after update on public.vehicle_media for each row when (OLD.vehicle_entry_id is not null and (OLD.media_type='image' or NEW.media_type='image')) execute function app_private.custody_child_revision();
create trigger custody_photo_delete after delete on public.vehicle_media for each row when (OLD.vehicle_entry_id is not null and OLD.media_type='image') execute function app_private.custody_child_revision();

create function app_private.custody_signature_bind() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; l public.vehicle_entry_signature_links;
begin
 select * into e from public.vehicle_entries where id=NEW.vehicle_entry_id and tenant_id=NEW.tenant_id and deleted_at is null and status<>'Cancelled' for update;
 if not found or e.vehicle_id is null then raise exception 'CUSTODY_ENTRY_REQUIRED'; end if;
 if NEW.signature_role='delivered_by' then
  if NEW.public_link_id is not null then
   select * into l from public.vehicle_entry_signature_links where id=NEW.public_link_id and tenant_id=e.tenant_id and vehicle_entry_id=e.id;
   if not found or l.revoked_at is not null or l.expires_at<=clock_timestamp() or l.intake_revision is distinct from e.intake_revision or NEW.signature_source<>'customer_link' then raise exception 'CUSTODY_STALE_SIGNATURE_LINK'; end if;
  elsif not app_private.custody_can('Issue',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
  if nullif(trim(NEW.signer_name),'') is null or NEW.signature_data_url !~ '^data:image/png;base64,' or length(NEW.signature_data_url)>1500000 or NEW.signature_data_url is null then raise exception 'CUSTODY_INVALID_SIGNATURE'; end if;
 end if;
 NEW.intake_revision:=e.intake_revision;
 NEW.signed_at:=clock_timestamp(); NEW.signed_by:=auth.uid();
 return NEW;
end $$;
create trigger custody_signature_bind before insert on public.vehicle_entry_signatures for each row execute function app_private.custody_signature_bind();

create function app_private.custody_issue(p_signature uuid) returns public.vehicle_entry_custody_receipts
language plpgsql security definer set search_path='' as $$
declare s public.vehicle_entry_signatures; e public.vehicle_entries; r public.vehicle_entry_signed_revisions;
 c public.vehicle_entry_custody_receipts; snap jsonb; marks jsonb;
begin
 select * into s from public.vehicle_entry_signatures where id=p_signature and signature_role='delivered_by';
 if not found or s.intake_revision is null then raise exception 'CUSTODY_SIGNED_REVISION_REQUIRED'; end if;
 select * into e from public.vehicle_entries where id=s.vehicle_entry_id and tenant_id=s.tenant_id for update;
 select * into c from public.vehicle_entry_custody_receipts where signature_id=s.id;
 if found then return c; end if;
 if e.intake_revision<>s.intake_revision or e.deleted_at is not null or e.status='Cancelled' then raise exception 'CUSTODY_SIGNED_REVISION_REQUIRED'; end if;
 select coalesce(jsonb_agg(to_jsonb(m) order by mark_number),'[]') into marks from public.vehicle_entry_damage_marks m where vehicle_entry_id=e.id and tenant_id=e.tenant_id;
 snap:=to_jsonb(e)||jsonb_build_object('custody_print_settings',
  jsonb_build_object('companyName','شركة الوفاء للأعمال المتكاملة','companyNameEn','Alwafa Integrated Services','logoUrl','','stampUrl','','primaryColor','#d4a537')||coalesce((select value from public.tenant_settings where tenant_id=e.tenant_id and key='company_template_settings_v1'),'{}'::jsonb),
  'damage_marks',marks,'vehicle_media',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.vehicle_media m where m.vehicle_entry_id=e.id and m.tenant_id=e.tenant_id and m.deleted_at is null and m.media_type='image'),
  'vehicle_technical_declaration',
  (select to_jsonb(d) from public.vehicle_technical_declarations d where d.vehicle_entry_id=e.id and d.tenant_id=e.tenant_id),
  'work_order', (select jsonb_build_object('order_number',j.order_number) from public.job_orders j where j.id=coalesce(e.work_order_id,e.converted_work_order_id) and j.tenant_id=e.tenant_id),
  'claim', (select jsonb_build_object('claim_number',i.claim_number) from public.insurance_claims i where i.id=coalesce(e.insurance_claim_id,e.converted_claim_id) and i.tenant_id=e.tenant_id),
  'vehicle_entry_signatures',
  (select coalesce(jsonb_agg(to_jsonb(x) order by created_at),'[]') from public.vehicle_entry_signatures x where vehicle_entry_id=e.id and tenant_id=e.tenant_id and intake_revision=e.intake_revision));
 insert into public.vehicle_entry_signed_revisions(tenant_id,vehicle_entry_id,revision,signature_id,snapshot,signed_at)
 values(e.tenant_id,e.id,s.intake_revision,s.id,snap,s.signed_at) returning * into r;
 insert into public.vehicle_entry_custody_receipts(tenant_id,vehicle_entry_id,vehicle_id,revision_id,signature_id,receipt_number,issued_by)
 values(e.tenant_id,e.id,e.vehicle_id,r.id,s.id,'VIR-'||e.entry_number||'-R'||e.intake_revision::text,coalesce(s.signed_by,(select created_by from public.vehicle_entry_signature_links where id=s.public_link_id))) returning * into c;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id,details)
 values(e.tenant_id,e.id,c.id,'issued',c.issued_by,jsonb_build_object('revision',r.revision,'signature_id',s.id,'source',s.signature_source,'signed_at',s.signed_at));
 return c;
end $$;
create function app_private.custody_after_signature() returns trigger
language plpgsql security definer set search_path='' as $$
begin if NEW.signature_role='delivered_by' then perform app_private.custody_issue(NEW.id); end if; return NEW; end $$;
create trigger custody_issue_after_signature after insert on public.vehicle_entry_signatures for each row execute function app_private.custody_after_signature();

create function public.sign_vehicle_entry_revision(p_entry_id uuid,p_revision integer,p_signature text,p_signer_name text,p_phone text default null,p_title text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; s public.vehicle_entry_signatures;
begin
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=public.get_user_tenant_id() and deleted_at is null for update;
 if not found or not app_private.custody_can('Issue',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 if e.intake_revision<>p_revision then raise exception 'CUSTODY_STALE_REVISION'; end if;
 select * into s from public.vehicle_entry_signatures where tenant_id=e.tenant_id and vehicle_entry_id=e.id and intake_revision=e.intake_revision and signature_role='delivered_by';
 if found then return to_jsonb(s); end if;
 insert into public.vehicle_entry_signatures(tenant_id,vehicle_entry_id,signature_role,signer_name,signer_phone,signer_title,signature_data_url,signature_source)
 values(e.tenant_id,e.id,'delivered_by',p_signer_name,p_phone,p_title,p_signature,'staff') returning * into s;
 return to_jsonb(s);
end $$;

create function public.issue_vehicle_intake_receipt(p_entry_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; s uuid; c public.vehicle_entry_custody_receipts;
begin
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=public.get_user_tenant_id() and deleted_at is null for update;
 if not found or not app_private.custody_can('Issue',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select id into s from public.vehicle_entry_signatures where tenant_id=e.tenant_id and vehicle_entry_id=e.id and signature_role='delivered_by' and intake_revision=e.intake_revision;
 c:=app_private.custody_issue(s); return jsonb_build_object('id',c.id,'receipt_number',c.receipt_number,'status',c.status);
end $$;

create function public.save_vehicle_entry_staff_signature(p_entry_id uuid,p_revision integer,p_role text,p_signature text,p_signer_name text,p_phone text default null,p_title text default null,p_override_reason text default null) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; s public.vehicle_entry_signatures;
begin
 if p_role='delivered_by' then return public.sign_vehicle_entry_revision(p_entry_id,p_revision,p_signature,p_signer_name,p_phone,p_title); end if;
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=public.get_user_tenant_id() and deleted_at is null for update;
 if not found or not app_private.custody_can('Issue',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 if e.intake_revision<>p_revision then raise exception 'CUSTODY_STALE_REVISION'; end if;
 if p_role not in ('receiver','override') or p_signature is null or p_signature !~ '^data:image/png;base64,' or length(p_signature)>1500000 or (p_role='override' and length(trim(coalesce(p_override_reason,'')))<5) then raise exception 'CUSTODY_INVALID_SIGNATURE'; end if;
 select * into s from public.vehicle_entry_signatures where tenant_id=e.tenant_id and vehicle_entry_id=e.id and intake_revision=e.intake_revision and signature_role=p_role;
 if found then return to_jsonb(s); end if;
 insert into public.vehicle_entry_signatures(tenant_id,vehicle_entry_id,signature_role,signer_name,signer_phone,signer_title,signature_data_url,signature_source,override_reason)
 values(e.tenant_id,e.id,p_role,p_signer_name,p_phone,p_title,p_signature,'staff',p_override_reason) returning * into s;
 return to_jsonb(s);
end $$;

create function public.vehicle_intake_receipt_context(p_entry_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.vehicle_entries; receipts jsonb;
begin
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=public.get_user_tenant_id() and deleted_at is null;
 if not found or not (app_private.custody_can('Verify',e.tenant_id) or app_private.custody_can('Print',e.tenant_id) or app_private.custody_can('Issue',e.tenant_id) or app_private.custody_can('Deliver',e.tenant_id) or app_private.custody_can('History',e.tenant_id)) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'receipt_number',c.receipt_number,'status',c.status,'revision',r.revision,'issued_at',c.issued_at,'signer_name',s.signer_name) order by c.issued_at desc),'[]') into receipts
 from public.vehicle_entry_custody_receipts c join public.vehicle_entry_signed_revisions r on r.id=c.revision_id join public.vehicle_entry_signatures s on s.id=c.signature_id
 where c.vehicle_entry_id=e.id and c.tenant_id=e.tenant_id;
 return jsonb_build_object('entry_id',e.id,'revision',e.intake_revision,'required',e.custody_receipt_required,'receipts',receipts);
end $$;

create function public.verify_vehicle_intake_receipt(p_entry_id uuid,p_reference text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; c public.vehicle_entry_custody_receipts; s public.vehicle_entry_signatures; r public.vehicle_entry_signed_revisions;
begin
 select * into e from public.vehicle_entries where id=p_entry_id and tenant_id=public.get_user_tenant_id() and deleted_at is null and status<>'Cancelled';
 if not found or not app_private.custody_can('Verify',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select * into c from public.vehicle_entry_custody_receipts where tenant_id=e.tenant_id and (receipt_number=trim(p_reference) or verification_token::text=trim(p_reference));
 if not found or c.vehicle_entry_id<>e.id or c.vehicle_id<>e.vehicle_id then raise exception 'CUSTODY_WRONG_VISIT'; end if;
 select * into r from public.vehicle_entry_signed_revisions where id=c.revision_id;
 if c.status<>'issued' or r.revision<>e.intake_revision then raise exception 'CUSTODY_NOT_VALID'; end if;
 select * into s from public.vehicle_entry_signatures where id=c.signature_id;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id) values(e.tenant_id,e.id,c.id,'verified',auth.uid());
 return jsonb_build_object('id',c.id,'receipt_number',c.receipt_number,'status',c.status,'signer_name',s.signer_name,'vehicle',r.snapshot->'vehicle_snapshot','entry_number',e.entry_number,'signed_at',s.signed_at);
end $$;

create function public.vehicle_intake_receipt_document(p_receipt_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare c public.vehicle_entry_custody_receipts; r public.vehicle_entry_signed_revisions;
begin
 select * into c from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=public.get_user_tenant_id();
 if not found or not app_private.custody_can('Print',c.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select * into r from public.vehicle_entry_signed_revisions where id=c.revision_id;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id) values(c.tenant_id,c.vehicle_entry_id,c.id,'document_viewed',auth.uid());
 return jsonb_build_object('receipt',to_jsonb(c),'entry',r.snapshot,'revision',r.revision);
end $$;

create function public.cancel_vehicle_intake_receipt(p_receipt_id uuid,p_reason text) returns void
language plpgsql security definer set search_path='' as $$
declare c public.vehicle_entry_custody_receipts;
begin
 select * into c from public.vehicle_entry_custody_receipts where id=p_receipt_id and tenant_id=public.get_user_tenant_id() for update;
 if not found or not app_private.custody_can('Cancel',c.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 if length(trim(coalesce(p_reason,'')))<5 then raise exception 'CUSTODY_REASON_REQUIRED'; end if;
 if c.status<>'issued' then raise exception 'CUSTODY_NOT_VALID'; end if;
 update public.vehicle_entry_custody_receipts set status='cancelled',cancelled_at=clock_timestamp(),cancelled_by=auth.uid(),cancellation_reason=trim(p_reason) where id=c.id;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id,details) values(c.tenant_id,c.vehicle_entry_id,c.id,'cancelled',auth.uid(),jsonb_build_object('reason',trim(p_reason)));
end $$;
create function public.vehicle_intake_receipt_history(p_entry_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t uuid:=public.get_user_tenant_id(); result jsonb;
begin
 if not app_private.custody_can('History',t) or not exists(select 1 from public.vehicle_entries where id=p_entry_id and tenant_id=t) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select coalesce(jsonb_agg(to_jsonb(a) order by occurred_at,id),'[]') into result from public.vehicle_entry_custody_audit a where tenant_id=t and vehicle_entry_id=p_entry_id;
 return result;
end $$;

-- Run for every finalization, including other UI/RPC callers. Any subsequent
-- error rolls back both handover and consumption. Existing finalized rows are untouched.
create function app_private.custody_consume_at_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; c public.vehicle_entry_custody_receipts; r public.vehicle_entry_signed_revisions; reason text;
begin
 if NEW.status<>'finalized' or OLD.status='finalized' then return NEW; end if;
 if not app_private.custody_can('Deliver',NEW.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 select * into e from public.vehicle_entries where id=NEW.vehicle_entry_id and tenant_id=NEW.tenant_id and deleted_at is null and status<>'Cancelled' for update;
 if not found then raise exception 'CUSTODY_ENTRY_REQUIRED'; end if;
 reason:=trim(coalesce(NEW.snapshot_json->>'legacyReceiptReason',''));
 if reason<>'' then
  if e.custody_receipt_required or not app_private.custody_can('Legacy exception',e.tenant_id) then raise exception 'CUSTODY_LEGACY_FORBIDDEN'; end if;
  if length(reason)<5 then raise exception 'CUSTODY_REASON_REQUIRED'; end if;
  insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,action,actor_id,details)
  values(e.tenant_id,e.id,'legacy_delivery_exception',auth.uid(),jsonb_build_object('reason',reason,'handover_id',NEW.id,'recipient_name',NEW.recipient_name,'delivered_at',NEW.delivered_at));
  return NEW;
 end if;
 select * into c from public.vehicle_entry_custody_receipts where tenant_id=e.tenant_id and id::text=NEW.snapshot_json->>'custodyReceiptId' for update;
 if not found then raise exception 'CUSTODY_RECEIPT_REQUIRED'; end if;
 select * into r from public.vehicle_entry_signed_revisions where id=c.revision_id;
 if c.vehicle_entry_id<>e.id or c.vehicle_id<>e.vehicle_id or NEW.vehicle_id<>e.vehicle_id then raise exception 'CUSTODY_WRONG_VISIT'; end if;
 if c.status<>'issued' or r.revision<>e.intake_revision then raise exception 'CUSTODY_NOT_VALID'; end if;
 if nullif(trim(NEW.recipient_name),'') is null then raise exception 'CUSTODY_RECIPIENT_REQUIRED'; end if;
 update public.vehicle_entry_custody_receipts set status='used',used_at=clock_timestamp(),used_by=auth.uid(),handover_id=NEW.id,
 actual_recipient_name=NEW.recipient_name,delivered_at=NEW.delivered_at where id=c.id;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,receipt_id,action,actor_id,details)
 values(e.tenant_id,e.id,c.id,'used',auth.uid(),jsonb_build_object('handover_id',NEW.id,'recipient_name',NEW.recipient_name,'delivered_at',NEW.delivered_at));
 return NEW;
end $$;
create trigger zz_custody_consume_at_delivery before update of status on public.vehicle_handover_records for each row execute function app_private.custody_consume_at_delivery();

-- Alternate callers (paper exit, claim actions and direct status writes) must
-- not bypass the canonical finalizer and its single-use receipt transaction.
create function app_private.custody_guard_exit_projection() returns trigger
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
create trigger zz_custody_guard_exit before update on public.job_orders for each row execute function app_private.custody_guard_exit_projection();
create trigger zz_custody_guard_exit before update on public.insurance_claims for each row execute function app_private.custody_guard_exit_projection();
create trigger zz_custody_guard_exit before update on public.vehicle_entries for each row execute function app_private.custody_guard_exit_projection();
revoke all on function app_private.custody_guard_exit_projection() from public,anon,authenticated,service_role;

create function app_private.custody_link_revision() returns trigger
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries;
begin
 select * into e from public.vehicle_entries where id=NEW.vehicle_entry_id and tenant_id=NEW.tenant_id and deleted_at is null for update;
 if not found or not app_private.custody_can('Issue',e.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 NEW.intake_revision:=e.intake_revision; return NEW;
end $$;
create trigger custody_link_revision before insert on public.vehicle_entry_signature_links for each row execute function app_private.custody_link_revision();

-- Lock down private helpers and expose only narrowly authorized RPCs.
revoke all on function app_private.custody_immutable(),app_private.custody_entry_revision(),app_private.custody_child_revision(),app_private.custody_signature_bind(),app_private.custody_issue(uuid),app_private.custody_after_signature(),app_private.custody_consume_at_delivery(),app_private.custody_link_revision() from public,anon,authenticated,service_role;
revoke all on function public.vehicle_intake_receipt_permissions(),public.sign_vehicle_entry_revision(uuid,integer,text,text,text,text),public.save_vehicle_entry_staff_signature(uuid,integer,text,text,text,text,text,text),public.issue_vehicle_intake_receipt(uuid),public.vehicle_intake_receipt_context(uuid),public.verify_vehicle_intake_receipt(uuid,text),public.vehicle_intake_receipt_document(uuid),public.cancel_vehicle_intake_receipt(uuid,text),public.vehicle_intake_receipt_history(uuid) from public,anon,service_role;
grant execute on function public.vehicle_intake_receipt_permissions(),public.sign_vehicle_entry_revision(uuid,integer,text,text,text,text),public.save_vehicle_entry_staff_signature(uuid,integer,text,text,text,text,text,text),public.issue_vehicle_intake_receipt(uuid),public.vehicle_intake_receipt_context(uuid),public.verify_vehicle_intake_receipt(uuid,text),public.vehicle_intake_receipt_document(uuid),public.cancel_vehicle_intake_receipt(uuid,text),public.vehicle_intake_receipt_history(uuid) to authenticated;

-- Existing public endpoints, now revision-bound.
CREATE OR REPLACE FUNCTION public.get_vehicle_entry_for_customer_signature(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link public.vehicle_entry_signature_links%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_signature public.vehicle_entry_signatures%rowtype;
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then
    return jsonb_build_object('error', 'invalid_link');
  end if;

  select * into v_link
  from public.vehicle_entry_signature_links
  where token = trim(p_token)
    and revoked_at is null
  limit 1;

  if not found then
    return jsonb_build_object('error', 'invalid_link');
  end if;
  if v_link.expires_at <= now() then
    return jsonb_build_object('error', 'expired_link');
  end if;

  select * into v_entry
  from public.vehicle_entries
  where id = v_link.vehicle_entry_id
    and tenant_id = v_link.tenant_id
    and deleted_at is null
    and status <> 'Cancelled';

  if not found then
    return jsonb_build_object('error', 'entry_unavailable');
  end if;

  if v_link.intake_revision is distinct from v_entry.intake_revision then
    return jsonb_build_object('error','invalid_link');
  end if;

  select * into v_signature
  from public.vehicle_entry_signatures
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id
    and signature_role = 'delivered_by'
    and intake_revision = v_entry.intake_revision
  order by created_at desc
  limit 1;

  return jsonb_build_object(
    'entry_number', v_entry.entry_number,
    'arrival_date', v_entry.arrival_date,
    'arrival_time', v_entry.arrival_time,
    'arrival_method', v_entry.arrival_method,
    'customer', jsonb_build_object(
      'name', coalesce(v_entry.customer_snapshot->>'name', v_entry.delivered_by->>'full_name')
    ),
    'vehicle', jsonb_build_object(
      'plate_number', v_entry.vehicle_snapshot->>'plate_number',
      'plate_letters', v_entry.vehicle_snapshot->>'plate_letters',
      'make', coalesce(v_entry.vehicle_snapshot->>'make', v_entry.vehicle_snapshot->>'brand'),
      'model', v_entry.vehicle_snapshot->>'model',
      'year', v_entry.vehicle_snapshot->>'year',
      'color', v_entry.vehicle_snapshot->>'color',
      'vin', coalesce(v_entry.vehicle_snapshot->>'vin', v_entry.vehicle_snapshot->>'vin_number')
    ),
    'vehicle_condition', v_entry.vehicle_condition,
    'vehicle_contents', v_entry.vehicle_contents,
    'declaration_ar', v_entry.declaration_ar,
    'declaration_en', v_entry.declaration_en,
    'signed', v_signature.id is not null,
    'signer_name', coalesce(v_signature.signer_name, v_entry.delivered_by->>'full_name'),
    'signed_at', v_signature.signed_at,
    'expires_at', v_link.expires_at
  );
end;
$function$
;
CREATE OR REPLACE FUNCTION public.submit_vehicle_entry_customer_signature(p_token text, p_signature text, p_signer_name text, p_user_agent text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_link public.vehicle_entry_signature_links%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_existing_id uuid;
  v_signature_id uuid;
  v_receiver_signature text;
  v_damage_marks jsonb;
  v_now timestamptz := now();
begin
  if nullif(trim(coalesce(p_token, '')), '') is null then
    raise exception 'invalid_link';
  end if;
  if nullif(trim(coalesce(p_signer_name, '')), '') is null or length(trim(p_signer_name)) > 160 then
    raise exception 'invalid_signer_name';
  end if;
  if p_signature is null
    or p_signature !~ '^data:image/png;base64,'
    or length(p_signature) > 1500000 then
    raise exception 'invalid_signature';
  end if;

  select * into v_link
  from public.vehicle_entry_signature_links
  where token = trim(p_token)
  for update;

  if not found or v_link.revoked_at is not null then
    raise exception 'invalid_link';
  end if;
  if v_link.expires_at <= v_now then
    raise exception 'expired_link';
  end if;

  select * into v_entry
  from public.vehicle_entries
  where id = v_link.vehicle_entry_id
    and tenant_id = v_link.tenant_id
    and deleted_at is null
    and status <> 'Cancelled' for update;
  if not found then
    raise exception 'entry_unavailable';
  end if;

  if v_link.intake_revision is distinct from v_entry.intake_revision then
    raise exception 'CUSTODY_STALE_SIGNATURE_LINK';
  end if;

  select id into v_existing_id
  from public.vehicle_entry_signatures
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id
    and signature_role = 'delivered_by'
    and intake_revision = v_entry.intake_revision
  order by created_at desc
  limit 1;

  if v_existing_id is not null then
    update public.vehicle_entry_signature_links
    set consumed_at = coalesce(consumed_at, v_now)
    where id = v_link.id;
    return jsonb_build_object('ok', true, 'already_signed', true, 'signature_id', v_existing_id);
  end if;

  insert into public.vehicle_entry_signatures (
    tenant_id,
    vehicle_entry_id,
    signature_role,
    signer_name,
    signature_data_url,
    signed_at,
    public_link_id,
    signature_source,
    consented_at,
    consent_version,
    declaration_ar_snapshot,
    declaration_en_snapshot,
    signer_user_agent
  ) values (
    v_link.tenant_id,
    v_link.vehicle_entry_id,
    'delivered_by',
    trim(p_signer_name),
    p_signature,
    v_now,
    v_link.id,
    'customer_link',
    v_now,
    'vehicle-entry-v1',
    v_entry.declaration_ar,
    v_entry.declaration_en,
    left(nullif(trim(coalesce(p_user_agent, '')), ''), 500)
  )
  returning id into v_signature_id;

  update public.vehicle_entry_signature_links
  set consumed_at = v_now
  where id = v_link.id;

  insert into public.vehicle_entry_audit_logs (
    tenant_id, vehicle_entry_id, user_id, action, new_value
  ) values (
    v_link.tenant_id,
    v_link.vehicle_entry_id,
    null,
    'vehicle_entry.customer_signature_saved',
    jsonb_build_object(
      'signature_id', v_signature_id,
      'link_id', v_link.id,
      'signed_at', v_now,
      'consent_version', 'vehicle-entry-v1'
    )
  );

  select signature_data_url into v_receiver_signature
  from public.vehicle_entry_signatures
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id
    and signature_role = 'receiver'
    and intake_revision = v_entry.intake_revision
  order by created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'mark_number', mark_number,
    'damage_type', damage_type,
    'vehicle_part', vehicle_part,
    'description', description,
    'notes', notes,
    'x', x,
    'y', y
  ) order by mark_number), '[]'::jsonb) into v_damage_marks
  from public.vehicle_entry_damage_marks
  where tenant_id = v_link.tenant_id
    and vehicle_entry_id = v_link.vehicle_entry_id;

  return jsonb_build_object(
    'ok', true,
    'signature_id', v_signature_id,
    'signed_at', v_now,
    'preview_entry', jsonb_build_object(
      'entry_number', v_entry.entry_number,
      'arrival_date', v_entry.arrival_date,
      'arrival_time', v_entry.arrival_time,
      'arrival_method', v_entry.arrival_method,
      'vehicle_location', v_entry.vehicle_location,
      'vehicle_location_bay', v_entry.vehicle_location_bay,
      'received_by_name', v_entry.received_by_name,
      'customer_snapshot', jsonb_build_object(
        'name', v_entry.customer_snapshot->>'name',
        'phone', v_entry.customer_snapshot->>'phone'
      ),
      'vehicle_snapshot', jsonb_build_object(
        'plate_number', v_entry.vehicle_snapshot->>'plate_number',
        'plate_letters', v_entry.vehicle_snapshot->>'plate_letters',
        'plate_country', v_entry.vehicle_snapshot->>'plate_country',
        'brand', v_entry.vehicle_snapshot->>'brand',
        'make', v_entry.vehicle_snapshot->>'make',
        'model', v_entry.vehicle_snapshot->>'model',
        'year', v_entry.vehicle_snapshot->>'year',
        'color', v_entry.vehicle_snapshot->>'color',
        'vin', v_entry.vehicle_snapshot->>'vin',
        'vin_number', v_entry.vehicle_snapshot->>'vin_number',
        'mileage', v_entry.vehicle_snapshot->>'mileage',
        'current_owner_name', v_entry.vehicle_snapshot->>'current_owner_name',
        'highlight_color', v_entry.vehicle_snapshot->>'highlight_color'
      ),
      'insurance_snapshot', jsonb_build_object(
        'claim_number', v_entry.insurance_snapshot->>'claim_number',
        'company_name', v_entry.insurance_snapshot->>'company_name',
        'insurance_company_name', v_entry.insurance_snapshot->>'insurance_company_name',
        'employee_name', v_entry.insurance_snapshot->>'employee_name',
        'police_report_number', v_entry.insurance_snapshot->>'police_report_number',
        'lpo_number', v_entry.insurance_snapshot->>'lpo_number'
      ),
      'delivered_by', jsonb_build_object(
        'delivery_type', v_entry.delivered_by->>'delivery_type',
        'full_name', v_entry.delivered_by->>'full_name',
        'phone', v_entry.delivered_by->>'phone',
        'id_number', v_entry.delivered_by->>'id_number',
        'towing_company', v_entry.delivered_by->>'towing_company',
        'towing_plate', v_entry.delivered_by->>'towing_plate',
        'towing_country', v_entry.delivered_by->>'towing_country'
      ),
      'vehicle_condition', v_entry.vehicle_condition,
      'vehicle_contents', v_entry.vehicle_contents,
      'damage_marks', v_damage_marks,
      'declaration_ar', v_entry.declaration_ar,
      'declaration_en', v_entry.declaration_en,
      'receiver_signature_data_url', v_receiver_signature
    )
  );
end;
$function$
;

-- Avoid invalidating evidence on no-op damage-map saves.
CREATE OR REPLACE FUNCTION public.save_vehicle_entry_intake(p_entry_id uuid, p_expected_updated_at timestamp with time zone, p_form jsonb, p_technical jsonb DEFAULT NULL::jsonb, p_technical_revision integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
#variable_conflict error
declare
  v_tenant uuid := public.get_user_tenant_id(); v_actor uuid := auth.uid();
  v_old public.vehicle_entries%rowtype; v_saved public.vehicle_entries%rowtype;
  v_customer public.customers%rowtype; v_vehicle public.vehicles%rowtype;
  v_declaration public.vehicle_technical_declarations%rowtype;
  v_linked_order public.job_orders%rowtype;
  v_customer_id uuid; v_vehicle_id uuid; v_claim_id uuid; v_order_id uuid; v_company_id uuid;
  v_effective_claim uuid; v_effective_order uuid; v_insurance_channel boolean;
  v_customer_data jsonb; v_vehicle_data jsonb; v_condition jsonb; v_contents jsonb; v_damage_map jsonb;
  v_phone text; v_digits text; v_stored_digits text; v_code text; v_expected_phone text; v_phone_changed boolean;
  v_plate text; v_letters text; v_country text; v_vin text; v_stored_vin text;
  v_ids uuid[]; v_vin_ids uuid[]; v_state text; v_number text; v_mark jsonb; v_position integer := 0;
begin
  if v_actor is null or v_tenant is null
    or coalesce(public.get_user_role()::text,'') not in ('admin','manager','insurance','supervisor','technician')
    or not exists (select 1 from public.profiles p where p.user_id = v_actor and p.tenant_id = v_tenant and p.account_status = 'active') then
    raise exception 'VEHICLE_INTAKE_FORBIDDEN' using errcode = '42501';
  end if;
  -- SQL NULL must fail closed, including missing required nested objects.
  if jsonb_typeof(p_form) is distinct from 'object' or octet_length(p_form::text) > 100000
    or coalesce(p_form->>'status','') not in ('Draft','Received','Issued','Converted to Claim','Converted to Work Order')
    or jsonb_typeof(p_form->'customer') is distinct from 'object'
    or jsonb_typeof(p_form->'vehicle') is distinct from 'object'
    or jsonb_typeof(p_form->'condition') is distinct from 'object'
    or jsonb_typeof(p_form->'contents') is distinct from 'object'
    or jsonb_typeof(p_form->'insurance') is distinct from 'object'
    or jsonb_typeof(p_form->'delivered_by') is distinct from 'object'
    or jsonb_typeof(p_form->'damage_marks') is distinct from 'array'
    or coalesce(p_form#>>'{condition,visit_purpose}','') not in ('workshop','inspection')
    or nullif(p_form->>'arrival_date','') is null or nullif(p_form->>'arrival_time','') is null
    or (p_form ? 'tenant_id' and p_form->>'tenant_id' is distinct from v_tenant::text)
    or (p_form ? 'customer_phone_changed' and jsonb_typeof(p_form->'customer_phone_changed') is distinct from 'boolean') then
    raise exception 'VEHICLE_INTAKE_INVALID_FORM' using errcode = '22023';
  end if;
  if (p_technical is not null and (jsonb_typeof(p_technical) is distinct from 'object' or octet_length(p_technical::text) > 15000))
    or (p_technical is null and p_technical_revision is not null) or p_technical_revision < 1 then
    raise exception 'VEHICLE_INTAKE_INVALID_TECHNICAL' using errcode = '22023';
  end if;
  v_state := p_form->>'status'; v_phone_changed := coalesce((p_form->>'customer_phone_changed')::boolean,false);
  v_customer_id := nullif(p_form->>'customer_id','')::uuid; v_vehicle_id := nullif(p_form->>'vehicle_id','')::uuid;
  v_claim_id := nullif(p_form->>'insurance_claim_id','')::uuid; v_order_id := nullif(p_form->>'work_order_id','')::uuid;
  v_company_id := nullif(p_form->>'insurance_company_id','')::uuid;
  v_customer_data := p_form->'customer'; v_vehicle_data := p_form->'vehicle';
  v_condition := (p_form->'condition') - 'arrival_confirmation' - 'arrival_confirmation_at' - 'arrival_request_revision';
  if p_entry_id is null then
    v_condition := v_condition || jsonb_build_object('arrival_confirmation',case when v_condition->>'visit_purpose'='inspection' then 'pending' else 'confirmed' end);
  else
    select v_condition || coalesce((select jsonb_object_agg(k,v) from jsonb_each(e.vehicle_condition) p(k,v)
      where k in ('arrival_confirmation','arrival_confirmation_at','arrival_request_revision')),'{}'::jsonb)
      into v_condition from public.vehicle_entries e where e.id=p_entry_id and e.tenant_id=v_tenant;
  end if;
  v_contents := p_form->'contents';
  if exists (select 1 from jsonb_array_elements(p_form->'damage_marks') m
    where jsonb_typeof(m.value) is distinct from 'object') then
    raise exception 'VEHICLE_INTAKE_INVALID_FORM' using errcode = '22023';
  end if;
  -- Compatibility projection only: the marks table remains canonical. Keep
  -- coordinates/numbers identical to the rows written by this transaction.
  select jsonb_build_object('marks',coalesce(jsonb_agg(jsonb_build_object(
    'n',coalesce((m.value->>'mark_number')::integer,m.ordinality::integer),
    'x',nullif(m.value->>'x','')::numeric,'y',nullif(m.value->>'y','')::numeric,
    'type',nullif(m.value->>'damage_type','')) order by m.ordinality),'[]'::jsonb))
    into v_damage_map from jsonb_array_elements(p_form->'damage_marks') with ordinality m(value,ordinality);
  if p_entry_id is not null then
    select e.* into v_old from public.vehicle_entries e where e.id = p_entry_id and e.tenant_id = v_tenant and e.deleted_at is null for update;
    if not found or p_expected_updated_at is null or v_old.updated_at is distinct from p_expected_updated_at then
      raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001';
    end if;
    if v_old.status = 'Cancelled' or exists (select 1 from public.vehicle_visit_workflows w
      where w.entry_id = p_entry_id and w.tenant_id = v_tenant and w.stage in ('delivered','cancelled')) then
      raise exception 'VEHICLE_INTAKE_CLOSED' using errcode = '23514';
    end if;
    if v_old.insurance_claim_id is distinct from v_claim_id or v_old.work_order_id is distinct from v_order_id then
      raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514';
    end if;
    if p_form ? 'vehicle_location_before_edit' and v_old.vehicle_location is distinct from p_form->>'vehicle_location_before_edit' then
      raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001';
    end if;
    if v_old.status like 'Converted to %' then v_state := v_old.status; end if;
    -- Retain hidden/removed historical controls even if sent back blank.
    v_customer_data := v_old.customer_snapshot || v_customer_data || case when v_old.customer_snapshot ? 'email'
      then jsonb_build_object('email',v_old.customer_snapshot->'email') else '{}'::jsonb end;
    v_vehicle_data := v_old.vehicle_snapshot || v_vehicle_data || (select coalesce(jsonb_object_agg(h.key,h.value),'{}'::jsonb)
      from jsonb_each(v_old.vehicle_snapshot) h where h.key in ('engine_number','transmission'));
    v_condition := v_old.vehicle_condition || v_condition; v_contents := v_old.vehicle_contents || v_contents;
    v_damage_map := case when jsonb_typeof(v_old.damage_map) = 'object' then v_old.damage_map else '{}'::jsonb end || v_damage_map;
  elsif p_expected_updated_at is not null then raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001'; end if;
  -- Legacy converted links remain in their original columns. Contradictory
  -- dual links are review cases, never silently repaired by an intake edit.
  if (v_claim_id is not null and v_old.converted_claim_id is not null and v_claim_id <> v_old.converted_claim_id)
    or (v_order_id is not null and v_old.converted_work_order_id is not null and v_order_id <> v_old.converted_work_order_id)
    or (p_form ? 'converted_claim_id' and nullif(p_form->>'converted_claim_id','')::uuid is distinct from v_old.converted_claim_id)
    or (p_form ? 'converted_work_order_id' and nullif(p_form->>'converted_work_order_id','')::uuid is distinct from v_old.converted_work_order_id) then
    raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514';
  end if;
  v_effective_claim := coalesce(v_claim_id,v_old.converted_claim_id);
  v_effective_order := coalesce(v_order_id,v_old.converted_work_order_id);
  v_insurance_channel := v_effective_claim is not null or v_company_id is not null
    or coalesce((p_form#>>'{insurance,is_insurance_related}')::boolean,false)
    or nullif(btrim(p_form#>>'{insurance,company_name}'),'') is not null;

  -- Phone/code identifies today's visitor, not the vehicle's historical owner.
  v_phone := nullif(btrim(p_form#>>'{customer,phone}'),'');
  v_digits := regexp_replace(translate(coalesce(v_phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
  if v_phone is not null then
    if v_phone ~ '[A-Za-z]' then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    v_digits := case when v_digits like '00%' then substr(v_digits,3) when length(v_digits) = 8 then '968' || v_digits else v_digits end;
    v_phone := '+' || v_digits;
    if v_phone !~ '^\+[1-9][0-9]{7,14}$' then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-phone|' || v_phone,0));
  end if;
  v_code := nullif(btrim(p_form#>>'{customer,customer_code}'),'');
  if p_entry_id is null and v_phone_changed then
    raise exception 'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT' using errcode = '23514';
  end if;
  if v_customer_id is null then
    if v_phone_changed then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    if v_code is not null then
      select array_agg(c.id) into v_ids from public.customers c where c.tenant_id = v_tenant and c.deleted_at is null and lower(btrim(c.customer_code)) = lower(v_code);
    elsif v_phone is not null then
      select array_agg(c.id) into v_ids from public.customers c
        cross join lateral (select regexp_replace(translate(coalesce(c.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') as digits) n
        where c.tenant_id = v_tenant and c.deleted_at is null and (case when n.digits like '00%' then substr(n.digits,3)
          when length(n.digits) = 8 then '968' || n.digits else n.digits end) = v_digits;
    else raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    if coalesce(cardinality(v_ids),0) > 1 then raise exception 'VEHICLE_INTAKE_CUSTOMER_AMBIGUOUS' using errcode = '23514'; end if;
    if coalesce(cardinality(v_ids),0) = 0 and exists (
      select 1 from public.customers c
      cross join lateral (select regexp_replace(translate(coalesce(c.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') as digits) n
      where c.tenant_id = v_tenant and c.deleted_at is not null and
        ((v_code is not null and lower(btrim(c.customer_code)) = lower(v_code)) or
         (v_code is null and v_phone is not null and (case when n.digits like '00%' then substr(n.digits,3)
           when length(n.digits) = 8 then '968' || n.digits else n.digits end) = v_digits))
    ) then raise exception 'VEHICLE_INTAKE_CUSTOMER_RESTORE_REQUIRED' using errcode = '23514'; end if;
    v_customer_id := v_ids[1];
  end if;
  if v_customer_id is not null then
    if v_phone_changed then
      select c.* into v_customer from public.customers c where c.id = v_customer_id and c.tenant_id = v_tenant and c.deleted_at is null for update;
    else
      -- Do not demand master UPDATE policies for read-only visitor reuse.
      select c.* into v_customer from public.customers c where c.id = v_customer_id and c.tenant_id = v_tenant and c.deleted_at is null;
    end if;
    if not found then raise exception 'VEHICLE_INTAKE_CUSTOMER_UNAVAILABLE' using errcode = '23514'; end if;
    if v_code is not null and lower(btrim(v_customer.customer_code)) is distinct from lower(v_code) then
      raise exception 'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT' using errcode = '23514';
    end if;
  else
    if v_phone is null or v_code is not null then raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023'; end if;
    -- The existing code allocator is MAX+1. Serialize RPC allocations; keep its
    -- unique index as the final concurrent/non-RPC guard (no new schema here).
    perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-customer-code',0));
    insert into public.customers(tenant_id,name,phone,address,id_number)
      values(v_tenant,coalesce(nullif(btrim(v_customer_data->>'name'),''),v_phone),v_phone,
        nullif(v_customer_data->>'address',''),nullif(v_customer_data->>'id_number','')) returning * into v_customer;
    v_customer_id := v_customer.id;
  end if;
  if v_phone is not null then
    if exists (select 1 from public.customers c
      cross join lateral (select regexp_replace(translate(coalesce(c.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') as digits) n
      where c.tenant_id = v_tenant and c.deleted_at is null and c.id <> v_customer_id and (case when n.digits like '00%' then substr(n.digits,3)
        when length(n.digits) = 8 then '968' || n.digits else n.digits end) = v_digits) then
      raise exception 'VEHICLE_INTAKE_PHONE_CONFLICT' using errcode = '23514';
    end if;
    v_stored_digits := regexp_replace(translate(coalesce(v_customer.phone,''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
    v_stored_digits := case when v_stored_digits like '00%' then substr(v_stored_digits,3)
      when length(v_stored_digits) = 8 then '968' || v_stored_digits else v_stored_digits end;
    if not v_phone_changed and v_stored_digits is distinct from v_digits then
      raise exception 'VEHICLE_INTAKE_CUSTOMER_IDENTITY_CONFLICT' using errcode = '23514';
    end if;
  end if;
  if v_phone_changed then
    if v_phone is null or not (p_form ? 'customer_phone_before_edit') then
      raise exception 'VEHICLE_INTAKE_CUSTOMER_REQUIRED' using errcode = '22023';
    end if;
    v_expected_phone := nullif(p_form->>'customer_phone_before_edit','');
    if v_customer.phone is distinct from v_expected_phone then raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001'; end if;
    update public.customers c set phone = v_phone where c.id = v_customer_id and c.tenant_id = v_tenant returning c.* into v_customer;
    if not found then raise exception 'VEHICLE_INTAKE_FORBIDDEN' using errcode = '42501'; end if;
  end if;
  v_customer_data := v_customer_data || jsonb_build_object('name',v_customer.name,'phone',v_customer.phone,'customer_code',v_customer.customer_code);

  v_plate := regexp_replace(translate(coalesce(v_vehicle_data->>'plate_number',''),'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g');
  v_letters := upper(regexp_replace(translate(coalesce(v_vehicle_data->>'plate_letters',''),'ابتثجحخدذرزسشصضطظعغفقكلمنهوي','ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),'[^A-Za-z]','','g'));
  v_country := upper(btrim(coalesce(nullif(v_vehicle_data->>'plate_country',''),'OM')));
  if v_country in ('OM','OMN','OMAN','عمان','سلطنة عمان') then v_country := 'OM'; end if;
  v_vin := upper(regexp_replace(coalesce(v_vehicle_data->>'vin',''),'[^A-Za-z0-9]','','g'));
  if v_plate = '' or v_country = '' then raise exception 'VEHICLE_INTAKE_VEHICLE_REQUIRED' using errcode = '22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-vehicle|' || v_country || '|' || v_letters || '|' || v_plate,0));
  if v_vin <> '' then perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || '|intake-vin|' || v_vin,0)); end if;
  select array_agg(v.id) into v_ids from public.vehicles v where v.tenant_id = v_tenant
    and regexp_replace(translate(v.plate_number,'٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹','01234567890123456789'),'[^0-9]','','g') = v_plate
    and upper(regexp_replace(translate(coalesce(v.plate_letters,''),'ابتثجحخدذرزسشصضطظعغفقكلمنهوي','ABTTJHKDDRZSSSDTZAGFQKLMNHWY'),'[^A-Za-z]','','g')) = v_letters
    and (case when upper(btrim(coalesce(v.plate_country,'OM'))) in ('OM','OMN','OMAN','عمان','سلطنة عمان')
      then 'OM' else upper(btrim(v.plate_country)) end) = v_country;
  if v_vin <> '' then
    select array_agg(v.id) into v_vin_ids from public.vehicles v where v.tenant_id = v_tenant
      and upper(regexp_replace(coalesce(nullif(v.vin,''),v.vin_number,''),'[^A-Za-z0-9]','','g')) = v_vin;
  end if;
  if coalesce(cardinality(v_ids),0) > 1 or coalesce(cardinality(v_vin_ids),0) > 1
    or (v_ids[1] is not null and v_vin_ids[1] is not null and v_ids[1] <> v_vin_ids[1])
    or (v_vehicle_id is not null and ((v_ids[1] is not null and v_vehicle_id <> v_ids[1])
      or (v_vin_ids[1] is not null and v_vehicle_id <> v_vin_ids[1]))) then
    raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514';
  end if;
  v_vehicle_id := coalesce(v_vehicle_id,v_ids[1],v_vin_ids[1]);
  if v_vehicle_id is not null then
    select v.* into v_vehicle from public.vehicles v where v.id = v_vehicle_id and v.tenant_id = v_tenant;
    if not found then raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514'; end if;
    if v_vehicle.deleted_at is not null then raise exception 'VEHICLE_INTAKE_VEHICLE_DELETED' using errcode = '23514'; end if;
    if not (v_vehicle_id = any(coalesce(v_ids,'{}'::uuid[]))) then raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514'; end if;
    v_stored_vin := upper(regexp_replace(coalesce(nullif(v_vehicle.vin,''),v_vehicle.vin_number,''),'[^A-Za-z0-9]','','g'));
    if v_vin <> '' and v_stored_vin <> '' and v_stored_vin <> v_vin then raise exception 'VEHICLE_INTAKE_VEHICLE_CONFLICT' using errcode = '23514'; end if;
    -- Existing registry stays read-only here. The authorized NEW entry's
    -- AFTER INSERT trigger reactivates it within this same transaction.
  else
    if nullif(btrim(v_vehicle_data->>'make'),'') is null then raise exception 'VEHICLE_INTAKE_VEHICLE_REQUIRED' using errcode = '22023'; end if;
    insert into public.vehicles(tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number)
      values(v_tenant,v_customer_id,v_plate,v_letters,v_country,v_vehicle_data->>'make',coalesce(nullif(v_vehicle_data->>'model',''),'-'),
        nullif(v_vehicle_data->>'year','')::integer,nullif(v_vehicle_data->>'color',''),nullif(v_vin,''),nullif(v_vin,'')) returning * into v_vehicle;
    v_vehicle_id := v_vehicle.id;
  end if;
  v_vehicle_data := v_vehicle_data || jsonb_build_object('plate_number',v_vehicle.plate_number,'plate_letters',v_vehicle.plate_letters,'plate_country',v_vehicle.plate_country);
  if v_effective_claim is not null and not exists (select 1 from public.insurance_claims c where c.id = v_effective_claim and c.tenant_id = v_tenant
    and c.vehicle_id = v_vehicle_id and c.deleted_at is null and c.status::text not in ('cancelled','rejected')) then
    raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514'; end if;
  if v_effective_order is not null then
    select j.* into v_linked_order from public.job_orders j where j.id = v_effective_order and j.tenant_id = v_tenant
      and j.vehicle_id = v_vehicle_id and j.deleted_at is null and j.status::text <> 'delivered' and j.vehicle_delivered_at is null;
    if not found or v_linked_order.claim_id is distinct from v_effective_claim
      or (v_effective_claim is not null and v_linked_order.work_order_type is distinct from 'insurance')
      or (v_effective_claim is null and (v_linked_order.work_order_type = 'insurance' or v_insurance_channel)) then
      raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514';
    end if;
  end if;
  if v_company_id is not null and not exists (select 1 from public.insurance_companies c where c.id = v_company_id and c.tenant_id = v_tenant) then
    raise exception 'VEHICLE_INTAKE_LINK_CONFLICT' using errcode = '23514'; end if;
  if p_entry_id is null then
    v_number := public.next_vehicle_entry_number(extract(year from now() at time zone 'Asia/Muscat')::integer);
    insert into public.vehicle_entries(tenant_id,entry_number,customer_id,vehicle_id,insurance_company_id,insurance_claim_id,work_order_id,
      status,arrival_date,arrival_time,vehicle_location,vehicle_location_bay,arrival_method,received_by_name,received_by_user_id,
      delivered_by,customer_snapshot,vehicle_snapshot,insurance_snapshot,vehicle_condition,vehicle_contents,damage_map,
      declaration_ar,declaration_en,issued_at,issued_by,created_by,updated_by)
    values(v_tenant,v_number,v_customer_id,v_vehicle_id,v_company_id,v_claim_id,v_order_id,v_state,
      (p_form->>'arrival_date')::date,(p_form->>'arrival_time')::time,
      case when v_condition->>'arrival_confirmation'='pending' then 'مع العميل' else 'داخل الورشة' end,nullif(p_form->>'vehicle_location_bay',''),
      nullif(p_form->>'arrival_method',''),p_form->>'received_by_name',v_actor,p_form->'delivered_by',v_customer_data,v_vehicle_data,
      p_form->'insurance',v_condition,v_contents,v_damage_map,p_form->>'declaration_ar',p_form->>'declaration_en',
      case when v_state = 'Issued' then now() end,case when v_state = 'Issued' then v_actor end,v_actor,v_actor) returning * into v_saved;
  else
    update public.vehicle_entries e set customer_id = v_customer_id, vehicle_id = v_vehicle_id, insurance_company_id = v_company_id,
      status = v_state, arrival_date = (p_form->>'arrival_date')::date, arrival_time = (p_form->>'arrival_time')::time,
      vehicle_location_bay = nullif(p_form->>'vehicle_location_bay',''), arrival_method = p_form->>'arrival_method', received_by_name = p_form->>'received_by_name',
      delivered_by = e.delivered_by || p_form->'delivered_by', customer_snapshot = v_customer_data, vehicle_snapshot = v_vehicle_data,
      insurance_snapshot = e.insurance_snapshot || p_form->'insurance', vehicle_condition = v_condition, vehicle_contents = v_contents, damage_map = v_damage_map,
      declaration_ar = coalesce(p_form->>'declaration_ar',e.declaration_ar), declaration_en = coalesce(p_form->>'declaration_en',e.declaration_en),
      issued_at = case when v_state = 'Issued' then coalesce(e.issued_at,now()) else e.issued_at end,
      issued_by = case when v_state = 'Issued' then coalesce(e.issued_by,v_actor) else e.issued_by end, updated_by = v_actor
      where e.id = p_entry_id and e.tenant_id = v_tenant and e.updated_at = p_expected_updated_at returning e.* into v_saved;
    if not found then raise exception 'VEHICLE_INTAKE_STALE' using errcode = '40001'; end if;
  end if;
  if (select coalesce(jsonb_agg(jsonb_build_array(m.mark_number,m.damage_type,m.vehicle_part,m.description,m.related_to_incident,m.expected_action,m.notes,m.x,m.y,m.color) order by m.mark_number),'[]') from public.vehicle_entry_damage_marks m where m.vehicle_entry_id=v_saved.id and m.tenant_id=v_tenant)
   is distinct from
   (select coalesce(jsonb_agg(jsonb_build_array(coalesce((value->>'mark_number')::integer,ordinality::integer),nullif(value->>'damage_type',''),nullif(value->>'vehicle_part',''),nullif(value->>'description',''),coalesce((value->>'related_to_incident')::boolean,true),nullif(value->>'expected_action',''),nullif(value->>'notes',''),nullif(value->>'x','')::numeric,nullif(value->>'y','')::numeric,nullif(value->>'color','')) order by coalesce((value->>'mark_number')::integer,ordinality::integer)),'[]') from jsonb_array_elements(p_form->'damage_marks') with ordinality) then
  delete from public.vehicle_entry_damage_marks m where m.vehicle_entry_id = v_saved.id and m.tenant_id = v_tenant;
  for v_mark in select m.value from jsonb_array_elements(p_form->'damage_marks') m loop
    if jsonb_typeof(v_mark) is distinct from 'object' then raise exception 'VEHICLE_INTAKE_INVALID_FORM' using errcode = '22023'; end if;
    v_position := v_position + 1;
    insert into public.vehicle_entry_damage_marks(tenant_id,vehicle_entry_id,mark_number,damage_type,vehicle_part,description,related_to_incident,expected_action,notes,x,y,color)
      values(v_tenant,v_saved.id,coalesce((v_mark->>'mark_number')::integer,v_position),nullif(v_mark->>'damage_type',''),nullif(v_mark->>'vehicle_part',''),
        nullif(v_mark->>'description',''),coalesce((v_mark->>'related_to_incident')::boolean,true),nullif(v_mark->>'expected_action',''),nullif(v_mark->>'notes',''),
        nullif(v_mark->>'x','')::numeric,nullif(v_mark->>'y','')::numeric,nullif(v_mark->>'color',''));
  end loop;
  end if;
  select d.* into v_declaration from public.vehicle_technical_declarations d where d.tenant_id = v_tenant and d.vehicle_entry_id = v_saved.id for update;
  if p_technical is not null then
    if (v_declaration.id is null and p_technical_revision is not null)
      or (v_declaration.id is not null and v_declaration.revision is distinct from p_technical_revision) then
      raise exception 'VEHICLE_INTAKE_TECHNICAL_STALE' using errcode = '40001'; end if;
    if v_declaration.id is null then
      insert into public.vehicle_technical_declarations(tenant_id,vehicle_entry_id,form_data) values(v_tenant,v_saved.id,p_technical) returning * into v_declaration;
    elsif v_declaration.form_data is distinct from p_technical then
      update public.vehicle_technical_declarations d set form_data = p_technical where d.tenant_id = v_tenant
        and d.vehicle_entry_id = v_saved.id and d.revision = p_technical_revision returning d.* into v_declaration;
      if not found then raise exception 'VEHICLE_INTAKE_TECHNICAL_STALE' using errcode = '40001'; end if;
    end if;
  end if;
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(v_tenant,v_saved.id,v_actor,case when p_entry_id is null then 'vehicle_entry.created' else 'vehicle_entry.updated' end,
      jsonb_build_object('status',v_state,'entry_number',v_saved.entry_number,'technical_revision',v_declaration.revision));
  select * into v_saved from public.vehicle_entries where id=v_saved.id and tenant_id=v_tenant;
  return jsonb_build_object('entry',to_jsonb(v_saved),'technical',case when v_declaration.id is not null then to_jsonb(v_declaration) end);
end $function$
;
