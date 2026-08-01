-- Phase 1 accounting RLS and permission bridge.
-- Extends the existing app_role model; it does not introduce a parallel role system.

create or replace function public.accounting_has_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select
    auth.uid() is not null
    and public.get_user_tenant_id() is not null
    and (
      public.get_user_role() = 'admin'::public.app_role
      or exists (
        select 1
        from public.accounting_role_permissions rp
        where rp.tenant_id = public.get_user_tenant_id()
          and rp.role = public.get_user_role()
          and rp.granted
          and rp.permission_key in (p_permission, 'accounting.admin')
      )
    );
$$;

comment on function public.accounting_has_permission(text) is
  'SECURITY DEFINER is required only to read tenant role grants without RLS recursion; tenant and auth identity are always resolved server-side.';

revoke all on function public.accounting_has_permission(text) from public, anon;
grant execute on function public.accounting_has_permission(text) to authenticated;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'accounting_accounts','accounting_fiscal_years','accounting_periods',
    'accounting_cost_centers','accounting_journal_number_sequences',
    'accounting_journal_entries','accounting_journal_lines','accounting_source_links',
    'accounting_account_mappings','accounting_posting_rules','accounting_opening_balances',
    'accounting_audit_logs','accounting_role_permissions'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon', table_name);
    execute format('revoke all on table public.%I from authenticated', table_name);
  end loop;
end $$;

grant select, insert, update on public.accounting_accounts to authenticated;
grant select, insert, update on public.accounting_fiscal_years to authenticated;
grant select, insert, update on public.accounting_periods to authenticated;
grant select, insert, update on public.accounting_cost_centers to authenticated;
grant select on public.accounting_journal_number_sequences to authenticated;
grant select, insert, update on public.accounting_journal_entries to authenticated;
grant select, insert, update, delete on public.accounting_journal_lines to authenticated;
grant select, insert on public.accounting_source_links to authenticated;
grant select, insert, update on public.accounting_account_mappings to authenticated;
grant select, insert, update on public.accounting_posting_rules to authenticated;
grant select, insert, update on public.accounting_opening_balances to authenticated;
grant select on public.accounting_audit_logs to authenticated;
grant select, insert, update on public.accounting_role_permissions to authenticated;

drop policy if exists accounting_accounts_read on public.accounting_accounts;
create policy accounting_accounts_read on public.accounting_accounts for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_accounts_manage on public.accounting_accounts;
create policy accounting_accounts_manage on public.accounting_accounts for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_accounts'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_accounts'));

drop policy if exists accounting_fiscal_years_read on public.accounting_fiscal_years;
create policy accounting_fiscal_years_read on public.accounting_fiscal_years for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_fiscal_years_manage on public.accounting_fiscal_years;
create policy accounting_fiscal_years_manage on public.accounting_fiscal_years for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_fiscal_years'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_fiscal_years'));

drop policy if exists accounting_periods_read on public.accounting_periods;
create policy accounting_periods_read on public.accounting_periods for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_periods_manage on public.accounting_periods;
create policy accounting_periods_manage on public.accounting_periods for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_periods'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_periods'));

drop policy if exists accounting_cost_centers_read on public.accounting_cost_centers;
create policy accounting_cost_centers_read on public.accounting_cost_centers for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_cost_centers_manage on public.accounting_cost_centers;
create policy accounting_cost_centers_manage on public.accounting_cost_centers for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_cost_centers'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_cost_centers'));

drop policy if exists accounting_journal_sequences_read on public.accounting_journal_number_sequences;
create policy accounting_journal_sequences_read on public.accounting_journal_number_sequences for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));

drop policy if exists accounting_journal_entries_read on public.accounting_journal_entries;
create policy accounting_journal_entries_read on public.accounting_journal_entries for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_journal_entries_create on public.accounting_journal_entries;
create policy accounting_journal_entries_create on public.accounting_journal_entries for insert to authenticated
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.create_journal'));
drop policy if exists accounting_journal_entries_update_draft on public.accounting_journal_entries;
create policy accounting_journal_entries_update_draft on public.accounting_journal_entries for update to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.create_journal'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.create_journal'));

drop policy if exists accounting_journal_lines_read on public.accounting_journal_lines;
create policy accounting_journal_lines_read on public.accounting_journal_lines for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_journal_lines_write on public.accounting_journal_lines;
create policy accounting_journal_lines_write on public.accounting_journal_lines for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.create_journal'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.create_journal'));

drop policy if exists accounting_source_links_read on public.accounting_source_links;
create policy accounting_source_links_read on public.accounting_source_links for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_source_links_create on public.accounting_source_links;
create policy accounting_source_links_create on public.accounting_source_links for insert to authenticated
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.create_journal'));

drop policy if exists accounting_mappings_read on public.accounting_account_mappings;
create policy accounting_mappings_read on public.accounting_account_mappings for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_mappings_manage on public.accounting_account_mappings;
create policy accounting_mappings_manage on public.accounting_account_mappings for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings'));

drop policy if exists accounting_posting_rules_read on public.accounting_posting_rules;
create policy accounting_posting_rules_read on public.accounting_posting_rules for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_posting_rules_manage on public.accounting_posting_rules;
create policy accounting_posting_rules_manage on public.accounting_posting_rules for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings'));

drop policy if exists accounting_opening_balances_read on public.accounting_opening_balances;
create policy accounting_opening_balances_read on public.accounting_opening_balances for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal'));
drop policy if exists accounting_opening_balances_manage on public.accounting_opening_balances;
create policy accounting_opening_balances_manage on public.accounting_opening_balances for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_opening_balances'))
  with check (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_opening_balances'));

drop policy if exists accounting_audit_logs_read on public.accounting_audit_logs;
create policy accounting_audit_logs_read on public.accounting_audit_logs for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.accounting_has_permission('accounting.admin'));

drop policy if exists accounting_role_permissions_read on public.accounting_role_permissions;
create policy accounting_role_permissions_read on public.accounting_role_permissions for select to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = 'admin'::public.app_role);
drop policy if exists accounting_role_permissions_manage on public.accounting_role_permissions;
create policy accounting_role_permissions_manage on public.accounting_role_permissions for all to authenticated
  using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = 'admin'::public.app_role)
  with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = 'admin'::public.app_role);
