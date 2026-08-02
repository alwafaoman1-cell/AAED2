\set ON_ERROR_STOP on
begin;
set local lock_timeout='5s';
set local statement_timeout='10min';

-- Stop if the three known Production collision definitions changed after audit.
do $$declare n integer;begin
  select count(*) into n from (values
    ('reports_expense_facts_v1','706b12d59c3cd82d9f0b4cd36d9b36f8'),
    ('reports_invoice_facts_v1','beee4802f5288979fa703e03020215cc'),
    ('reports_payment_facts_v1','c3d2676f824431d6c9e1def639b7205d')
  ) expected(name,hash)
  where not exists(
    select 1 from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
    where ns.nspname='public' and c.relname=expected.name and c.relkind='v'
      and md5(pg_get_viewdef(c.oid,true))=expected.hash
  );
  if n<>0 then raise exception 'REPORT_COLLISION_HASH_CHANGED count=%',n;end if;
end$$;

-- Reconcile the manually present Reports Center objects through their official
-- migration chain. This is a controlled replacement, never history repair.
\ir ../../migrations/20260729110000_reports_center_read_models.sql
\ir ../../migrations/20260729120000_reports_center_detail_read_models.sql
\ir ../../migrations/20260729130000_reports_center_security_hardening.sql
\ir ../../migrations/20260729140000_reports_center_sorting_fix.sql
\ir ../../migrations/20260729150000_reports_center_summary_parity_fix.sql
\ir ../../migrations/20260730103000_reports_center_permissions_and_work_orders_performance.sql
\ir ../../migrations/20260730113000_reports_center_access_assertion.sql
\ir ../../migrations/20260730120000_reports_center_tenant_null_guard.sql
\ir ../../migrations/20260730123000_reports_center_work_orders_fail_closed_wrapper.sql

\ir ../../migrations/20260801120000_accounting_reports_standalone.sql
\ir ../../migrations/20260801121000_accounting_reports_rpc_uuid_fix.sql
\ir ../../migrations/20260801122000_accounting_vehicle_profit_loss_eligible.sql
\ir ../../migrations/20260801123000_accounting_vehicle_profit_loss_uuid_links.sql
\ir ../../migrations/20260801124000_accounting_vehicle_profit_loss_uuid_links_exact.sql
\ir ../../migrations/20260802100000_accounting_production_preflight_security_and_dependencies.sql
commit;

-- Run 90 and 91 immediately. Do not enable rules or create configuration data.
