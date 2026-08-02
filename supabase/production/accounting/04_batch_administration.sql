\set ON_ERROR_STOP on
\if :{?approve_accountant_enum}
\else
  \echo 'STOP: explicit -v approve_accountant_enum=1 is required'
  \quit 5
\endif
select :'approve_accountant_enum'='1' as accountant_enum_approved \gset
\if :accountant_enum_approved
\else
  \echo 'STOP: accountant enum not approved'
  \quit 5
\endif

begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
\ir ../../migrations/20260801112000_accounting_administration_setup.sql
\ir ../../migrations/20260801113000_accounting_accountant_role_alignment.sql
\ir ../../migrations/20260801114000_accounting_opening_batch_scope.sql
\ir ../../migrations/20260801115000_accounting_rule_runtime_fixture_guard.sql
commit;

-- Enum expansion is forward-only; backup restore is the rollback boundary.
