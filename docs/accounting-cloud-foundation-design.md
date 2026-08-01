# Phase 1 — Cloud Accounting Foundation Design

## Boundary

This phase creates schema, validation, security, service contracts, and tests only.
It does not apply migrations, backfill history, auto-post operational documents,
create accounting reports, or add production routes.

## Design matrix

| Required Area | Existing Object | Reuse | Extend | Create New | Reason |
|---|---|---:|---:|---:|---|
| Tenant identity | `tenants`, `profiles`, `get_user_tenant_id()` | Yes | No | No | Existing server-side tenant resolution remains authoritative |
| Roles | `app_role`, `get_user_role()` | Yes | Yes | `accounting_role_permissions` grants only | Extends existing roles without a parallel identity system |
| Legacy journals | `journal_entries`, `journal_lines` | Compatibility only | No | `accounting_journal_entries`, `accounting_journal_lines` | Legacy tables lack fiscal periods, immutable posting, account FKs, reversal, and safe state transitions |
| Chart of accounts | TypeScript account strings | No | No | `accounting_accounts` | Controlled tenant hierarchy and postability are required |
| Fiscal control | None | No | No | Fiscal years and periods | Posting must be date- and status-controlled |
| Cost centers | Expense text/category fields | No | No | `accounting_cost_centers` | Accounting dimensions require stable IDs and tenant validation |
| Source links | Source columns on legacy journal | Concept only | No | `accounting_source_links` | Supports multiple sources and atomic duplicate-primary protection |
| Account mappings | Hard-coded/local account names | No | No | `accounting_account_mappings` | Prevents hard-coded account UUIDs and supports tenant configuration |
| Posting rules | Client bridges | Compatibility only | No | `accounting_posting_rules` | Rules are inactive by default; no automatic posting in Phase 1 |
| Opening balances | None | No | No | `accounting_opening_balances` | Foundation only; no imported balances or generated entries |
| Audit | Operational and local audit stores | Pattern only | No | `accounting_audit_logs` | Financial audit must be cloud, immutable to users, and tenant-scoped |
| Eligibility | Ad-hoc report filters | No | No | `is_accounting_source_eligible` | Deleted/cancelled data and deleted parents must be excluded centrally |
| Numbering | Existing document numbering patterns | Pattern | No | Atomic journal sequence RPC | Avoids `MAX + 1` and LocalStorage |
| Money | `money.ts`, numeric DB columns | Formatting only | No | `numeric(18,3)` ledger amounts | Database precision is authoritative; no float columns |
| Frontend state | Zustand/local accounting stores | Read-only compatibility | No | Cloud services | New accounting foundation never writes financial truth to LocalStorage |

## Source eligibility matrix

| Entity | Active predicate | Deleted/cancelled predicate | Parent validation |
|---|---|---|---|
| Sales/cash/insurance invoice | Tenant matches and active status | No deleted, archived, cancelled, or void record | Work order and claim must remain eligible |
| Expense | Tenant matches and active status | No deleted, archived, cancelled, or void record | Linked work order and claim must remain eligible |
| Work order | Tenant matches | No deleted, archived, or cancelled record | N/A |
| Claim | Tenant matches | No deleted, archived, or financially cancelled record | N/A |
| Payment | Tenant matches and successful status | No deleted, failed, bounced, cancelled, or reversed record | Parent invoice/claim must remain eligible |
| Journal entry | Tenant matches | Only `posted` affects the future ledger | Reversal is a separate posted entry; original remains historical |
| Vehicle/customer/supplier | Tenant matches and active | Deleted/archived records excluded | Used as dimensions/parties, not revenue sources |

## State and transaction rules

- Draft journals may be incomplete while edited.
- Approval and posting revalidate OMR balance at `numeric(18,3)` precision.
- Direct status changes are rejected; approval, posting, reversal, and period
  transitions use database functions.
- Posted entries and their lines are immutable.
- Reversal creates a separate journal with debit/credit swapped. The original
  posted entry is retained and never deleted or rewritten.
- Source links are checked by the database and primary posting is unique per
  tenant/source.
- Posting functions lock the journal row and perform validation and status
  mutation in one database transaction.

## Deferred intentionally

- No chart template is assigned to a tenant.
- No account mapping is populated.
- No posting rule is activated.
- No old invoice, payment, expense, claim, work order, or local journal is posted.
- No report or accounting administration page is introduced.
- Official generated Supabase types must be regenerated after these migrations
  are applied to a safe Development/Preview database; Phase 1 services use a
  migration-aligned domain type layer meanwhile.
