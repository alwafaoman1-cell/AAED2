-- Browser-editable profile details are not a platform/account-management API.
-- Prevent self platform escalation (proved on Development) and reactivation.
-- Trusted Auth/service-side provisioning and existing tenant/role RLS remain.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $preflight$
begin
  if to_regprocedure('public.guard_profile_authority_fields()') is not null
    or exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
      and tgname='trg_profile_authority_fields') then
    raise exception 'PROFILE_AUTHORITY_GUARD_ALREADY_EXISTS';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
      and tgname='prevent_self_role_escalation_trg' and tgenabled='O') then
    raise exception 'EXISTING_ROLE_TENANT_GUARD_REQUIRED';end if;
end $preflight$;

create function public.guard_profile_authority_fields()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  browser_actor boolean := coalesce(auth.role(),'') in ('anon','authenticated')
    or coalesce(current_setting('role',true),'') in ('anon','authenticated');
begin
  if browser_actor then
    if TG_OP='INSERT' then
      if NEW.is_platform_admin or NEW.account_status is distinct from 'active'
        or NEW.disabled_at is not null or NEW.disabled_by is not null or NEW.invited_at is not null then
        raise exception 'PROFILE_AUTHORITY_FIELDS_SERVICE_ONLY' using errcode='42501';
      end if;
    else
      if NEW.user_id is distinct from OLD.user_id
        or NEW.is_platform_admin is distinct from OLD.is_platform_admin
        or NEW.account_status is distinct from OLD.account_status
        or NEW.disabled_at is distinct from OLD.disabled_at
        or NEW.disabled_by is distinct from OLD.disabled_by
        or NEW.invited_at is distinct from OLD.invited_at then
        raise exception 'PROFILE_AUTHORITY_FIELDS_SERVICE_ONLY' using errcode='42501';
      end if;
    end if;
  end if;
  return NEW;
end $function$;
revoke all on function public.guard_profile_authority_fields() from public,anon,authenticated;
create trigger trg_profile_authority_fields before insert or update on public.profiles
for each row execute function public.guard_profile_authority_fields();

