-- A child row's tenant must match its entry before the private legacy archive
-- trigger can inspect that entry. Do not rely on a single-column FK plus RLS
-- on the child tenant to establish ownership of the referenced parent.
create or replace function app_private.custody_preserve_legacy_child() returns trigger
language plpgsql security definer set search_path='' as $$
declare target_entry uuid; target_tenant uuid;
begin
 if TG_OP='DELETE' then target_entry:=OLD.vehicle_entry_id; target_tenant:=OLD.tenant_id;
 else target_entry:=NEW.vehicle_entry_id; target_tenant:=NEW.tenant_id; end if;
 if exists(select 1 from public.vehicle_entries e where e.id=target_entry and e.tenant_id is distinct from target_tenant) then raise exception 'CUSTODY_WRONG_VISIT'; end if;
 if TG_OP='UPDATE' and to_jsonb(NEW)-array['updated_at','updated_by'] = to_jsonb(OLD)-array['updated_at','updated_by'] then return NEW; end if;
 if TG_OP='DELETE' then perform app_private.custody_preserve_legacy(target_entry); return OLD; end if;
 perform app_private.custody_preserve_legacy(target_entry); return NEW;
end $$;

do $migration$
declare body text; needle text;
begin
 body:=pg_get_functiondef('app_private.custody_signature_bind()'::regprocedure);
 needle:=' if not found or e.vehicle_id is null then raise exception ''CUSTODY_ENTRY_REQUIRED''; end if;';
 if position(needle in body)=0 then raise exception 'CUSTODY_SIGNATURE_BIND_DEFINITION_DRIFT'; end if;
 execute replace(body,needle,needle||E'\n'||' if not exists(select 1 from public.vehicles v where v.id=e.vehicle_id and v.tenant_id=e.tenant_id) then raise exception ''CUSTODY_WRONG_VISIT''; end if;');
end $migration$;
revoke all on function app_private.custody_preserve_legacy_child() from public,anon,authenticated,service_role;
