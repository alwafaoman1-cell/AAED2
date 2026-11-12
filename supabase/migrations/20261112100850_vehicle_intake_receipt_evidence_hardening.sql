-- Keep the public RPC response time and frozen signature time identical.
-- Public-link identity is the recorded signer, not an unrelated logged-in staff account.
do $migration$
declare body text; needle text;
begin
 body:=pg_get_functiondef('app_private.custody_signature_bind()'::regprocedure);
 needle:=' NEW.signed_at:=clock_timestamp(); NEW.signed_by:=auth.uid();';
 if position(needle in body)=0 then raise exception 'CUSTODY_SIGNATURE_BIND_DEFINITION_DRIFT'; end if;
 execute replace(body,needle,$new$
 if NEW.public_link_id is not null then
  if NEW.consented_at is null then raise exception 'CUSTODY_INVALID_SIGNATURE'; end if;
  NEW.signed_at:=NEW.consented_at; NEW.signed_by:=null;
 else NEW.signed_at:=clock_timestamp(); NEW.signed_by:=auth.uid(); end if;$new$);

 body:=pg_get_functiondef('app_private.custody_child_revision()'::regprocedure);
 needle:='if TG_OP=''UPDATE'' and (NEW.vehicle_entry_id,NEW.tenant_id) is distinct from (OLD.vehicle_entry_id,OLD.tenant_id) then';
 if position(needle in body)=0 then raise exception 'CUSTODY_CHILD_REVISION_DEFINITION_DRIFT'; end if;
 execute replace(body,needle,'if TG_OP=''UPDATE'' and (NEW.tenant_id is distinct from OLD.tenant_id or (OLD.vehicle_entry_id is not null and NEW.vehicle_entry_id is distinct from OLD.vehicle_entry_id)) then');
end $migration$;
drop trigger custody_photo_update on public.vehicle_media;
create trigger custody_photo_update after update on public.vehicle_media for each row
when ((OLD.vehicle_entry_id is not null or NEW.vehicle_entry_id is not null) and (OLD.media_type='image' or NEW.media_type='image'))
execute function app_private.custody_child_revision();
