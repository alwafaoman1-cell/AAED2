\pset pager off
\pset tuples_only on

select jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'accounting_tables', (
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relname like 'accounting\_%' escape '\'
  ),
  'accounting_views', (
    select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('v','m') and c.relname like 'accounting\_%' escape '\'
  ),
  'accounting_functions', (
    select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'accounting\_%' escape '\'
  )
) as phase5b_identity;

select jsonb_build_object(
  'supplier_column', (
    select jsonb_build_object(
      'type',udt_name,'nullable',is_nullable,'default',column_default
    )
    from information_schema.columns
    where table_schema='public' and table_name='expenses' and column_name='supplier_id'
  ),
  'matching_fk_count', (
    select count(*)
    from pg_constraint c
    where c.conrelid=to_regclass('public.expenses')
      and c.contype='f'
      and c.confrelid=to_regclass('public.suppliers')
      and c.confdeltype='n'
      and pg_get_constraintdef(c.oid) ilike 'foreign key (supplier_id)%'
  ),
  'matching_index_count', (
    select count(*) from pg_indexes
    where schemaname='public' and tablename='expenses'
      and indexdef ilike '%(supplier_id)%'
  )
) as expense_supplier_definition;

with column_signature as (
  select md5(coalesce(string_agg(
    concat_ws('|',column_name,udt_schema,udt_name,is_nullable,coalesce(column_default,''),coalesce(generation_expression,'')),
    '||' order by column_name
  ),'')) signature
  from information_schema.columns
  where table_schema='public' and table_name='insurance_claims'
), constraints_signature as (
  select md5(coalesce(string_agg(pg_get_constraintdef(c.oid,true),'||' order by c.conname),'')) signature
  from pg_constraint c where c.conrelid=to_regclass('public.insurance_claims')
), indexes_signature as (
  select md5(coalesce(string_agg(indexdef,'||' order by indexname),'')) signature
  from pg_indexes where schemaname='public' and tablename='insurance_claims'
), triggers_signature as (
  select md5(coalesce(string_agg(pg_get_triggerdef(t.oid,true),'||' order by t.tgname),'')) signature
  from pg_trigger t where t.tgrelid=to_regclass('public.insurance_claims') and not t.tgisinternal
), policies_signature as (
  select md5(coalesce(string_agg(
    concat_ws('|',policyname,cmd,roles::text,coalesce(qual,''),coalesce(with_check,'')),
    '||' order by policyname
  ),'')) signature
  from pg_policies where schemaname='public' and tablename='insurance_claims'
)
select jsonb_build_object(
  'columns',(select signature from column_signature),
  'constraints',(select signature from constraints_signature),
  'indexes',(select signature from indexes_signature),
  'triggers',(select signature from triggers_signature),
  'policies',(select signature from policies_signature)
) as insurance_claims_definition_hashes;

with requested(name,kind) as (values
  ('accounting_claims_summary_view','view'),
  ('accounting_work_order_profit_view','view'),
  ('reports_center_rows_v1','view'),
  ('reports_expense_facts_v1','view'),
  ('reports_insurance_statement_facts_v1','view'),
  ('reports_invoice_facts_v1','view'),
  ('reports_payment_facts_v1','view'),
  ('reports_work_order_facts_v1','view'),
  ('accounting_dashboard_summary_rpc','function'),
  ('accounting_reports_summary_rpc','function'),
  ('accounting_report_permission','function'),
  ('accounting_validate_source_link','function')
), object_hashes as (
  select r.name,r.kind,
    case
      when r.kind='view' then (
        select md5(pg_get_viewdef(c.oid,true))
        from pg_class c join pg_namespace n on n.oid=c.relnamespace
        where n.nspname='public' and c.relname=r.name and c.relkind in ('v','m') limit 1
      )
      else (
        select md5(string_agg(pg_get_functiondef(p.oid),'||' order by pg_get_function_identity_arguments(p.oid)))
        from pg_proc p join pg_namespace n on n.oid=p.pronamespace
        where n.nspname='public' and p.proname=r.name
      )
    end definition_hash
  from requested r
)
select coalesce(jsonb_agg(to_jsonb(object_hashes) order by kind,name),'[]'::jsonb)
as accounting_object_definition_hashes
from object_hashes;

with duplicate_groups as (
  select tenant_id,payment_number,count(*) row_count,
    count(distinct amount) amount_variants,
    count(distinct payment_date) date_variants,
    count(distinct id) id_count
  from public.claim_payments
  where nullif(btrim(payment_number),'') is not null
  group by tenant_id,payment_number
  having count(*)>1
), cross_tenant_numbers as (
  select payment_number,count(distinct tenant_id) tenants
  from public.claim_payments
  where nullif(btrim(payment_number),'') is not null
  group by payment_number
  having count(distinct tenant_id)>1
)
select jsonb_build_object(
  'groups',(select count(*) from duplicate_groups),
  'rows',(select coalesce(sum(row_count),0) from duplicate_groups),
  'groups_with_different_amounts',(select count(*) from duplicate_groups where amount_variants>1),
  'groups_with_different_dates',(select count(*) from duplicate_groups where date_variants>1),
  'groups_with_distinct_ids',(select count(*) from duplicate_groups where id_count=row_count),
  'numbers_crossing_tenants',(select count(*) from cross_tenant_numbers)
) as claim_payment_duplicate_metadata;

with relation_grants as (
  select c.relkind,c.relname,a.privilege_type,
    case when a.grantee=0 then 'PUBLIC' else g.rolname end grantee
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl,acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end,c.relowner))) a
  left join pg_roles g on g.oid=a.grantee
  where n.nspname='public' and c.relname like 'accounting\_%' escape '\'
), function_grants as (
  select p.proname,pg_get_function_identity_arguments(p.oid) args,a.privilege_type,
    case when a.grantee=0 then 'PUBLIC' else g.rolname end grantee
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
  left join pg_roles g on g.oid=a.grantee
  where n.nspname='public' and p.proname like 'accounting\_%' escape '\'
)
select jsonb_build_object(
  'relation_public',(select count(*) from relation_grants where grantee='PUBLIC'),
  'relation_anon',(select count(*) from relation_grants where grantee='anon'),
  'function_public_execute',(select count(*) from function_grants where grantee='PUBLIC' and privilege_type='EXECUTE'),
  'function_anon_execute',(select count(*) from function_grants where grantee='anon' and privilege_type='EXECUTE'),
  'rls_disabled',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname like 'accounting\_%' escape '\'
      and c.relkind in ('r','p') and not c.relrowsecurity),
  'unsafe_security_definer',(select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.proname like 'accounting\_%' escape '\' and p.prosecdef
      and not coalesce(p.proconfig,array[]::text[]) && array['search_path=pg_catalog, public','search_path=pg_catalog,public'])
) as accounting_security_audit;

select coalesce(jsonb_agg(jsonb_build_object(
  'function',p.proname||'('||pg_get_function_identity_arguments(p.oid)||')',
  'security',case when p.prosecdef then 'definer' else 'invoker' end,
  'search_path',coalesce(array_to_string(p.proconfig,','),''),
  'public_execute',exists(
    select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    where a.grantee=0 and a.privilege_type='EXECUTE'
  ),
  'anon_execute',exists(
    select 1
    from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
    join pg_roles ar on ar.oid=a.grantee
    where ar.rolname='anon' and a.privilege_type='EXECUTE'
  )
) order by p.proname,pg_get_function_identity_arguments(p.oid)),'[]'::jsonb)
as accounting_function_security
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proname like 'accounting\_%' escape '\';

select (to_regclass('public.accounting_accounts') is not null)::integer as phase5b_accounting_exists \gset
\if :phase5b_accounting_exists
select jsonb_build_object(
  'accounts',(select count(*) from public.accounting_accounts),
  'fiscal_years',(select count(*) from public.accounting_fiscal_years),
  'periods',(select count(*) from public.accounting_periods),
  'cost_centers',(select count(*) from public.accounting_cost_centers),
  'mappings',(select count(*) from public.accounting_account_mappings),
  'active_rules',(select count(*) from public.accounting_posting_rules where is_active),
  'journals',(select count(*) from public.accounting_journal_entries),
  'opening_balances',(select count(*) from public.accounting_opening_balances),
  'saved_views',(select count(*) from public.accounting_report_saved_views),
  'runtime_users',(select count(*) from auth.users where email like '%@runtime.invalid'),
  'runtime_tenants',(select count(*) from public.tenants where slug like 'accounting-%runtime%' or slug like 'phase%-a' or slug like 'phase%-b')
) as accounting_runtime_state;
\else
select jsonb_build_object('schema','not_installed') as accounting_runtime_state;
\endif
