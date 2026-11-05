-- Production counterpart, explicitly authorized 2026-11-05.
-- Independently verify the Production connection and exact catalogue fingerprints.
-- The original Development migration remains immutable; no historical data changes.
-- Drop only two exact non-unique redundant copies after live catalog checks.
-- Version aligned to the confirmed Production migration ledger.
-- Operational rows, remaining coverage and all constraints are unchanged.
select set_config('security_audit.approved_project_ref','ifnfwssdtjuzdtshnrht',true);
-- Reviewed selective Production counterpart. Production-only, separately approve from 01.
-- Explicitly keep report_account_idx and tenant_active_created. No new index.
-- Execute only inside Main's approved transaction after connection verification
-- and SET LOCAL security_audit.approved_project_ref = 'ifnfwssdtjuzdtshnrht'.
-- Plain DROP is transactional but briefly locks; lock_timeout fails instead of
-- waiting indefinitely. This is NOT a Production/concurrent-drop runbook.
do $duplicate_index_candidate$
declare
  names text[];
  keep_oid regclass;
  drop_oid regclass;
  keep_row pg_index%rowtype;
  drop_row pg_index%rowtype;
  keep_def text;
  drop_def text;
begin
  if current_setting('security_audit.approved_project_ref', true)
      is distinct from 'ifnfwssdtjuzdtshnrht' then
    raise exception 'PRODUCTION_APPROVAL_AND_PROJECT_PREFLIGHT_REQUIRED';
  end if;
  perform set_config('lock_timeout', '2s', true);
  foreach names slice 1 in array array[
    array['public.accounting_journal_lines_report_account_idx','public.accounting_journal_lines_account_idx'],
    array['public.idx_job_orders_tenant_active_created','public.idx_job_orders_tenant_not_deleted']
  ]
  loop
    keep_oid := to_regclass(names[1]);
    drop_oid := to_regclass(names[2]);
    if keep_oid is null or drop_oid is null then
      raise exception 'DUPLICATE_INDEX_PREFLIGHT_MISSING: %', names;
    end if;
    select * into keep_row from pg_index where indexrelid=keep_oid;
    select * into drop_row from pg_index where indexrelid=drop_oid;
    keep_def := regexp_replace(pg_get_indexdef(keep_oid), '^CREATE INDEX [^ ]+ ON ', 'CREATE INDEX <name> ON ');
    drop_def := regexp_replace(pg_get_indexdef(drop_oid), '^CREATE INDEX [^ ]+ ON ', 'CREATE INDEX <name> ON ');
    if keep_def is distinct from drop_def
      or keep_row.indrelid is distinct from drop_row.indrelid
      or not keep_row.indisvalid or not keep_row.indisready
      or not drop_row.indisvalid or not drop_row.indisready
      or keep_row.indisunique or drop_row.indisunique
      or keep_row.indisprimary or drop_row.indisprimary
      or keep_row.indisexclusion or drop_row.indisexclusion
      or keep_row.indisreplident or drop_row.indisreplident
      or keep_row.indisclustered or drop_row.indisclustered then
      raise exception 'DUPLICATE_INDEX_CATALOG_DRIFT: %', names;
    end if;
    if exists(select 1 from pg_constraint where conindid in (keep_oid,drop_oid))
      or exists(select 1 from pg_depend
                where refclassid='pg_class'::regclass and refobjid=drop_oid) then
      raise exception 'DUPLICATE_INDEX_HAS_DEPENDENT: %', names[2];
    end if;
    execute format('drop index %s', drop_oid);
  end loop;
end;
$duplicate_index_candidate$;
