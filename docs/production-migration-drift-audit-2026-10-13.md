# Production migration drift audit — 2026-10-13

Project: `ifnfwssdtjuzdtshnrht`. Development comparison: `rrhyglrnlveygyiandhs`.

This is a read-only audit. No migration, history repair, data repair, backfill, commit, push, or deployment was performed during this audit. The Supabase CLI link was restored to Production after the Development comparison.

## Method and limits

- Local SQL files: **234**. Production migration-history entries: **165**. Local files absent from history: **69**. Remote-only entries: **0**.
- Inspected all 69 SQL files individually for created objects, altered columns, constraints, direct data effects, and later superseding migrations.
- Compared Production catalog objects with Development: relations, column signatures, functions, indexes, triggers, policies, constraints, and views. Development is older in some areas (122 tables versus 127 in Production), so an environment mismatch is not itself a Production defect.
- Checked 129 `ALTER TABLE ADD COLUMN` declarations and 517 `CREATE TABLE` column declarations against Production: **0 absent**. Named creations are present except the obsolete invoice-receipt cleanup objects and an opening-balance index replaced by a later unique index. Name and column presence do **not** prove that a historical migration ran in full.
- Accounting tables checked have RLS enabled and no anonymous table access. The two legacy accounting views use `security_invoker=true`. No examined accounting function is executable by `anon`.
- A history-only repair requires proof of every definition, grant, trigger, policy, and required data effect; matching names alone is insufficient. See `docs/accounting-production-migration-manifest.md`.

Legend: **Present** = current intended schema/outcome found, not proof of original execution order. **Superseded** = an older form was replaced; do not replay. **Gap** = a required current behavior is absent. **Partial** = only part of the intended outcome is present. No row below authorizes migration-history repair.

## File-by-file disposition

| Version | Migration | Current finding | Disposition |
|---|---|---|---|
| 20260712213000 | Estimate/claim cleanup and AI extraction | Columns, log table, policies and index present | Present |
| 20260715143000 | Unified claim/work-order operational file | Tables, policies, triggers and columns present; all 9 current legacy claim-photo references and 3 work-order-photo references have shared-media rows. Fifteen non-deleted claims lack an operation row (9 cancelled, 6 pending), all without a work order | Present; historical backfill execution not independently provable |
| 20260718090000 | Four-digit work-order renumber | Audit table exists, but global-five-digit and later cash/insurance numbering replaced this format | Superseded; never replay |
| 20260718120000 | Expense supplier FK | Column, FK and index present | Present |
| 20260720130000 | Unified claim media/documents | Columns, indexes, trigger and current legacy-media coverage present | Present; do not rerun data inserts |
| 20260720143000 | Vehicle avatar media | Avatar indexes and columns present | Present |
| 20260721130000 | Legacy public work-order token fallback | Three `_base_20260721` functions and wrappers are absent. The current public RPCs do not resolve `job_orders.tracking_token`. **169 non-deleted work orders** have a different official portal token; a read-only sample of a legacy token returned `not_found` for tracking and signing | **Gap — forward-only replacement required; do not run the old rename migration** |
| 20260723074500 | Auth tenant/role fallbacks | Resolver functions present and match Development catalog fingerprints | Present |
| 20260723193000 | WhatsApp Cloud API readiness | Named tables, columns, constraints, indexes, RLS policies and idempotency function present | Present structurally; no live messaging test in this audit |
| 20260725173000 | Vehicle entry/receipt | Entry tables, sequence, policies, links and trigger present; signature schema was extended later | Present |
| 20260729110000 | Reports Center read models | Saved views table, RLS, index and summary RPC present | Present |
| 20260729120000 | Reports Center detail read models | Views and RPCs present; three Production fact-view definitions differ from Development | Present but evolved; no history repair from names alone |
| 20260729130000 | Reports Center security hardening | Report views and data RPCs deny `anon`; pure `reports_classify_business_type` helper still inherits `PUBLIC EXECUTE` | **Partial grant hardening; low data risk because helper is immutable and reads no table** |
| 20260729140000 | Reports Center sorting fix | Current query RPC contains direction/field-specific ordering | Present outcome |
| 20260729150000 | Reports Center summary parity | Current summary RPC reads `public.job_orders` with the intended source shape | Present outcome |
| 20260730103000 | Reports Center permissions/performance | Permission bridge, secure RPCs and named indexes present | Present |
| 20260730113000 | Reports Center access assertion | Access RPC and saved-view policies present | Present |
| 20260730120000 | Reports Center null-tenant guard | Access and secure summary/query RPCs present, anonymous execution denied | Present |
| 20260730123000 | Work-order report fail-closed wrapper | Wrapper present, anonymous execution denied | Present |
| 20260801100000 | Accounting cloud foundation | All 13 core tables, declared columns and unique indexes present | Present structurally |
| 20260801101000 | Accounting security | Permission function and named tenant policies present; accounting RLS enabled | Present |
| 20260801102000 | Accounting source eligibility | Eligibility functions and source-link validation trigger present | Present |
| 20260801103000 | Accounting validation/posting | Journal functions and guard triggers present | Present structurally; no posting mutation tested here |
| 20260801104000 | Accounting foundation indexes | All named indexes except `accounting_opening_balances_scope_unique` present. Later `accounting_opening_balances_batch_scope_unique` enforces the batch-aware scope | Superseded index; do not recreate obsolete uniqueness |
| 20260801105000 | Accounting runtime hardening | Mapping resolver, journal validation and reversal functions present | Present |
| 20260801106000 | Accounting audit runtime | Audit function present | Present |
| 20260801107000 | Accounting transition security | Journal transition guard present | Present |
| 20260801108000 | Legacy accounting surface security | `accounting_receipts` RLS enabled; two views are security-invoker; anonymous reads denied | Present |
| 20260801109000 | `app_versions` schema alignment | Table, policies and index present | Present |
| 20260801110000 | Accounting posting rules engine | Posting request table, preview/post/reverse RPCs and constraints present | Present structurally; auto-posting not activated by audit |
| 20260801111000 | Supplier posting extension | Supplier source snapshot function present | Present |
| 20260801112000 | Accounting administration | Opening batch, bank and method-mapping tables, policies, guards and indexes present | Present |
| 20260801113000 | Accountant role | `public.app_role` includes `accountant` | Present |
| 20260801114000 | Opening-balance batch scope | Batch-aware unique index present | Present |
| 20260801115000 | Posting-rule fixture guard | Activation guard function present | Present |
| 20260801120000 | Standalone accounting reports | Saved-view table, policies, report RPC and report indexes present | Present |
| 20260801121000 | Report RPC UUID fix | Current report RPC contains UUID aggregate and entry/work-order filters | Present outcome |
| 20260801122000 | Vehicle P&L eligibility | Vehicle P&L RPC present | Present |
| 20260801123000 | Vehicle P&L UUID links | Current RPC contains no legacy `w.id::text` join | Present outcome; patch form superseded |
| 20260801124000 | Vehicle P&L exact UUID links | Same current UUID-safe outcome | Present outcome; patch form superseded |
| 20260802100000 | Production accounting preflight | Supplier FK/index and accounting RLS/grant posture present; no anonymous accounting access detected | Present outcome; do not rerun preflight blindly |
| 20260812100000 | Delete invoice-linked receipts | Insurance deletion trigger/function absent; old cash cleanup triggers/functions absent because the later financial-integrity triggers replace them. No current payment references a missing insurance invoice, but the application has a hard-delete path and no FK on `claim_payments.offset_against_invoice_id` | **Mixed/Gap — preserve insurance payments; do not replay old payment-deleting SQL** |
| 20260813100000 | Monthly vehicle profitability | RPC and named indexes present | Present |
| 20260813110000 | Operational source compatibility | Source snapshot function present but Production definition evolved beyond Development | Present/evolved; compare full final behavior before history repair |
| 20260817120000 | Atomic expense voucher numbering | Sequence table and function present; current function still checks auth, seeds above old numbers, and uses atomic sequence table | Present/evolved |
| 20260817121000 | Expense voucher uniqueness | Guard column/default, unique index, function and trigger present | Present |
| 20260820120000 | One active vehicle entry per claim | Guard function and trigger present | Present |
| 20260825125000 | Cash invoice financial deletion integrity | Cash financial cleanup functions and both delete/soft-delete triggers present | Present; no repair RPC invoked |
| 20260825130000 | Monthly workshop overheads | RPC and operating-expense index present | Present |
| 20260826100000 | Insurance payment SSOT/collection | Functions, trigger and unique index present. There are 22 `LEGACY-PAID` payment rows and zero current active-invoice paid-amount mismatches | Present current outcome; do not rerun historical reconciliation |
| 20260831100000 | Short-year unified invoice numbering | Allocation/lookup functions present; Production definitions evolved beyond Development | Present/evolved; do not re-run invoice-number updates |
| 20260901100000 | Global five-digit work-order numbering | Audit contains 102 `GLOBAL-5-V1` mappings and allocator objects exist, but later typed numbering is authoritative | Superseded; never renumber again |
| 20260901120000 | Expense report linkage view | View present; Production definition differs from Development | Present/evolved |
| 20260901123000 | Lifetime direct-cost basis | Named indexes/RPC present; monthly P&L body was replaced later | Superseded report version |
| 20260902100000 | Revenue composition | Named indexes/RPC present; monthly P&L body was replaced later | Superseded report version |
| 20260902110000 | Payment-month basis | Monthly P&L RPC present; later report rules replaced this version | Superseded report version |
| 20260902120000 | Matched-cost basis | Monthly P&L RPC present; later report rules replaced this version | Superseded report version |
| 20260905100000 | Expense/work-order link SSOT | Link trigger/index present; zero currently resolvable active expenses remain without `work_order_id` | Present current outcome; no backfill rerun |
| 20260907110000 | Cash invoice VAT basis | Monthly P&L RPC present and matches Development catalog fingerprint | Present outcome; financial result not recalculated in this audit |
| 20260907120000 | Atomic cash invoice payment | Atomic payment RPC present | Present |
| 20260907143000 | Insurance early-settlement discount | Discount columns, constraints, index, guards and RPC present | Present |
| 20260907173000 | Manager insurance payment correction | Manager-edit RPC present; cleared-cheque rule was updated by 20261010100000 | Superseded rule version |
| 20260909100000 | Work-order renumber audit RLS | Audit-table RLS and tenant-read policy present | Present |
| 20260912170000 | Vehicle-entry customer signature | Link table, policies, columns and public-signature RPCs present | Present |
| 20261001100000 | Manual cash invoice gap issuance | Controlled issuance RPC present | Present; no invoice created by audit |
| 20261006090000 | Paged receipts read | Tenant-scoped paged receipt RPC present | Present |
| 20261006100000 | Atomic receipt-number reservation | Sequence table/RLS and reservation RPC present | Present; no number reserved by audit |
| 20261010100000 | Cleared-cheque settlement discount | Current manager RPC present with `SETTLEMENT_DISCOUNT_REQUIRES_CLEARED` guard | Present |
| 20261010110000 | Expense supplier invoice filter | Local file is untracked. Production `expense_management_rpc` exists but does **not** contain the `supplier_invoice_number` filter | **Gap — separate unfinished expense change; do not fold into history repair** |

## Confirmed risks and safe order

1. **Legacy public work-order links:** 169 non-deleted work orders have distinct legacy and official tokens; a sampled legacy token returned `not_found` in both public RPCs. Build a forward-only replacement on Development that preserves the current RPC bodies and checks old/new tokens, tenant isolation, and signing. Do not replay the old function-renaming migration on Production.
2. **Insurance invoice deletion:** no linked-payment orphan exists now, but the active client delete hook can hard-delete `insurance_invoices` and the old cleanup migration's insurance trigger is absent. The old SQL would delete payments and perform historical linking; it must not run. Decide whether a paid invoice deletion should be denied, voided with audited reversal, or otherwise reconciled before designing a new migration. Preserve payment history in all cases.
3. **Reports helper grant:** `reports_classify_business_type` is executable through `PUBLIC`; it reads no table, but its grant differs from the hardening intent. A narrowly scoped revoke can be prepared and tested independently.
4. **Supplier invoice filter:** the untracked migration is not active in Production. Keep it separate from migration-history reconciliation and other local expense work.
5. **History drift:** leave all 69 entries unaltered for now. Do not use blanket `db push` or mark a version applied based on object names. For each history-only candidate, prove full final-state equivalence and historical data effects first; old renumber and invoice-number migrations must not be replayed.
