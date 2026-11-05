-- First linkage is an atomic server-writer operation, never a browser-editable
-- JSON/timestamp privilege. current_user is the database execution role (not JWT
-- metadata); the existing SECURITY DEFINER writer runs as its database owner.
do $migration$
declare v_definition text; v_marker text := '  select * into strict v_entry from public.vehicle_entries';
begin
  v_definition := pg_get_functiondef('app_private.guard_entry_inspection_identity()'::regprocedure);
  if position(v_marker in v_definition) = 0 then raise exception 'INSPECTION_GUARD_DEFINITION_CHANGED'; end if;
  execute replace(v_definition, v_marker,
    E'  if current_user in (''authenticated'', ''anon'') and (tg_op = ''INSERT'' or old.details->>''vehicleEntryId'' is null) then\n'
    || E'    raise exception ''INSPECTION_LINK_CREATION_REQUIRES_SERVER'' using errcode = ''42501'';\n  end if;\n'
    || v_marker);
end;
$migration$;
