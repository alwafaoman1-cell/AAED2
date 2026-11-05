-- Production source is byte-equivalent after CRLF normalization, verified read-only.
-- Preserve the original reviewed hash, trigger binding and the tested fixed body.
-- Source-only candidate. Main must coordinate this with the paired manage-users
-- change on verified Development; do not apply/deploy either half in isolation.
-- No existing account, tenant, role, policy or Auth configuration is changed.
do $preflight$
begin
  if pg_catalog.md5(replace(pg_catalog.pg_get_functiondef('public.handle_new_user()'::regprocedure),chr(13),''))
     <> '01fbc7293f1c21dc236c112ef10190c7' then
    raise exception 'AUTH_SIGNUP_TRIGGER_SOURCE_DRIFT';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and tgfoid = 'public.handle_new_user()'::regprocedure
      and tgtype = 5 -- AFTER INSERT, FOR EACH ROW
      and tgenabled = 'O'
  ) then
    raise exception 'AUTH_SIGNUP_TRIGGER_BINDING_DRIFT';
  end if;
end;
$preflight$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  -- This USER-EDITABLE marker only REDUCES access: no profile, tenant or role.
  -- It is NOT evidence of an admin request. Public callers may also opt out.
  -- manage-users supplies it to BOTH createUser.user_metadata and invite.data,
  -- then provisions through a separately authorized, checked service-side write.
  -- Do not infer authority from the Auth DB actor or invited_at. Admin Auth can
  -- apply app_metadata/invited_at AFTER INSERT, too late for this trigger.
  if NEW.raw_user_meta_data->>'profile_provisioning' = 'manage-users' then
    return NEW;
  end if;

  -- Preserve the existing fresh-workshop owner default, but never join/create
  -- a caller-selected tenant and never derive authorization from user metadata.
  v_tenant_id := pg_catalog.gen_random_uuid();
  insert into public.tenants (id, name)
  values (v_tenant_id, coalesce(NEW.raw_user_meta_data->>'company_name', 'ورشتي'));
  -- No ON CONFLICT reuse: a UUID collision must fail, not attach to a tenant.
  insert into public.profiles (user_id, tenant_id, full_name, role, is_platform_admin)
  values (
    NEW.id,
    v_tenant_id,
    coalesce(NEW.raw_user_meta_data->>'full_name', ''),
    'admin'::public.app_role,
    false
  );
  return NEW;
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
