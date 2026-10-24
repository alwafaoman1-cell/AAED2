-- This legacy helper was callable by any tenant admin and could move a user
-- from another tenant into staging. Preserve its intended onboarding use,
-- but permit only an active platform admin and never move an assigned user.
create or replace function public.attach_user_to_staging_tenant(_email text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_user_id uuid;
  v_staging constant uuid := '00000000-0000-4000-8000-000000005741'::uuid;
begin
  if auth.uid() is null or not public.is_platform_admin() then
    raise exception 'STAGING_ATTACHMENT_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if nullif(btrim(_email), '') is null then
    raise exception 'STAGING_EMAIL_REQUIRED' using errcode = '22023';
  end if;

  select id into v_user_id
  from auth.users
  where lower(email) = lower(btrim(_email))
  limit 1;
  if v_user_id is null then
    raise exception 'STAGING_USER_NOT_FOUND' using errcode = '22023';
  end if;

  if exists (
    select 1 from public.user_roles
    where user_id = v_user_id and tenant_id is distinct from v_staging
  ) then
    raise exception 'STAGING_TARGET_ALREADY_ASSIGNED' using errcode = '42501';
  end if;

  update public.profiles
     set tenant_id = v_staging, role = 'admin'
   where user_id = v_user_id
     and (tenant_id is null or tenant_id = v_staging);
  if not found then
    raise exception 'STAGING_TARGET_ALREADY_ASSIGNED_OR_MISSING' using errcode = '42501';
  end if;

  return jsonb_build_object('ok', true, 'user_id', v_user_id, 'tenant_id', v_staging);
end;
$function$;

revoke all on function public.attach_user_to_staging_tenant(text) from public, anon;
grant execute on function public.attach_user_to_staging_tenant(text) to authenticated;
