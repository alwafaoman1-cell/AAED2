# Accounting Reports — Foundation & Gap Analysis

## 1. Scope and decision

This document records Phase 0 only. No accounting page, migration, database
write, commit, push, or deployment was performed.

**Foundation classification: `Partial Accounting Foundation Exists`.**

The project contains operational financial documents, tenant-scoped database
tables for journal headers and lines, VAT helpers, purchase/sales/insurance
payment flows, and several reporting implementations. It does **not** yet have
one authoritative, cloud-first, complete double-entry accounting engine.

The current implementation must not be presented as a full general ledger or
as a reliable source for statutory financial statements until the gaps in this
document are closed.

## 2. Evidence reviewed

### Database and migrations

- `supabase/migrations/20260530084637_56bf0a47-35bc-40b6-8395-55625b2fd4b7.sql`
  creates `expenses`, `journal_entries`, `journal_lines`,
  `sales_documents`, and `sales_payments`.
- `supabase/migrations/20260530160523_adab4326-b064-4bb5-bf35-3b211179798f.sql`
  creates suppliers, purchase invoices, and supplier payments.
- `supabase/migrations/20260425163929_e013aaca-3044-42dc-86b2-93a6ac6e2f30.sql`
  creates claim payments.
- `supabase/migrations/20260426123851_2cee9aee-e88f-4096-b07a-9ad4488cc3f9.sql`
  creates insurance invoices.
- `supabase/migrations/20260626110000_accounting_core_views.sql`
  creates accounting views and summary RPCs.
- `supabase/migrations/20260627102000_operational_delete_policy_and_required_parts.sql`
  and `20260627114000_soft_delete_deleted_by_guards.sql` add only a partial
  soft-delete model.
- Generated Supabase types in `src/integrations/supabase/types.ts`.

### Application code

- `src/lib/journalStore.ts`
- `src/lib/accountingBridge.ts`
- `src/lib/salesAccounting.ts`
- `src/lib/insuranceAccounting.ts`
- `src/lib/purchaseAccounting.ts`
- `src/lib/accounting/core.ts`
- `src/lib/reportsEngine.ts`
- `src/pages/Accounting.tsx`
- `src/pages/apps/AccountantApp.tsx`
- `src/pages/dashboard/ExecutiveDashboard.tsx`
- `src/pages/reports/CloudAdvancedReports.tsx`
- `src/pages/Reports.tsx`
- `src/pages/ReportsCenter.tsx`
- `src/lib/reports-center/*`
- `src/lib/deletePolicy/index.ts`
- `src/lib/reportExporters.ts`
- `src/lib/rbac.ts`
- accounting and reports contract tests.

### Production verification boundary

The linked project ref is `ifnfwssdtjuzdtshnrht`. The repository migrations
and generated Supabase types were audited. A read-only SQL Editor verification
was attempted through the authenticated dashboard session, but the editor DOM
did not become inspectable within the automation timeout. Therefore this Phase
0 report does not claim live row counts, live policy output, or that every
migration is applied in Production.

There is already evidence of schema-contract drift: generated types omit some
soft-delete fields that later migrations add to `expenses` and
`sales_documents`. Before any accounting migration, Production
`information_schema`, `pg_policies`, applied migration history, and data anomaly
counts must be captured read-only.

## 3. Foundation matrix

| Area | Current state | Evidence | Gap / risk |
|---|---|---|---|
| Chart of Accounts | Not implemented as database master data | Accounts are a TypeScript string union in `journalStore.ts` | No account IDs, types, hierarchy, normal balance, active state, or tenant-defined chart |
| Account numbering | Partial labels/codes only | `journal_lines.account_code` is free text | No controlled unique account numbering |
| Account hierarchy | Missing | No parent account table/column | Cannot produce a dependable balance sheet hierarchy |
| Journal headers | Database table exists | `journal_entries` | Application does not use it as its primary operational source |
| Journal lines | Database table exists | `journal_lines` | No atomic posting service proves header/lines/totals together |
| Double-entry enforcement | Partial | Local entry has one debit and one credit; SQL has separate lines | No database constraint/deferred trigger ensures balanced entries |
| Posting state | Missing | No `draft/posted/reversed` lifecycle on journal headers | Entries can be changed/deleted; no immutable posted state |
| Reversal | Partial/manual deletion | `removeJournalBySource` deletes local entries | Deletion is not an accounting reversal with traceable contra-entry |
| Source linking | Partial | `source_type`, `source_id`, local source enum | IDs are text, no complete foreign-key model, and no universal idempotency |
| Fiscal years | Missing | No fiscal-year table/service | No controlled reporting year or opening/closing |
| Accounting periods | Missing | No period table/service | No open/closed/locked period |
| Opening balances | Missing | No authoritative opening-balance model | Trial balance cannot be relied on across fiscal years |
| Multi-currency | Not designed | OMR is used operationally | Acceptable for current scope, but currency is not a ledger-level control |
| OMR precision | Partial | Central money helper uses 3 decimals; many legacy UI calculations use JS numbers | Database columns often use generic `numeric`; client aggregation remains |
| Sales invoices | Implemented operationally | `sales_documents` | Eligibility rules are scattered; status semantics are inconsistent |
| Insurance invoices | Separate table exists | `insurance_invoices` | Not integrated into the same authoritative posting pipeline as cash invoices |
| Invoice items | JSON in core document tables | `sales_documents.items`, `insurance_invoices.items` | No normalized accounting line/source mapping |
| Customer payments | Cloud table plus embedded/local representations | `sales_payments`, `SalesDoc.payments` | More than one source can represent paid amount |
| Claim payments | Cloud table exists | `claim_payments` | No soft-delete field; `pending` is counted inconsistently in some summaries |
| Expenses | Cloud table and store | `expenses` | Actual/archived/deleted eligibility differs by page |
| Purchase invoices | Cloud table plus local store | `purchase_invoices` | No unified posted-state or deletion policy |
| Supplier payments | Cloud table plus local store | `supplier_payments` | No central validity/deletion predicate |
| Suppliers | Cloud table | `suppliers.is_active` | Inactive is not consistently treated as deleted/ineligible |
| Credit notes | Local foundation | `creditNotesStore.ts` | Not a complete cloud accounting document/posting flow |
| Debit notes | Missing | No reliable document model found | Required for complete payables/adjustments |
| Cash accounts | Labels/settings only | journal account strings and finance settings | No controlled account master or reconciled cashbook |
| Bank accounts | Labels/settings only | journal account strings and payment methods | No bank-account master, statement import, or reconciliation |
| Cost centers | Partial text field | `SalesDoc.costCenter` | No database master, dimensions, allocation, or enforced links |
| Branches | Missing as accounting dimension | No branch ledger dimension found | Cannot segment statements by branch reliably |
| VAT | Strong operational helper, partial ledger | `money.ts`, invoice VAT fields, VAT exports | VAT reporting sources are not one posted ledger; cancellation/deletion rules vary |
| Receivables | Operational calculations exist | invoice totals, paid amounts, aging code | Multiple paid-amount sources and incomplete parent/deletion validation |
| Payables | Operational calculations exist | purchase invoice/payment stores and tables | No authoritative sub-ledger-to-GL reconciliation |
| Trial balance | UI/local calculation only | `JournalLedger.tsx`, `reportsEngine.ts` | Built from local journal store, not a controlled posted cloud ledger |
| General ledger | Not complete | Journal UI groups local entries | No standalone account ledger with opening/running/closing balances |
| Financial statements | Not reliable | P&L-like summaries exist | No complete CoA, periods, opening balances, or ledger-backed statements |
| Audit trail | Operational audit exists | `operational_audit_log`, claim audit logs | Not a strict accounting posting/reversal audit trail |
| Tenant isolation | Present at table RLS level | policies use `get_user_tenant_id()` | Must still be tested for every future RPC/view/export |
| Report exports | XLSX/PDF helpers exist | `reportExporters.ts`, PDF helpers | Current reports do not all use one server query/calculation definition |
| Report permissions | Broad role/module rules exist | `rbac.ts`, route role guards | Requested fine-grained `accounting_reports.*` permissions do not exist |

## 4. The central architectural problem

There are three parallel accounting representations:

1. Cloud operational tables (`sales_documents`, `insurance_invoices`,
   `expenses`, payments, purchases).
2. Cloud journal header/line tables.
3. Local application stores, especially `journalStore`, sales/purchase stores,
   and client-side report builders.

The visible journal and trial balance use `journalStore`, whose key is
`alwafa_journal_v1`. Cloud migration helpers can copy local entries to
`journal_entries/journal_lines`, but the cloud journal is not the authoritative
write/read path for daily posting.

Consequences:

- Two users/browsers can see different journal state.
- A deleted source can leave or remove journal state differently depending on
  which client performed the action.
- Dashboard, Accountant App, Reports, and SQL views can return different totals.
- A locally balanced entry does not prove the cloud ledger is complete.
- Financial statements cannot be audited from a single immutable source.

## 5. Current posting behavior

### Sales

`salesAccounting.ts` creates local journal entries for subtotal and VAT. Each
logical amount is stored as a local object with one debit account, one credit
account, and one amount. It removes prior entries for the source before adding
new ones.

Risk: this is replacement-by-deletion, not versioned posting/reversal.

### Insurance

`insuranceAccounting.ts` correctly prevents claim approval from becoming
revenue by returning before posting. Insurance payments can create local
journal entries. However, no single inspected service posts the final insurance
invoice into the same authoritative cloud ledger used by all reports.

### Purchases

`purchaseAccounting.ts` posts inventory, input VAT, freight, supplier payment,
and return entries into the local journal store. It also mutates inventory
locally. Unposting deletes linked entries.

Risk: purchase posting and inventory valuation are not wrapped in one cloud
transaction.

### Expenses

`accountingBridge.ts` listens to `expensesStore`, removes/recreates local
expense journal entries, and can start synchronization from client state.

Risk: accounting completeness depends on application boot and store refresh.

## 6. Conflicting report behavior

The same accounting concepts are calculated differently:

- `Accounting.tsx` resets journal-derived totals and recalculates revenue from
  active sales invoices and expenses from active expense vouchers.
- `AccountantApp.tsx` includes invoice `total` rather than subtotal, does not
  consistently exclude draft/cancelled documents, and does not apply the same
  expense deletion filters.
- `ExecutiveDashboard.tsx` uses `accounting/core.ts`, local stores, and a timer.
- `CloudAdvancedReports.tsx` reads cloud tables directly and performs a separate
  calculation.
- `reportsEngine.ts` is client-side and still depends on stores.
- `accounting_core_views.sql` contains a historical fallback to work-order
  subtotal/estimated parts/labour, which conflicts with current business rules.

This means no current figure can be assumed to have screen/XLSX/PDF parity
without report-specific verification.

## 7. Deleted-record policy audit

There is no central `accountingRecordEligibility` rule.

| Entity | Physical/soft deletion found | Current exclusion quality | Required action before reports |
|---|---|---|---|
| Cash sales invoice | `deleted_at`, `archived_at`, `status=cancelled` are available by migrations | Partial and page-specific | One authoritative active predicate including deleted, archived, cancelled/void and parent validity |
| Insurance invoice | Status includes cancelled; no inspected soft-delete field | Partial | Define immutable cancel/void policy and active predicate |
| Expense | `deleted_at`, `archived_at`, `deleted_by` | Partial | Central active predicate; exclude refunded/void consistently |
| Work order | `deleted_at`, `archived_at`, `deleted_by` | Better operational support | All financial reports must reject children of deleted/archived work orders |
| Insurance claim | Status cancellation/rejection found; no inspected soft-delete field | Incomplete | Add/confirm deletion semantics before parent validation |
| Sales payment | Hard delete policy and FK cascade from sales document | Unsafe for audit | Prefer void/reversal; exclude invalid parent |
| Claim payment | Status pending/cleared/bounced; hard delete allowed | Incomplete | Add validity/deletion semantics; count only qualifying status |
| Supplier payment | Hard delete allowed; no soft-delete field | Incomplete | Define void/reversal and parent validation |
| Journal entry | Hard delete allowed to admin; no deleted/reversed/posted state | Critical gap | Immutable posted entries plus reversal state |
| Journal line | Cascades on journal entry deletion | Critical gap | Must follow immutable header/reversal model |
| Customer | archive and soft delete exist | Partial | Define whether historical financial documents remain reportable without exposing deleted party |
| Vehicle | archive and soft delete exist | Partial | Exclude deleted operations; retain auditable vehicle snapshot if permitted |
| Supplier | `is_active`; hard delete allowed | Partial | Define inactive vs deleted and historical statement policy |

`deletePolicy/index.ts` archives/cancels some related expenses and cash invoices
when a work order is deleted with related records. It does not establish a
complete policy for insurance invoices, all payment types, journal entries,
purchase documents, or active financial children of a deleted parent.

### Critical deletion gaps

1. The SQL accounting views do not filter `job_orders.deleted_at`,
   `job_orders.archived_at`, `expenses.deleted_at`, or `expenses.archived_at`.
2. Payment tables generally lack soft-delete/void metadata.
3. Journal entries can be hard-deleted.
4. Generated Supabase types do not consistently reflect later deletion columns,
   indicating schema-contract drift.
5. No central predicate is shared by UI, SQL, XLSX, PDF, and Print.

## 8. Existing accounting RPC/view assessment

`accounting_work_order_profit_view` and summary RPCs are tenant-scoped through
`get_user_tenant_id()`, which is positive. They are not safe as the future
accounting foundation because:

- work-order subtotal can become revenue when no issued invoice exists;
- work-order parts/labour can become actual cost when no expense exists;
- deleted/archived records are not excluded;
- insurance invoices are not included in the work-order revenue CTE;
- payment validity is based largely on stored invoice paid amounts;
- no posted-journal eligibility is enforced.

These views should be replaced in a reviewed migration, not silently reused.

## 9. Financial statement readiness

| Statement/report | Current readiness | Reason |
|---|---|---|
| Journal register | Partial | Local journal exists; cloud source is not authoritative |
| General ledger | Not ready | No controlled CoA, opening balance, posted state, or immutable entries |
| Trial balance | Not ready | Local aggregation only; no posting/period controls |
| Income statement | Not ready | Revenue/cost definitions differ across pages |
| Balance sheet | Not ready | No complete account taxonomy/opening balances |
| Cash flow | Not ready | Cash/bank sub-ledgers and reconciliation are absent |
| Receivables aging | Partial operational report | Multiple paid sources and deletion/parent gaps |
| Payables aging | Partial operational report | No GL reconciliation or unified validity rules |
| VAT report | Partial/usable for operational review | Needs one eligibility source and accountant verification |
| Vehicle P&L | Partial | Legacy behavior documented separately |

## 10. Required foundation before report pages

The next implementation phase should not begin with UI. It should begin with a
reviewed accounting foundation:

1. Read-only Production schema/policy/data anomaly snapshot.
2. Cloud Chart of Accounts with tenant scope, code, hierarchy, type, normal
   balance, and active state.
3. Fiscal years and periods without retroactive automatic locking.
4. Immutable journal headers/lines with draft, posted, reversed states.
5. Database enforcement that posted entries balance.
6. Atomic posting RPCs with source idempotency.
7. Source mappings for cash invoice, insurance invoice, credit note, customer
   payment, claim payment, expense, purchase invoice, supplier payment, and
   reversal.
8. Central active-record/parent-eligibility SQL predicates.
9. A data-quality report for active financial documents linked to deleted
   operational parents.
10. Cloud-first sub-ledger reconciliation for receivables, payables, VAT,
    cash, and bank.
11. Server-side report RPCs using PostgreSQL `numeric`.
12. Fine-grained report permissions enforced in UI, service/RPC, export, and
    direct route.

## 11. Recommended rollout order

1. Production read-only validation and anomaly counts.
2. Accounting schema design review.
3. Non-destructive foundation migration.
4. Posting services and idempotent backfill dry-run.
5. Reconciliation report before accepting backfill.
6. Central eligibility/deletion rules.
7. Journal and general ledger pages.
8. Trial balance and financial statements only after reconciliation.
9. Receivable/payable/VAT/cash/bank pages.
10. Vehicle P&L parity and operation drill-down.
11. XLSX/PDF/Print from the same server report result.

## 12. Phase 0 conclusion

The project has useful operational accounting components, but the accounting
foundation is fragmented and partly local. Building the requested standalone
report center directly on the current stores/views would preserve historical
inconsistencies and produce reports that cannot be reliably reconciled.

**Decision: Phase 0 analysis complete. Implementation must wait for approval of
the foundation design and a live read-only Production validation.**
