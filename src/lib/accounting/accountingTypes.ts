export type AccountingAccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "cost_of_revenue"
  | "expense";

export type AccountingNormalBalance = "debit" | "credit";
export type AccountingPeriodStatus = "open" | "closed" | "locked";
export type AccountingJournalStatus = "draft" | "approved" | "posted" | "reversed" | "void";
export type AccountingJournalEntryType = "manual" | "automatic" | "opening_balance" | "adjustment" | "reversal" | "closing";

export interface AccountingAccount {
  id: string;
  tenant_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  account_type: AccountingAccountType;
  normal_balance: AccountingNormalBalance;
  level: number;
  is_postable: boolean;
  is_system: boolean;
  is_active: boolean;
  requires_cost_center: boolean;
  requires_reconciliation: boolean;
  notes?: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingFiscalYear {
  id: string;
  tenant_id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: AccountingPeriodStatus;
  closed_at: string | null;
  reopened_at: string | null;
  reopen_reason: string | null;
}

export interface AccountingPeriod {
  id: string;
  tenant_id: string;
  fiscal_year_id: string;
  name: string;
  sequence: number;
  start_date: string;
  end_date: string;
  status: AccountingPeriodStatus;
}

export interface AccountingCostCenter {
  id: string;
  tenant_id: string;
  code: string;
  name_ar: string;
  name_en: string;
  parent_id: string | null;
  is_active: boolean;
  is_system: boolean;
  effective_from: string | null;
  effective_to: string | null;
}

export interface AccountingJournalEntry {
  id: string;
  tenant_id: string;
  entry_number: string;
  accounting_date: string;
  document_date: string | null;
  fiscal_year_id: string;
  accounting_period_id: string;
  entry_type: AccountingJournalEntryType;
  description_ar: string | null;
  description_en: string | null;
  reference: string | null;
  currency: string;
  exchange_rate: string;
  status: AccountingJournalStatus;
  source_type: string | null;
  source_identifier: string | null;
  approved_at: string | null;
  posted_at: string | null;
  reversed_entry_id: string | null;
  reversal_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface AccountingJournalLine {
  id: string;
  tenant_id: string;
  journal_entry_id: string;
  account_id: string;
  line_number: number;
  description: string | null;
  debit: string;
  credit: string;
  cost_center_id: string | null;
  party_type: string | null;
  party_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  vehicle_id: string | null;
  invoice_id: string | null;
  expense_id: string | null;
  payment_id: string | null;
}

export interface AccountingSourceLink {
  id: string;
  tenant_id: string;
  journal_entry_id: string;
  source_type: AccountingSourceType;
  source_id: string;
  source_number_snapshot: string | null;
  source_status_snapshot: string | null;
  is_primary: boolean;
}

export type AccountingSourceType =
  | "sales_invoice"
  | "cash_invoice"
  | "insurance_invoice"
  | "expense"
  | "supplier_invoice"
  | "sales_payment"
  | "claim_payment"
  | "supplier_payment"
  | "work_order"
  | "claim"
  | "vehicle"
  | "customer"
  | "supplier"
  | "manual_journal"
  | "opening_balance"
  | "reversal";

export interface AccountingAccountMapping {
  id: string;
  tenant_id: string;
  mapping_key: string;
  account_id: string;
  business_type: string | null;
  department_id: string | null;
  cost_center_id: string | null;
  effective_from: string | null;
  effective_to: string | null;
  priority: number;
  status: "active" | "inactive";
}

export interface AccountingPostingRule {
  id: string;
  tenant_id: string;
  rule_key: string;
  source_type: string;
  event_type: string;
  debit_mapping_key: string;
  credit_mapping_key: string;
  is_active: boolean;
  priority: number;
  configuration: Record<string, unknown>;
  description_ar?: string | null;
  description_en?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
}

export interface AccountingPostingPreviewLine {
  line_number: number;
  side: "debit" | "credit";
  mapping_key: string;
  account_id: string;
  description: string | null;
  debit: number;
  credit: number;
  party_type: string | null;
  party_id: string | null;
  claim_id: string | null;
  work_order_id: string | null;
  vehicle_id: string | null;
  invoice_id: string | null;
  expense_id: string | null;
  payment_id: string | null;
}

export interface AccountingPostingPreview {
  tenant_id: string;
  source_type: AccountingSourceType;
  source_id: string;
  event_type: string;
  accounting_date: string;
  rule_id: string;
  rule_key: string;
  source: Record<string, unknown>;
  lines: AccountingPostingPreviewLine[];
  total_debit: number;
  total_credit: number;
  balanced: true;
  write_performed: false;
}

export interface AccountingOpeningBalance {
  id: string;
  tenant_id: string;
  fiscal_year_id: string;
  account_id: string;
  cost_center_id: string | null;
  debit: string;
  credit: string;
  status: "draft" | "approved" | "posted" | "void";
  source: string | null;
  posting_journal_entry_id: string | null;
  batch_id?: string | null;
  line_description?: string | null;
}

export interface AccountingOpeningBalanceBatch {
  id: string;
  tenant_id: string;
  fiscal_year_id: string;
  batch_number: string;
  description: string | null;
  status: "draft" | "approved" | "posted" | "void";
  approved_at: string | null;
  posted_at: string | null;
  posting_journal_entry_id: string | null;
  created_at: string;
}

export interface AccountingCashBankAccount {
  id: string;
  tenant_id: string;
  name_ar: string;
  name_en: string;
  account_kind: "cash" | "bank";
  accounting_account_id: string;
  bank_name: string | null;
  reference_suffix: string | null;
  currency: "OMR";
  is_active: boolean;
  is_default: boolean;
}

export interface AccountingPaymentMethodMapping {
  id: string;
  tenant_id: string;
  payment_method: string;
  cash_bank_account_id: string;
  is_active: boolean;
}

export interface AccountingSetupReadiness {
  schema_available: boolean;
  accounts: number;
  postable_accounts: number;
  fiscal_years: number;
  open_periods: number;
  cost_centers: number;
  mappings: number;
  missing_mappings: string[];
  posting_rules: number;
  active_posting_rules: number;
  cash_accounts: number;
  bank_accounts: number;
  opening_batches: number;
  permissions: boolean;
  tenant_isolation: boolean;
  auto_posting: false;
}

export interface AccountingAuditLog {
  id: string;
  tenant_id: string;
  user_id: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  before_snapshot: Record<string, unknown> | null;
  after_snapshot: Record<string, unknown> | null;
  reason: string | null;
  request_context: Record<string, unknown> | null;
  created_at: string;
}

export interface CreateJournalInput {
  tenantId: string;
  fiscalYearId: string;
  periodId: string;
  accountingDate: string;
  documentDate?: string | null;
  entryType?: AccountingJournalEntryType;
  descriptionAr?: string | null;
  descriptionEn?: string | null;
  reference?: string | null;
  sourceType?: string | null;
  sourceIdentifier?: string | null;
}

export interface CreateJournalLineInput {
  tenantId: string;
  journalEntryId: string;
  accountId: string;
  lineNumber: number;
  description?: string | null;
  debit: string;
  credit: string;
  costCenterId?: string | null;
  claimId?: string | null;
  workOrderId?: string | null;
  vehicleId?: string | null;
  invoiceId?: string | null;
  expenseId?: string | null;
  paymentId?: string | null;
}

export const ACCOUNTING_MAPPING_KEYS = [
  "insurance_receivable",
  "cash_customer_receivable",
  "sales_revenue",
  "insurance_revenue",
  "cash_revenue",
  "output_vat",
  "input_vat",
  "cash",
  "bank",
  "supplier_payable",
  "parts_cost",
  "labor_cost",
  "transport_cost",
  "operating_expense",
  "discounts",
  "credit_notes",
  "payment_clearing",
] as const;

export type AccountingMappingKey = (typeof ACCOUNTING_MAPPING_KEYS)[number];
