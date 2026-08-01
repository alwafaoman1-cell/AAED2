-- Evidence-based indexes for tenant-scoped accounting administration and future ledgers.

create index if not exists accounting_accounts_active_idx
  on public.accounting_accounts(tenant_id, code) where is_active;
create index if not exists accounting_accounts_parent_idx
  on public.accounting_accounts(tenant_id, parent_id) where parent_id is not null;

create index if not exists accounting_fiscal_years_dates_idx
  on public.accounting_fiscal_years(tenant_id, start_date, end_date);
create index if not exists accounting_periods_dates_idx
  on public.accounting_periods(tenant_id, start_date, end_date);

create index if not exists accounting_cost_centers_active_idx
  on public.accounting_cost_centers(tenant_id, code) where is_active;

create index if not exists accounting_journal_entries_date_idx
  on public.accounting_journal_entries(tenant_id, accounting_date desc);
create index if not exists accounting_journal_entries_status_date_idx
  on public.accounting_journal_entries(tenant_id, status, accounting_date desc);
create index if not exists accounting_journal_entries_source_idx
  on public.accounting_journal_entries(tenant_id, source_type, source_identifier)
  where source_type is not null;
create index if not exists accounting_journal_entries_reversal_idx
  on public.accounting_journal_entries(tenant_id, reversed_entry_id)
  where reversed_entry_id is not null;

create index if not exists accounting_journal_lines_entry_idx
  on public.accounting_journal_lines(tenant_id, journal_entry_id, line_number);
create index if not exists accounting_journal_lines_account_idx
  on public.accounting_journal_lines(tenant_id, account_id, journal_entry_id);
create index if not exists accounting_journal_lines_cost_center_idx
  on public.accounting_journal_lines(tenant_id, cost_center_id, journal_entry_id)
  where cost_center_id is not null;
create index if not exists accounting_journal_lines_work_order_idx
  on public.accounting_journal_lines(tenant_id, work_order_id)
  where work_order_id is not null;
create index if not exists accounting_journal_lines_claim_idx
  on public.accounting_journal_lines(tenant_id, claim_id)
  where claim_id is not null;
create index if not exists accounting_journal_lines_vehicle_idx
  on public.accounting_journal_lines(tenant_id, vehicle_id)
  where vehicle_id is not null;

create index if not exists accounting_source_links_entry_idx
  on public.accounting_source_links(tenant_id, journal_entry_id);
create index if not exists accounting_source_links_source_idx
  on public.accounting_source_links(tenant_id, source_type, source_id);

create index if not exists accounting_mappings_lookup_idx
  on public.accounting_account_mappings(tenant_id, mapping_key, status, priority, effective_from, effective_to);
create index if not exists accounting_audit_entity_idx
  on public.accounting_audit_logs(tenant_id, entity_type, entity_id, created_at desc);
create index if not exists accounting_audit_time_idx
  on public.accounting_audit_logs(tenant_id, created_at desc);

create unique index if not exists accounting_opening_balances_scope_unique
  on public.accounting_opening_balances(
    tenant_id, fiscal_year_id, account_id,
    coalesce(cost_center_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );
