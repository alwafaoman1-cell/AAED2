-- Resolve authorization from an active database profile, never stale role rows.
-- No user/profile/tenant/role records, grants, invoice numbers or postings change.
set local lock_timeout='2s';
set local statement_timeout='15s';

do $preflight$
declare item record;
begin
  for item in select * from (values
    ('public.get_user_role()','f7a0817003d29872d60e4c174f69b2b3'),
    ('public.get_user_tenant_id()','26d361a3d365f1293bb48ea55cabbc7b'),
    ('public.has_role(uuid,public.app_role)','cfe1e05060299d5f5bfc9043653cd8e1'),
    ('public.is_platform_admin()','f1bdb6517384b8202fe29d385ba28908')
  ) expected(signature,source_hash) loop
    if to_regprocedure(item.signature) is null or
      md5(replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),'')) is distinct from item.source_hash then
      raise exception 'IDENTITY_GATE_SOURCE_DRIFT: %',item.signature;
    end if;
  end loop;
end $preflight$;

create or replace function public.get_user_tenant_id()
returns uuid language sql stable security definer set search_path=''
as $function$
  select p.tenant_id from public.profiles p
  where p.user_id=(select auth.uid())
    and p.account_status='active' and p.disabled_at is null
  limit 1;
$function$;

create or replace function public.get_user_role()
returns public.app_role language sql stable security definer set search_path=''
as $function$
  select coalesce((
    select ur.role from public.user_roles ur
    where ur.user_id=p.user_id and ur.tenant_id=p.tenant_id
    order by case ur.role
      when 'admin' then 1 when 'manager' then 2 when 'supervisor' then 3
      when 'technician' then 4 when 'insurance' then 5 else 99 end
    limit 1
  ),p.role)
  from public.profiles p
  where p.user_id=(select auth.uid())
    and p.account_status='active' and p.disabled_at is null
  limit 1;
$function$;

create or replace function public.has_role(_user_id uuid,_role public.app_role)
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.user_id=ur.user_id and p.tenant_id=ur.tenant_id
    where ur.user_id=_user_id and ur.role=_role
      and ur.tenant_id=public.get_user_tenant_id()
      and p.account_status='active' and p.disabled_at is null
  );
$function$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid()) and p.is_platform_admin
      and p.account_status='active' and p.disabled_at is null
  );
$function$;
