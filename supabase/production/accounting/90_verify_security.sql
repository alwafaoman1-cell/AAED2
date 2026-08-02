\set ON_ERROR_STOP on
\pset pager off

with relation_grants as (
 select c.relname,case when a.grantee=0 then 'PUBLIC' else g.rolname end grantee,a.privilege_type
 from pg_class c join pg_namespace n on n.oid=c.relnamespace
 cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
 left join pg_roles g on g.oid=a.grantee
 where n.nspname='public' and c.relname like 'accounting\_%' escape '\'
), function_grants as (
 select p.proname,case when a.grantee=0 then 'PUBLIC' else g.rolname end grantee,a.privilege_type
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
 left join pg_roles g on g.oid=a.grantee
 where n.nspname='public' and p.proname like 'accounting\_%' escape '\'
)
select jsonb_build_object(
 'relation_public',(select count(*) from relation_grants where grantee='PUBLIC'),
 'relation_anon',(select count(*) from relation_grants where grantee='anon'),
 'function_public_execute',(select count(*) from function_grants where grantee='PUBLIC' and privilege_type='EXECUTE'),
 'function_anon_execute',(select count(*) from function_grants where grantee='anon' and privilege_type='EXECUTE'),
 'rls_disabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname like 'accounting\_%' escape '\' and c.relkind in('r','p') and not c.relrowsecurity),
 'unsafe_security_definer',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname like 'accounting\_%' escape '\' and p.prosecdef and not coalesce(p.proconfig,array[]::text[]) && array['search_path=pg_catalog, public','search_path=pg_catalog,public'])
) result;
