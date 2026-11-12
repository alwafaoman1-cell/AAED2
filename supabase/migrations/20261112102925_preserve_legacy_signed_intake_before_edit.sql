-- Preserve the current pre-cutover signed form before its first edit. This is
-- explicitly a legacy baseline, not a reconstructed historical form or receipt.
-- An unknown legacy signing timestamp stays unknown.
alter table public.vehicle_entry_signed_revisions alter column signed_at drop not null;
alter table public.vehicle_entry_signed_revisions add constraint custody_revision_signing_time
 check(signed_at is not null or coalesce(snapshot->>'legacy_baseline','false')='true');

create function app_private.custody_intake_snapshot(p_entry_id uuid) returns jsonb
language sql volatile security definer set search_path='' as $$
 select to_jsonb(e)||jsonb_build_object(
 'custody_print_settings',jsonb_build_object('companyName','شركة الوفاء للأعمال المتكاملة','companyNameEn','Alwafa Integrated Services','logoUrl','','stampUrl','','primaryColor','#d4a537')||coalesce((select value from public.tenant_settings where tenant_id=e.tenant_id and key='company_template_settings_v1'),'{}'),
 'damage_marks',(select coalesce(jsonb_agg(to_jsonb(m) order by mark_number),'[]') from public.vehicle_entry_damage_marks m where m.vehicle_entry_id=e.id and m.tenant_id=e.tenant_id),
 'vehicle_media',(select coalesce(jsonb_agg(to_jsonb(m)),'[]') from public.vehicle_media m where m.vehicle_entry_id=e.id and m.tenant_id=e.tenant_id and m.deleted_at is null and m.media_type='image'),
 'vehicle_technical_declaration',(select to_jsonb(d) from public.vehicle_technical_declarations d where d.vehicle_entry_id=e.id and d.tenant_id=e.tenant_id),
 'work_order',(select jsonb_build_object('order_number',j.order_number) from public.job_orders j where j.id=coalesce(e.work_order_id,e.converted_work_order_id) and j.tenant_id=e.tenant_id),
 'claim',(select jsonb_build_object('claim_number',c.claim_number) from public.insurance_claims c where c.id=coalesce(e.insurance_claim_id,e.converted_claim_id) and c.tenant_id=e.tenant_id),
 'vehicle_entry_signatures',(select coalesce(jsonb_agg(to_jsonb(s) order by s.created_at desc),'[]') from public.vehicle_entry_signatures s where s.vehicle_entry_id=e.id and s.tenant_id=e.tenant_id
  and (s.intake_revision=e.intake_revision or (not e.custody_receipt_required and e.intake_revision=1 and s.intake_revision is null))))
 from public.vehicle_entries e where e.id=p_entry_id;
$$;

create function app_private.custody_preserve_legacy(p_entry_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.vehicle_entries; s public.vehicle_entry_signatures; r uuid; snap jsonb;
begin
 select * into e from public.vehicle_entries where id=p_entry_id for update;
 if not found or e.custody_receipt_required or e.intake_revision<>1 then return; end if;
 if exists(select 1 from public.vehicle_entry_signed_revisions where tenant_id=e.tenant_id and vehicle_entry_id=e.id and revision=1) then return; end if;
 select * into s from public.vehicle_entry_signatures where tenant_id=e.tenant_id and vehicle_entry_id=e.id and signature_role='delivered_by' and intake_revision is null order by created_at desc limit 1;
 if not found then return; end if;
 snap:=app_private.custody_intake_snapshot(e.id)||jsonb_build_object('legacy_baseline',true,'legacy_baseline_preserved_at',clock_timestamp());
 insert into public.vehicle_entry_signed_revisions(tenant_id,vehicle_entry_id,revision,signature_id,snapshot,signed_at)
 values(e.tenant_id,e.id,1,s.id,snap,s.signed_at) returning id into r;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,action,actor_id,details)
 values(e.tenant_id,e.id,'legacy_intake_preserved',auth.uid(),jsonb_build_object('revision_id',r,'signature_id',s.id,'change_kind','before_first_material_edit'));
end $$;

create function app_private.custody_preserve_legacy_child() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if TG_OP='UPDATE' and to_jsonb(NEW)-array['updated_at','updated_by'] = to_jsonb(OLD)-array['updated_at','updated_by'] then return NEW; end if;
 if TG_OP='DELETE' then perform app_private.custody_preserve_legacy(OLD.vehicle_entry_id); return OLD; end if;
 perform app_private.custody_preserve_legacy(NEW.vehicle_entry_id); return NEW;
end $$;
create trigger custody_preserve_legacy_damage before insert or update or delete on public.vehicle_entry_damage_marks for each row execute function app_private.custody_preserve_legacy_child();
create trigger custody_preserve_legacy_technical before insert or update or delete on public.vehicle_technical_declarations for each row execute function app_private.custody_preserve_legacy_child();
create trigger custody_preserve_legacy_photo_insert before insert on public.vehicle_media for each row when (NEW.vehicle_entry_id is not null and NEW.media_type='image') execute function app_private.custody_preserve_legacy_child();
create trigger custody_preserve_legacy_photo_update before update on public.vehicle_media for each row when ((OLD.vehicle_entry_id is not null or NEW.vehicle_entry_id is not null) and (OLD.media_type='image' or NEW.media_type='image')) execute function app_private.custody_preserve_legacy_child();
create trigger custody_preserve_legacy_photo_delete before delete on public.vehicle_media for each row when (OLD.vehicle_entry_id is not null and OLD.media_type='image') execute function app_private.custody_preserve_legacy_child();

do $migration$
declare body text; needle text; start_at integer; stop_at integer;
begin
 body:=pg_get_functiondef('app_private.custody_entry_revision()'::regprocedure);
 needle:='  NEW.intake_revision:=OLD.intake_revision+1;';
 if position(needle in body)=0 then raise exception 'CUSTODY_REVISION_DEFINITION_DRIFT'; end if;
 execute replace(body,needle,'  perform app_private.custody_preserve_legacy(OLD.id);'||E'\n'||needle);
 -- Share the same frozen source for new receipts and legacy preservation.
 body:=pg_get_functiondef('app_private.custody_issue(uuid)'::regprocedure);
 start_at:=position(' select coalesce(jsonb_agg(to_jsonb(m)' in body);
 stop_at:=position(' insert into public.vehicle_entry_signed_revisions' in body);
 if start_at=0 or stop_at<=start_at then raise exception 'CUSTODY_ISSUE_DEFINITION_DRIFT'; end if;
 execute substring(body from 1 for start_at-1)||' snap:=app_private.custody_intake_snapshot(e.id);'||E'\n'||substring(body from stop_at);
end $migration$;

create function public.vehicle_entry_signed_revision_document(p_revision_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.vehicle_entry_signed_revisions;
begin
 select * into r from public.vehicle_entry_signed_revisions where id=p_revision_id and tenant_id=public.get_user_tenant_id();
 if not found or not app_private.custody_can('Print',r.tenant_id) then raise exception 'CUSTODY_FORBIDDEN'; end if;
 insert into public.vehicle_entry_custody_audit(tenant_id,vehicle_entry_id,action,actor_id,details)
 values(r.tenant_id,r.vehicle_entry_id,'signed_revision_viewed',auth.uid(),jsonb_build_object('revision_id',r.id));
 return r.snapshot;
end $$;
revoke all on function app_private.custody_intake_snapshot(uuid),app_private.custody_preserve_legacy(uuid),app_private.custody_preserve_legacy_child() from public,anon,authenticated,service_role;
revoke all on function public.vehicle_entry_signed_revision_document(uuid) from public,anon,service_role;
grant execute on function public.vehicle_entry_signed_revision_document(uuid) to authenticated;
