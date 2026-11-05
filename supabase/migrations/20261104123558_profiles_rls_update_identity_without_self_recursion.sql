-- Remove the actual profiles UPDATE -> profiles SELECT policy recursion edge.
-- Schema/policy-only: no profile, user, role, tenant or operational row is changed.
-- Explicitly trialled on Development before selective application; never db push.
set local lock_timeout = '2s';
set local statement_timeout = '15s';

do $preflight$
declare item record; actual record;
begin
  for item in select * from (values
    ('Customer sees only own profile', 'SELECT', 'RESTRICTIVE', '0207e915ca81458d6db8faaa6fa79f80', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('Users update own profile own fields', 'UPDATE', 'PERMISSIVE', '6a6b7c2a3a520c44377894171204e8d2', 'edc3179948d1829563dfa0bebb4a78ab'),
    ('Admins can update tenant profiles', 'UPDATE', 'PERMISSIVE', 'd64bf36a0b4d653a0cac448134e547ad', '25debd591b79f70f83b2c8dc8c473c47'),
    ('profiles restrict role change', 'UPDATE', 'RESTRICTIVE', 'b326b5062b2f0e69046810717534cb09', '5338eb21240997b3b59b990b94b68fae')
  ) as expected(name, command, kind, qual_hash, check_hash)
  loop
    select * into actual from pg_policies where schemaname='public'
      and tablename='profiles' and policyname=item.name;
    if not found or actual.cmd <> item.command or actual.permissive <> item.kind
      or actual.roles::text <> '{authenticated}'
      or md5(coalesce(actual.qual,'')) <> item.qual_hash
      or md5(coalesce(actual.with_check,'')) <> item.check_hash then
      raise exception 'PROFILE_POLICY_DRIFT: %', item.name;
    end if;
  end loop;
  if to_regprocedure('app_private.profile_update_identity(uuid)') is not null then
    raise exception 'PROFILE_IDENTITY_HELPER_ALREADY_EXISTS';
  end if;
  if has_schema_privilege('authenticated','app_private','create')
    or has_schema_privilege('anon','app_private','usage') then
    raise exception 'PRIVATE_SCHEMA_PRIVILEGE_DRIFT';
  end if;
end $preflight$;

-- Narrow old-row identity lookup, not a general RLS bypass or exposed RPC.
-- Only the caller's own row or an admin's same-tenant target is visible. This
-- follows the existing UPDATE predicates, not user-editable JWT metadata.
create function app_private.profile_update_identity(p_profile_id uuid)
returns table (previous_role public.app_role, previous_tenant uuid)
language sql stable security definer
set search_path = ''
as $function$
  select p.role, p.tenant_id
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and p.tenant_id = public.get_user_tenant_id()
    and (p.user_id = (select auth.uid()) or public.get_user_role() = 'admin'::public.app_role)
$function$;
revoke all on function app_private.profile_update_identity(uuid) from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.profile_update_identity(uuid) to authenticated;

alter policy "Users update own profile own fields" on public.profiles
with check (
  user_id = (select auth.uid())
  and role = (select i.previous_role from app_private.profile_update_identity(id) i)
  and tenant_id = (select i.previous_tenant from app_private.profile_update_identity(id) i)
);
alter policy "Admins can update tenant profiles" on public.profiles
with check (
  tenant_id = public.get_user_tenant_id() and public.get_user_role() = 'admin'::public.app_role
  and role = (select i.previous_role from app_private.profile_update_identity(id) i)
);
alter policy "profiles restrict role change" on public.profiles
with check (
  role = (select i.previous_role from app_private.profile_update_identity(id) i)
  or public.get_user_role() = 'admin'::public.app_role
);
alter policy "Customer sees only own profile" on public.profiles
using (public.get_user_role() <> 'customer'::public.app_role or user_id = (select auth.uid()));

comment on function app_private.profile_update_identity(uuid) is
  'Internal old-row identity for profiles UPDATE RLS; scoped to self/same-tenant admin. Avoids recursive policy SubLinks. Not a public API.';

