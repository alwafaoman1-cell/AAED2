-- Production counterpart with transaction ownership left to the migration runner.
-- Same verified active-profile guard; no data writes and no internal commit.
-- Development-verified document permission gate. No user/profile/data repair.
-- Filename matches the observed Development ledger; no ledger edits.

set local lock_timeout='5s';
do $$ begin
  if md5(pg_get_functiondef('public.document_access_allowed(text)'::regprocedure))
      is distinct from '7ee262cd61fd3e6acf1bd7b3641ea4dd' then
    raise exception 'DOCUMENT_ACCESS_FUNCTION_DRIFT';
  end if;
end $$;
create or replace function public.document_access_allowed(p_scope text)
returns boolean language sql stable security invoker
set search_path to 'pg_catalog','public'
as $function$
  -- Match the application's active-profile gate server-side as well. An older
  -- still-valid JWT must not keep private document access after disablement.
  select exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.account_status='active' and p.disabled_at is null
  ) and case p_scope
    when 'operational' then public.get_user_role() in ('admin'::public.app_role,'manager'::public.app_role,'insurance'::public.app_role,'supervisor'::public.app_role)
    when 'finance' then public.get_user_role() in ('admin'::public.app_role,'manager'::public.app_role,'accountant'::public.app_role)
    when 'restricted' then public.get_user_role() in ('admin'::public.app_role,'manager'::public.app_role)
    else false
  end;
$function$;
