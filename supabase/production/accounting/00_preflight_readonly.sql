\set ON_ERROR_STOP on
\pset pager off

-- READ ONLY. Run before any deployment and archive the output.
select current_database() database_name,
       current_setting('server_version') server_version,
       now() audited_at;

select table_schema, table_name
from information_schema.tables
where table_schema='public' and table_name like 'accounting\_%' escape '\'
order by table_name;

select column_name,udt_name,is_nullable,column_default
from information_schema.columns
where table_schema='public' and table_name='expenses' and column_name='supplier_id';

select c.relname,c.relkind
from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname like 'accounting\_%' escape '\'
order by c.relkind,c.relname;

with duplicate_groups as (
  select tenant_id,payment_number,count(*) rows_count,
         count(distinct amount) amount_variants,
         count(distinct payment_date) date_variants
  from public.claim_payments
  where nullif(btrim(payment_number),'') is not null
  group by tenant_id,payment_number having count(*)>1
)
select count(*) duplicate_groups,
       coalesce(sum(rows_count),0) duplicate_rows,
       count(*) filter(where amount_variants>1) different_amount_groups,
       count(*) filter(where date_variants>1) different_date_groups
from duplicate_groups;
