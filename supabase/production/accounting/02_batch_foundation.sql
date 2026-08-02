\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
do $$begin
  if exists(select 1 from information_schema.tables where table_schema='public' and table_name in(
    'accounting_accounts','accounting_fiscal_years','accounting_periods',
    'accounting_cost_centers','accounting_journal_entries','accounting_journal_lines',
    'accounting_source_links','accounting_account_mappings','accounting_posting_rules',
    'accounting_audit_logs','accounting_role_permissions','accounting_report_saved_views'
  )) then
    raise exception 'FOUNDATION_STOP_PARTIAL_ACCOUNTING_SCHEMA_PRESENT';
  end if;
end$$;
\ir ../../migrations/20260801100000_accounting_cloud_foundation.sql
\ir ../../migrations/20260801101000_accounting_cloud_security.sql
\ir ../../migrations/20260801102000_accounting_source_eligibility.sql
\ir ../../migrations/20260801103000_accounting_validation_and_posting.sql
\ir ../../migrations/20260801104000_accounting_foundation_indexes.sql
\ir ../../migrations/20260801105000_accounting_runtime_hardening.sql
\ir ../../migrations/20260801106000_accounting_audit_runtime_fix.sql
\ir ../../migrations/20260801107000_accounting_transition_security_fix.sql
\ir ../../migrations/20260801108000_accounting_legacy_surface_security.sql
\ir ../../migrations/20260801109000_app_versions_schema_alignment.sql
commit;

-- Rollback point: stop and restore the pre-batch backup if verification fails.
