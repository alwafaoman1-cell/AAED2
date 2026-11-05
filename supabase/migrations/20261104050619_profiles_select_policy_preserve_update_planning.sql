-- Preserve the working restrictive profile SELECT policy and self-update safety.
-- Version aligned to the confirmed Development migration ledger.
-- A scalar SubLink here regresses PostgreSQL UPDATE policy rewriting; the other
-- 53 reviewed scalar UID optimizations remain. No data/grant changes.
select set_config('security_audit.approved_project_ref','rrhyglrnlveygyiandhs',true);
-- CANDIDATE ONLY. Main approval and apply_migration on Development required.
-- Root: profiles UPDATE checks read profiles; a SubLink in its SELECT policy
-- makes PostgreSQL fireRIRrules re-enter the active profiles policy expansion.
-- Restore only ID 17's proven pre-change expression. Keep restrictive SELECT,
-- authenticated target, user-role/customer ownership, ID 18, and all other RLS.
-- No new helper, grant, role/tenant policy relaxation, or operational write.
do $profile_recursion_guard$
declare p record;
begin
  if current_setting('security_audit.approved_project_ref',true)
      is distinct from 'rrhyglrnlveygyiandhs' then raise exception 'DEVELOPMENT_ACK_REQUIRED';end if;
  select * into p from pg_policies where schemaname='public' and tablename='profiles'
    and policyname='Customer sees only own profile';
  if not found or p.cmd<>'SELECT' or p.permissive<>'RESTRICTIVE' or p.roles::text<>'{authenticated}'
    or p.with_check is not null
    or md5(coalesce(p.qual,'<null>')||chr(31)||coalesce(p.with_check,'<null>')) is distinct from '94d9c0d305e2a916b7c1ec09aa413c4d' then
    raise exception 'PROFILE_ID17_POST54_DEFINITION_DRIFT';
  end if;
  execute 'alter policy "Customer sees only own profile" on public.profiles using (((get_user_role() <> ''customer''::app_role) OR (user_id = auth.uid())))';
end;
$profile_recursion_guard$;

