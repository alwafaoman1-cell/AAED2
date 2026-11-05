-- Development-verified equivalent RLS command projection. No row/grant changes.

-- Preserve OR semantics of every original PERMISSIVE policy and all RESTRICTIVE policies.

-- ALL policies are expanded per command; INSERT/UPDATE retain implicit USING-as-CHECK.

set local lock_timeout='2s';

set local statement_timeout='30s';

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_account_mappings' and permissive='PERMISSIVE') is distinct from 'be546d56d700586a3b2fc1825ae7e656' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_account_mappings'; end if; end $preflight$;

drop policy "accounting_mappings_manage" on public."accounting_account_mappings";

drop policy "accounting_mappings_read" on public."accounting_account_mappings";

create policy "rls_accounting_account_mappings_select" on public."accounting_account_mappings" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_account_mappings_insert" on public."accounting_account_mappings" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_account_mappings_update" on public."accounting_account_mappings" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_account_mappings_delete" on public."accounting_account_mappings" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_accounts' and permissive='PERMISSIVE') is distinct from '5030410178ca420a84df2ed847d90327' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_accounts'; end if; end $preflight$;

drop policy "accounting_accounts_manage" on public."accounting_accounts";

drop policy "accounting_accounts_read" on public."accounting_accounts";

create policy "rls_accounting_accounts_select" on public."accounting_accounts" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_accounts_insert" on public."accounting_accounts" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))));

create policy "rls_accounting_accounts_update" on public."accounting_accounts" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))));

create policy "rls_accounting_accounts_delete" on public."accounting_accounts" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_cash_bank_accounts' and permissive='PERMISSIVE') is distinct from '4cbf615cf897d1ef7ebee8374f50fbe9' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_cash_bank_accounts'; end if; end $preflight$;

drop policy "accounting_cash_bank_accounts_manage" on public."accounting_cash_bank_accounts";

drop policy "accounting_cash_bank_accounts_read" on public."accounting_cash_bank_accounts";

create policy "rls_accounting_cash_bank_accounts_select" on public."accounting_cash_bank_accounts" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_cash_bank_accounts_insert" on public."accounting_cash_bank_accounts" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_cash_bank_accounts_update" on public."accounting_cash_bank_accounts" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_cash_bank_accounts_delete" on public."accounting_cash_bank_accounts" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_cost_centers' and permissive='PERMISSIVE') is distinct from '766773ac814a3b3264d4bd5a64f6d814' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_cost_centers'; end if; end $preflight$;

drop policy "accounting_cost_centers_manage" on public."accounting_cost_centers";

drop policy "accounting_cost_centers_read" on public."accounting_cost_centers";

create policy "rls_accounting_cost_centers_select" on public."accounting_cost_centers" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_cost_centers_insert" on public."accounting_cost_centers" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))));

create policy "rls_accounting_cost_centers_update" on public."accounting_cost_centers" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))));

create policy "rls_accounting_cost_centers_delete" on public."accounting_cost_centers" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_fiscal_years' and permissive='PERMISSIVE') is distinct from '3896166398cf8df32544f063efbcbee6' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_fiscal_years'; end if; end $preflight$;

drop policy "accounting_fiscal_years_manage" on public."accounting_fiscal_years";

drop policy "accounting_fiscal_years_read" on public."accounting_fiscal_years";

create policy "rls_accounting_fiscal_years_select" on public."accounting_fiscal_years" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_fiscal_years_insert" on public."accounting_fiscal_years" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))));

create policy "rls_accounting_fiscal_years_update" on public."accounting_fiscal_years" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))));

create policy "rls_accounting_fiscal_years_delete" on public."accounting_fiscal_years" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_journal_lines' and permissive='PERMISSIVE') is distinct from '530763c49b36f691d23c210cf1ec8448' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_journal_lines'; end if; end $preflight$;

drop policy "accounting_journal_lines_read" on public."accounting_journal_lines";

drop policy "accounting_journal_lines_write" on public."accounting_journal_lines";

create policy "rls_accounting_journal_lines_select" on public."accounting_journal_lines" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_journal_lines_insert" on public."accounting_journal_lines" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))));

create policy "rls_accounting_journal_lines_update" on public."accounting_journal_lines" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))));

create policy "rls_accounting_journal_lines_delete" on public."accounting_journal_lines" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_opening_balance_batches' and permissive='PERMISSIVE') is distinct from '9e0c0b65ede2a1cfc57338b82b828392' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_opening_balance_batches'; end if; end $preflight$;

drop policy "accounting_opening_balance_batches_manage" on public."accounting_opening_balance_batches";

drop policy "accounting_opening_balance_batches_read" on public."accounting_opening_balance_batches";

create policy "rls_accounting_opening_balance_batches_select" on public."accounting_opening_balance_batches" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (accounting_has_permission('accounting.manage_opening_balances'::text) OR accounting_has_permission('accounting.view_journal'::text)))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balance_batches_insert" on public."accounting_opening_balance_batches" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balance_batches_update" on public."accounting_opening_balance_batches" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balance_batches_delete" on public."accounting_opening_balance_batches" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_opening_balances' and permissive='PERMISSIVE') is distinct from 'fd5ca2c0db718d8f6886664744ab77b4' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_opening_balances'; end if; end $preflight$;

drop policy "accounting_opening_balances_manage" on public."accounting_opening_balances";

drop policy "accounting_opening_balances_read" on public."accounting_opening_balances";

create policy "rls_accounting_opening_balances_select" on public."accounting_opening_balances" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_opening_balances_insert" on public."accounting_opening_balances" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balances_update" on public."accounting_opening_balances" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balances_delete" on public."accounting_opening_balances" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_payment_method_mappings' and permissive='PERMISSIVE') is distinct from '9d7b6cb4ece1ac06e9b2b654e36d9f41' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_payment_method_mappings'; end if; end $preflight$;

drop policy "accounting_payment_method_mappings_manage" on public."accounting_payment_method_mappings";

drop policy "accounting_payment_method_mappings_read" on public."accounting_payment_method_mappings";

create policy "rls_accounting_payment_method_mappings_select" on public."accounting_payment_method_mappings" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_payment_method_mappings_insert" on public."accounting_payment_method_mappings" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_payment_method_mappings_update" on public."accounting_payment_method_mappings" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_payment_method_mappings_delete" on public."accounting_payment_method_mappings" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_periods' and permissive='PERMISSIVE') is distinct from '06a77d2ae2b780a567eeace9a59ce4a6' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_periods'; end if; end $preflight$;

drop policy "accounting_periods_manage" on public."accounting_periods";

drop policy "accounting_periods_read" on public."accounting_periods";

create policy "rls_accounting_periods_select" on public."accounting_periods" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_periods_insert" on public."accounting_periods" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))));

create policy "rls_accounting_periods_update" on public."accounting_periods" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))));

create policy "rls_accounting_periods_delete" on public."accounting_periods" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_posting_rules' and permissive='PERMISSIVE') is distinct from 'e23292b0699b0430147bdce1c69c3a5c' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_posting_rules'; end if; end $preflight$;

drop policy "accounting_posting_rules_manage" on public."accounting_posting_rules";

drop policy "accounting_posting_rules_read" on public."accounting_posting_rules";

create policy "rls_accounting_posting_rules_select" on public."accounting_posting_rules" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_posting_rules_insert" on public."accounting_posting_rules" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_posting_rules_update" on public."accounting_posting_rules" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_posting_rules_delete" on public."accounting_posting_rules" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_role_permissions' and permissive='PERMISSIVE') is distinct from 'e9b44e16829b4ffd54a31b64928e7f68' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_role_permissions'; end if; end $preflight$;

drop policy "accounting_role_permissions_manage" on public."accounting_role_permissions";

drop policy "accounting_role_permissions_read" on public."accounting_role_permissions";

create policy "rls_accounting_role_permissions_select" on public."accounting_role_permissions" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_accounting_role_permissions_insert" on public."accounting_role_permissions" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_accounting_role_permissions_update" on public."accounting_role_permissions" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_accounting_role_permissions_delete" on public."accounting_role_permissions" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='app_versions' and permissive='PERMISSIVE') is distinct from 'ca383310a1d43ae3e01c22fc9bf8b72b' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: app_versions'; end if; end $preflight$;

drop policy "app_versions_admin_manage" on public."app_versions";

drop policy "app_versions_tenant_read" on public."app_versions";

create policy "rls_app_versions_select" on public."app_versions" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR ((tenant_id = get_user_tenant_id())));

create policy "rls_app_versions_insert" on public."app_versions" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_app_versions_update" on public."app_versions" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_app_versions_delete" on public."app_versions" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='customer_notification_settings' and permissive='PERMISSIVE') is distinct from 'cff6a75b76b9856e9ca0200d9d7a2a7f' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: customer_notification_settings'; end if; end $preflight$;

drop policy "tenant manage settings" on public."customer_notification_settings";

drop policy "tenant read settings" on public."customer_notification_settings";

create policy "rls_customer_notification_settings_select" on public."customer_notification_settings" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_customer_notification_settings_insert" on public."customer_notification_settings" as permissive for insert to authenticated with check (((tenant_id = get_user_tenant_id())));

create policy "rls_customer_notification_settings_update" on public."customer_notification_settings" as permissive for update to authenticated using (((tenant_id = get_user_tenant_id()))) with check (((tenant_id = get_user_tenant_id())));

create policy "rls_customer_notification_settings_delete" on public."customer_notification_settings" as permissive for delete to authenticated using (((tenant_id = get_user_tenant_id())));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='customers' and permissive='PERMISSIVE') is distinct from '2222283b0c71e56e903e1ca0bd52b10f' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: customers'; end if; end $preflight$;

drop policy "Admin delete customers" on public."customers";

drop policy "Staff insert customers" on public."customers";

drop policy "Staff update customers" on public."customers";

drop policy "Supervisor insert customers" on public."customers";

drop policy "Supervisor update customers" on public."customers";

drop policy "Tenant access customers" on public."customers";

create policy "rls_customers_select" on public."customers" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND ((get_user_role() <> 'customer'::app_role) OR (email = get_user_email())))));

create policy "rls_customers_insert" on public."customers" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_customers_update" on public."customers" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_customers_delete" on public."customers" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='damage_markers' and permissive='PERMISSIVE') is distinct from 'eade2f1448777a0cbc9639e403bc42a2' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: damage_markers'; end if; end $preflight$;

drop policy "Admins/managers delete damage_markers" on public."damage_markers";

drop policy "Admins/managers update damage_markers" on public."damage_markers";

drop policy "Staff insert damage_markers" on public."damage_markers";

drop policy "Supervisor insert damage_markers" on public."damage_markers";

drop policy "Tenant access damage_markers" on public."damage_markers";

create policy "rls_damage_markers_select" on public."damage_markers" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_damage_markers_insert" on public."damage_markers" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_damage_markers_update" on public."damage_markers" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

create policy "rls_damage_markers_delete" on public."damage_markers" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='estimate_sequences' and permissive='PERMISSIVE') is distinct from 'e8a5cb384b84f1cd86d30ce28da48826' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: estimate_sequences'; end if; end $preflight$;

drop policy "Staff manage estimate sequences" on public."estimate_sequences";

drop policy "Tenant read estimate sequences" on public."estimate_sequences";

create policy "rls_estimate_sequences_select" on public."estimate_sequences" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))) OR ((tenant_id = get_user_tenant_id())));

create policy "rls_estimate_sequences_insert" on public."estimate_sequences" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_estimate_sequences_update" on public."estimate_sequences" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_estimate_sequences_delete" on public."estimate_sequences" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='inspections' and permissive='PERMISSIVE') is distinct from 'ea9480b84c6b1e09a9d84d0884e150e7' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: inspections'; end if; end $preflight$;

drop policy "Admin delete inspections" on public."inspections";

drop policy "Staff insert inspections" on public."inspections";

drop policy "Staff update inspections" on public."inspections";

drop policy "Supervisor insert inspections" on public."inspections";

drop policy "Supervisor update inspections" on public."inspections";

drop policy "Tenant access inspections" on public."inspections";

create policy "rls_inspections_select" on public."inspections" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_inspections_insert" on public."inspections" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_inspections_update" on public."inspections" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_inspections_delete" on public."inspections" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='insurance_claims' and permissive='PERMISSIVE') is distinct from 'c55098037ad14cd92ebda1b10e880c3a' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: insurance_claims'; end if; end $preflight$;

drop policy "Admin delete insurance_claims" on public."insurance_claims";

drop policy "Staff insert insurance_claims" on public."insurance_claims";

drop policy "Staff update insurance_claims" on public."insurance_claims";

drop policy "Supervisor insert insurance_claims" on public."insurance_claims";

drop policy "Supervisor update insurance_claims" on public."insurance_claims";

drop policy "Tenant access insurance_claims" on public."insurance_claims";

create policy "rls_insurance_claims_select" on public."insurance_claims" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND ((get_user_role() <> 'customer'::app_role) OR (customer_id IN ( SELECT c.id
   FROM customers c
  WHERE ((c.tenant_id = get_user_tenant_id()) AND (c.email = get_user_email()))))))));

create policy "rls_insurance_claims_insert" on public."insurance_claims" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role, 'insurance'::app_role])))));

create policy "rls_insurance_claims_update" on public."insurance_claims" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_insurance_claims_delete" on public."insurance_claims" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='insurance_estimates' and permissive='PERMISSIVE') is distinct from 'd88553357aa5186952e022af6cd94561' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: insurance_estimates'; end if; end $preflight$;

drop policy "Admin delete insurance_estimates" on public."insurance_estimates";

drop policy "Staff insert insurance_estimates" on public."insurance_estimates";

drop policy "Staff update insurance_estimates" on public."insurance_estimates";

drop policy "Supervisor insert insurance_estimates" on public."insurance_estimates";

drop policy "Supervisor read insurance_estimates" on public."insurance_estimates";

drop policy "Supervisor update insurance_estimates" on public."insurance_estimates";

drop policy "Tenant access insurance_estimates" on public."insurance_estimates";

create policy "rls_insurance_estimates_select" on public."insurance_estimates" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role])))));

create policy "rls_insurance_estimates_insert" on public."insurance_estimates" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role])))));

create policy "rls_insurance_estimates_update" on public."insurance_estimates" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_insurance_estimates_delete" on public."insurance_estimates" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='job_order_parts' and permissive='PERMISSIVE') is distinct from 'a58346d4a91fbf47bad4afaec7613f85' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: job_order_parts'; end if; end $preflight$;

drop policy "Admin delete parts" on public."job_order_parts";

drop policy "Staff insert parts" on public."job_order_parts";

drop policy "Staff update parts" on public."job_order_parts";

drop policy "Supervisor insert parts" on public."job_order_parts";

drop policy "Supervisor update parts" on public."job_order_parts";

drop policy "Tenant access parts" on public."job_order_parts";

create policy "rls_job_order_parts_select" on public."job_order_parts" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_job_order_parts_insert" on public."job_order_parts" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_job_order_parts_update" on public."job_order_parts" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_job_order_parts_delete" on public."job_order_parts" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='job_orders' and permissive='PERMISSIVE') is distinct from '22987499a5cd4eb1c9d86c95747ba676' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: job_orders'; end if; end $preflight$;

drop policy "Managers delete job orders" on public."job_orders";

drop policy "Staff read tenant job orders" on public."job_orders";

drop policy "Supervisor insert job_orders" on public."job_orders";

drop policy "Supervisor update job_orders" on public."job_orders";

drop policy "Workshop staff create job orders" on public."job_orders";

drop policy "Workshop staff update job orders" on public."job_orders";

create policy "rls_job_orders_select" on public."job_orders" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (NOT has_role(( SELECT auth.uid() AS uid), 'customer'::app_role)))));

create policy "rls_job_orders_insert" on public."job_orders" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'supervisor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'technician'::app_role)))));

create policy "rls_job_orders_update" on public."job_orders" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'supervisor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'technician'::app_role))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR ((tenant_id = get_user_tenant_id())));

create policy "rls_job_orders_delete" on public."job_orders" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role)))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='profiles' and permissive='PERMISSIVE') is distinct from '9d862e7bd0f383b0008e19c90f1607e8' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: profiles'; end if; end $preflight$;

drop policy "Admins can update tenant profiles" on public."profiles";

drop policy "Admins insert profiles" on public."profiles";

drop policy "Users see profiles in tenant" on public."profiles";

drop policy "Users update own profile own fields" on public."profiles";

create policy "rls_profiles_select" on public."profiles" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_profiles_insert" on public."profiles" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])) AND ((role <> 'admin'::app_role) OR (get_user_role() = 'admin'::app_role)))));

create policy "rls_profiles_update" on public."profiles" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR ((user_id = ( SELECT auth.uid() AS uid)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role) AND (role = ( SELECT i.previous_role
   FROM app_private.profile_update_identity(profiles.id) i(previous_role, previous_tenant))))) OR (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ( SELECT i.previous_role
   FROM app_private.profile_update_identity(profiles.id) i(previous_role, previous_tenant))) AND (tenant_id = ( SELECT i.previous_tenant
   FROM app_private.profile_update_identity(profiles.id) i(previous_role, previous_tenant))))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='security_action_otps' and permissive='PERMISSIVE') is distinct from '334896e5467474100ac6bf5500c32e6a' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: security_action_otps'; end if; end $preflight$;

drop policy "security_action_otps_no_client_read" on public."security_action_otps";

drop policy "security_action_otps_no_client_write" on public."security_action_otps";

create policy "rls_security_action_otps_select" on public."security_action_otps" as permissive for select to authenticated using ((false));

create policy "rls_security_action_otps_insert" on public."security_action_otps" as permissive for insert to authenticated with check ((false));

create policy "rls_security_action_otps_update" on public."security_action_otps" as permissive for update to authenticated using ((false)) with check ((false));

create policy "rls_security_action_otps_delete" on public."security_action_otps" as permissive for delete to authenticated using ((false));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='tenant_domains' and permissive='PERMISSIVE') is distinct from '53dda8d4ad8b270013534961b080191d' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: tenant_domains'; end if; end $preflight$;

drop policy "Tenant domain manage" on public."tenant_domains";

drop policy "Tenant domain read" on public."tenant_domains";

create policy "rls_tenant_domains_select" on public."tenant_domains" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) OR is_platform_admin())) OR ((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

create policy "rls_tenant_domains_insert" on public."tenant_domains" as permissive for insert to authenticated with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

create policy "rls_tenant_domains_update" on public."tenant_domains" as permissive for update to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role))))) with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

create policy "rls_tenant_domains_delete" on public."tenant_domains" as permissive for delete to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='tenant_features' and permissive='PERMISSIVE') is distinct from 'cacea6bf63df1bf74442520ab2cc64b4' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: tenant_features'; end if; end $preflight$;

drop policy "Tenant feature manage" on public."tenant_features";

drop policy "Tenant feature read" on public."tenant_features";

create policy "rls_tenant_features_select" on public."tenant_features" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) OR is_platform_admin())) OR ((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

create policy "rls_tenant_features_insert" on public."tenant_features" as permissive for insert to authenticated with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

create policy "rls_tenant_features_update" on public."tenant_features" as permissive for update to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role)))))) with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

create policy "rls_tenant_features_delete" on public."tenant_features" as permissive for delete to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='tenants' and permissive='PERMISSIVE') is distinct from '0b28d5daabc544992ba140c19f28c59f' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: tenants'; end if; end $preflight$;

drop policy "Admins update tenant" on public."tenants";

drop policy "Platform admins manage tenants" on public."tenants";

drop policy "Users see own tenant" on public."tenants";

create policy "rls_tenants_select" on public."tenants" as permissive for select to authenticated using (((id = get_user_tenant_id())) OR (is_platform_admin()));

create policy "rls_tenants_insert" on public."tenants" as permissive for insert to authenticated with check ((is_platform_admin()));

create policy "rls_tenants_update" on public."tenants" as permissive for update to authenticated using ((((id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR (is_platform_admin())) with check ((((id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR (is_platform_admin()));

create policy "rls_tenants_delete" on public."tenants" as permissive for delete to authenticated using ((is_platform_admin()));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='user_roles' and permissive='PERMISSIVE') is distinct from '4f50146cb4abeaed2d06c6e33f98d731' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: user_roles'; end if; end $preflight$;

drop policy "Admins manage tenant roles" on public."user_roles";

drop policy "Users read own role or admin/manager reads all" on public."user_roles";

create policy "rls_user_roles_select" on public."user_roles" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]))))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_user_roles_insert" on public."user_roles" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_user_roles_update" on public."user_roles" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_user_roles_delete" on public."user_roles" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='whatsapp_templates' and permissive='PERMISSIVE') is distinct from 'f3191e1736a61408e13c9a47ab14de08' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: whatsapp_templates'; end if; end $preflight$;

drop policy "tenant manage whatsapp templates" on public."whatsapp_templates";

drop policy "tenant read whatsapp templates" on public."whatsapp_templates";

create policy "rls_whatsapp_templates_select" on public."whatsapp_templates" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_whatsapp_templates_insert" on public."whatsapp_templates" as permissive for insert to authenticated with check (((tenant_id = get_user_tenant_id())));

create policy "rls_whatsapp_templates_update" on public."whatsapp_templates" as permissive for update to authenticated using (((tenant_id = get_user_tenant_id()))) with check (((tenant_id = get_user_tenant_id())));

create policy "rls_whatsapp_templates_delete" on public."whatsapp_templates" as permissive for delete to authenticated using (((tenant_id = get_user_tenant_id())));
