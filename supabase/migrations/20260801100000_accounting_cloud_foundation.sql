-- Phase 1: cloud accounting foundation.
-- Non-destructive: creates isolated accounting_* objects only. No backfill or posting.

create table if not exists public.accounting_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null,
  name_ar text not null,
  name_en text not null,
  parent_id uuid,
  account_type text not null check (account_type in ('asset','liability','equity','revenue','cost_of_revenue','expense')),
  normal_balance text not null check (normal_balance in ('debit','credit')),
  level smallint not null default 1 check (level between 1 and 20),
  is_postable boolean not null default true,
  is_system boolean not null default false,
  is_active boolean not null default true,
  requires_cost_center boolean not null default false,
  requires_reconciliation boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  deactivated_at timestamptz,
  deactivated_by uuid references auth.users(id) on delete set null,
  constraint accounting_accounts_code_not_blank check (btrim(code) <> ''),
  constraint accounting_accounts_names_not_blank check (btrim(name_ar) <> '' and btrim(name_en) <> ''),
  constraint accounting_accounts_not_own_parent check (parent_id is null or parent_id <> id),
  constraint accounting_accounts_tenant_id_id_key unique (tenant_id, id),
  constraint accounting_accounts_tenant_code_key unique (tenant_id, code),
  constraint accounting_accounts_parent_tenant_fk foreign key (tenant_id, parent_id)
    references public.accounting_accounts(tenant_id, id) on delete restrict
);

create table if not exists public.accounting_fiscal_years (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name text not null,
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed','locked')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopen_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_fiscal_years_dates_check check (start_date <= end_date),
  constraint accounting_fiscal_years_tenant_id_id_key unique (tenant_id, id),
  constraint accounting_fiscal_years_tenant_name_key unique (tenant_id, name)
);

create table if not exists public.accounting_periods (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fiscal_year_id uuid not null,
  name text not null,
  sequence smallint not null check (sequence > 0),
  start_date date not null,
  end_date date not null,
  status text not null default 'open' check (status in ('open','closed','locked')),
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete set null,
  reopened_at timestamptz,
  reopened_by uuid references auth.users(id) on delete set null,
  reopen_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_periods_dates_check check (start_date <= end_date),
  constraint accounting_periods_tenant_id_id_key unique (tenant_id, id),
  constraint accounting_periods_year_sequence_key unique (tenant_id, fiscal_year_id, sequence),
  constraint accounting_periods_year_fk foreign key (tenant_id, fiscal_year_id)
    references public.accounting_fiscal_years(tenant_id, id) on delete restrict
);

create table if not exists public.accounting_cost_centers (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  code text not null,
  name_ar text not null,
  name_en text not null,
  parent_id uuid,
  is_active boolean not null default true,
  is_system boolean not null default false,
  department_id uuid,
  branch_id uuid,
  effective_from date,
  effective_to date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_cost_centers_dates_check check (effective_to is null or effective_from is null or effective_from <= effective_to),
  constraint accounting_cost_centers_not_own_parent check (parent_id is null or parent_id <> id),
  constraint accounting_cost_centers_tenant_id_id_key unique (tenant_id, id),
  constraint accounting_cost_centers_tenant_code_key unique (tenant_id, code),
  constraint accounting_cost_centers_parent_tenant_fk foreign key (tenant_id, parent_id)
    references public.accounting_cost_centers(tenant_id, id) on delete restrict
);

create table if not exists public.accounting_journal_number_sequences (
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fiscal_year_id uuid not null,
  prefix text not null default 'JE',
  next_value bigint not null default 1 check (next_value > 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, fiscal_year_id),
  constraint accounting_journal_sequence_year_fk foreign key (tenant_id, fiscal_year_id)
    references public.accounting_fiscal_years(tenant_id, id) on delete restrict
);

create table if not exists public.accounting_journal_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  entry_number text not null,
  accounting_date date not null,
  document_date date,
  fiscal_year_id uuid not null,
  accounting_period_id uuid not null,
  entry_type text not null default 'manual' check (entry_type in ('manual','automatic','opening_balance','adjustment','reversal','closing')),
  description_ar text,
  description_en text,
  reference text,
  currency text not null default 'OMR' check (currency ~ '^[A-Z]{3}$'),
  exchange_rate numeric(18,6) not null default 1 check (exchange_rate > 0),
  status text not null default 'draft' check (status in ('draft','approved','posted','reversed','void')),
  source_type text,
  source_identifier text,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  posted_by uuid references auth.users(id) on delete set null,
  reversed_entry_id uuid,
  reversal_reason text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_journal_entries_tenant_id_id_key unique (tenant_id, id),
  constraint accounting_journal_entries_number_key unique (tenant_id, fiscal_year_id, entry_number),
  constraint accounting_journal_entries_year_fk foreign key (tenant_id, fiscal_year_id)
    references public.accounting_fiscal_years(tenant_id, id) on delete restrict,
  constraint accounting_journal_entries_period_fk foreign key (tenant_id, accounting_period_id)
    references public.accounting_periods(tenant_id, id) on delete restrict,
  constraint accounting_journal_entries_reversed_fk foreign key (tenant_id, reversed_entry_id)
    references public.accounting_journal_entries(tenant_id, id) on delete restrict,
  constraint accounting_journal_entries_reversal_reason_check check (entry_type <> 'reversal' or btrim(coalesce(reversal_reason,'')) <> '')
);

create table if not exists public.accounting_journal_lines (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  journal_entry_id uuid not null,
  account_id uuid not null,
  line_number integer not null check (line_number > 0),
  description text,
  debit numeric(18,3) not null default 0,
  credit numeric(18,3) not null default 0,
  cost_center_id uuid,
  party_type text,
  party_id uuid,
  claim_id uuid,
  work_order_id uuid,
  vehicle_id uuid,
  invoice_id uuid,
  expense_id uuid,
  payment_id uuid,
  reconciliation_reference text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint accounting_journal_lines_amount_check check (
    debit >= 0 and credit >= 0 and
    ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
  ),
  constraint accounting_journal_lines_entry_line_key unique (tenant_id, journal_entry_id, line_number),
  constraint accounting_journal_lines_entry_fk foreign key (tenant_id, journal_entry_id)
    references public.accounting_journal_entries(tenant_id, id) on delete restrict,
  constraint accounting_journal_lines_account_fk foreign key (tenant_id, account_id)
    references public.accounting_accounts(tenant_id, id) on delete restrict,
  constraint accounting_journal_lines_cost_center_fk foreign key (tenant_id, cost_center_id)
    references public.accounting_cost_centers(tenant_id, id) on delete restrict
);

create table if not exists public.accounting_source_links (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  journal_entry_id uuid not null,
  source_type text not null,
  source_id uuid not null,
  source_number_snapshot text,
  source_status_snapshot text,
  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users(id) on delete set null,
  is_primary boolean not null default false,
  constraint accounting_source_links_entry_fk foreign key (tenant_id, journal_entry_id)
    references public.accounting_journal_entries(tenant_id, id) on delete restrict
);

create unique index if not exists accounting_source_links_primary_unique
  on public.accounting_source_links(tenant_id, source_type, source_id)
  where is_primary;

create table if not exists public.accounting_account_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  mapping_key text not null,
  account_id uuid not null,
  business_type text,
  department_id uuid,
  cost_center_id uuid,
  effective_from date,
  effective_to date,
  priority integer not null default 100,
  status text not null default 'active' check (status in ('active','inactive')),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_account_mappings_dates_check check (effective_to is null or effective_from is null or effective_from <= effective_to),
  constraint accounting_account_mappings_account_fk foreign key (tenant_id, account_id)
    references public.accounting_accounts(tenant_id, id) on delete restrict,
  constraint accounting_account_mappings_cost_center_fk foreign key (tenant_id, cost_center_id)
    references public.accounting_cost_centers(tenant_id, id) on delete restrict
);

create unique index if not exists accounting_account_mappings_scope_unique
  on public.accounting_account_mappings(
    tenant_id, mapping_key, coalesce(business_type,''),
    coalesce(department_id,'00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(cost_center_id,'00000000-0000-0000-0000-000000000000'::uuid), priority
  );

create table if not exists public.accounting_posting_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  rule_key text not null,
  source_type text not null,
  event_type text not null,
  debit_mapping_key text not null,
  credit_mapping_key text not null,
  is_active boolean not null default false,
  priority integer not null default 100,
  configuration jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_posting_rules_tenant_key unique (tenant_id, rule_key)
);

create table if not exists public.accounting_opening_balances (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fiscal_year_id uuid not null,
  account_id uuid not null,
  cost_center_id uuid,
  debit numeric(18,3) not null default 0,
  credit numeric(18,3) not null default 0,
  status text not null default 'draft' check (status in ('draft','approved','posted','void')),
  source text,
  posting_journal_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  constraint accounting_opening_balances_amount_check check (
    debit >= 0 and credit >= 0 and
    ((debit > 0 and credit = 0) or (credit > 0 and debit = 0))
  ),
  constraint accounting_opening_balances_year_fk foreign key (tenant_id, fiscal_year_id)
    references public.accounting_fiscal_years(tenant_id, id) on delete restrict,
  constraint accounting_opening_balances_account_fk foreign key (tenant_id, account_id)
    references public.accounting_accounts(tenant_id, id) on delete restrict,
  constraint accounting_opening_balances_cost_center_fk foreign key (tenant_id, cost_center_id)
    references public.accounting_cost_centers(tenant_id, id) on delete restrict,
  constraint accounting_opening_balances_journal_fk foreign key (tenant_id, posting_journal_entry_id)
    references public.accounting_journal_entries(tenant_id, id) on delete restrict,
  constraint accounting_opening_balances_unique unique (tenant_id, fiscal_year_id, account_id, cost_center_id)
);

create table if not exists public.accounting_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  before_snapshot jsonb,
  after_snapshot jsonb,
  reason text,
  request_context jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.accounting_role_permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  role public.app_role not null,
  permission_key text not null,
  granted boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_role_permissions_key unique (tenant_id, role, permission_key),
  constraint accounting_role_permissions_allowed_key check (permission_key in (
    'accounting.manage_accounts','accounting.manage_fiscal_years','accounting.manage_periods',
    'accounting.manage_cost_centers','accounting.create_journal','accounting.approve_journal',
    'accounting.post_journal','accounting.reverse_journal','accounting.view_journal',
    'accounting.manage_mappings','accounting.manage_opening_balances','accounting.admin'
  ))
);

comment on table public.accounting_journal_entries is
  'Authoritative cloud ledger foundation. Legacy journal_entries remains compatibility-only.';
comment on table public.accounting_posting_rules is
  'Inactive by default. Phase 1 creates no automatic posting rules or historical entries.';
