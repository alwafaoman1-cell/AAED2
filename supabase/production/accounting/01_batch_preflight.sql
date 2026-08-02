\set ON_ERROR_STOP on
\if :{?confirmed_project_ref}
\else
  \echo 'STOP: pass -v confirmed_project_ref=<project-ref>'
  \quit 3
\endif
\if :{?expected_project_ref}
\else
  \echo 'STOP: pass -v expected_project_ref=<approved-project-ref>'
  \quit 3
\endif
select :'confirmed_project_ref'=:'expected_project_ref' as project_ref_matches \gset
\if :project_ref_matches
\else
  \echo 'STOP: project ref mismatch'
  \quit 4
\endif

begin;
set local lock_timeout='5s';
set local statement_timeout='5min';

do $$begin
  if to_regclass('public.expenses') is null or to_regclass('public.suppliers') is null then
    raise exception 'PREFLIGHT_SOURCE_TABLE_MISSING';
  end if;
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='supplier_id'
            and (udt_name<>'uuid' or is_nullable<>'YES' or column_default is not null)) then
    raise exception 'PREFLIGHT_SUPPLIER_COLUMN_CONFLICT';
  end if;
end$$;

\ir ../../migrations/20260718120000_add_supplier_id_to_expenses.sql

do $$begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='expenses' and column_name='supplier_id' and udt_name='uuid' and is_nullable='YES' and column_default is null) then
    raise exception 'PREFLIGHT_SUPPLIER_COLUMN_INVALID';
  end if;
end$$;
commit;

-- Checkpoint: capture 91_verify_data_unchanged.sql before continuing.
