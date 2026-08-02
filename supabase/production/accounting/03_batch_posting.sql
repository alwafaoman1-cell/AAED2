\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';
do $$begin
  if to_regclass('public.accounting_accounts') is null then raise exception 'POSTING_STOP_FOUNDATION_MISSING'; end if;
  if exists(select 1 from public.accounting_journal_entries) then raise exception 'POSTING_STOP_UNEXPECTED_EXISTING_JOURNALS'; end if;
end$$;
\ir ../../migrations/20260801110000_accounting_posting_rules_engine.sql
\ir ../../migrations/20260801111000_accounting_supplier_posting_extension.sql
commit;

-- No rules are activated and no source is posted by this batch.
