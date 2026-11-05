# Financial reconciliation and security verification — Development

Status: bounded financial/security Development verification complete. This is not a Production rollout approval or a zero-advisory certificate.

## Scope and boundaries

- Branch: `codex/finance-security-development`, based on deployed intake commit `87facc590fc4458a51736397732e97962e60b5b2`.
- Development: `rrhyglrnlveygyiandhs`. Production: `ifnfwssdtjuzdtshnrht`, read-only inspection only.
- No commits, push, Production deployment, Production SQL, historical backfill, posting, invoice renumbering or reclassification.
- The old dirty worktree was not merged wholesale. Only the reviewed finance/security files were integrated into the current intake release.
- No Production rows or users were copied to Development. Browser tests use a separately labelled synthetic Development tenant; the read-model fixtures do not reserve official invoice numbers.

## Confirmed causes and changes

| Issue | Root cause | Repair and evidence |
| --- | --- | --- |
| 28 insurance balances overstated by OMR 3,773.818 | `reports_invoice_facts_v1` subtracted cash but not approved cleared settlement discounts | Read-only projection over all 96 active Production invoices: 28 mismatches before, zero with the proposed read model; cash values unchanged. Stored payment/discount source totals already match receipts. No data repair is required. |
| Statement and summary disagreement | Non-cash settlements absent from downstream statement/read-model calculations | Separate settlement credit, real receipts remain cash only; invoice-date cohort balance and payment-date collection are independently tested. |
| Monthly cost remaining deferred after final settlement | Cost-release ratio ignored the approved receivable closure | Full direct cost releases on completed settlement, with no duplicate cost between periods; cancelled claims/deleted parent orders remain excluded from the existing monthly eligibility rule. |
| Partial or unstable exports appearing successful | Export trusted page metadata without checking complete/stable result sets | Reject incomplete/changed exports; monthly export also detects repeated operation IDs and reports its size limit explicitly. |
| Overstated monthly profit after HR/settings failures | Cached or failed source reads could become empty defaults; page rendered missing totals as zero | Require fresh confirmed HR/settings reads; hide financial figures and block export until all three monthly sources succeed; visible retry on failure. |
| Missing Development monthly detail RPC | Development lacked the existing `monthly_workshop_overheads_rpc` although Production has it | Restored the exact inspected Production definition, hash `d2bb3c5a1d057ce984ed6c75af4a9a62`; no source mutation/index change. Existing matching installations are a no-op; drift raises an error. |
| Disabled/invited/orphan identities retaining authority | Central role/tenant helpers ignored account activation/disable state | Active-profile gate; 7 active roles preserved, 4 inactive/orphan cases denied, 7 foreign-tenant cases denied. An additional 63 denials across 21 financial read RPCs pass. |
| Client metadata/cache used as authority | User-editable metadata/default-admin and a persistent profile snapshot could supply tenant/role | Database-confirmed active profile only; retain in-memory deduplication, remove persisted authority and orphan role fallback, clear tenant/settings scope on invalid profile. Preserve same-user token refresh/unsaved-form behaviour. |
| Privileged Edge access inconsistent with SQL gate | `manage-users` excluded only literal disabled status | Require active and no disable timestamp. Actual Development Edge tests cover active access, disabled/invited/timestamp denial and caller-only confirmed invitation acceptance. |
| Provisioning/activation false success | Unconfirmed profile binding and activation retries could be reported incorrectly | Confirm tenant/profile/role writes, fail visibly without reparenting; self-acceptance cannot choose role/tenant/user. Activation retry does not resave an already-confirmed password; both invite routes use the acceptance page. |
| Redundant permissive-policy evaluation | Equivalent policies overlapped per command/role | Preserve original OR semantics, including implicit CHECK, while consolidating 89 policies on 29 tables into explicit command policies. 7-role, 203 role/table, 609 visibility/planning checks are identical before/after. Restrictive policies/grants preserved. Explicit rollback restores the original policy catalogue. |
| Last ESLint Fast Refresh warning | Non-component account template export in TSX | Move the unchanged chart template constant to a plain TS module; no account data or mapping changes. |
| Dependency high/critical advisories | Vulnerable sanitizer/build/test/router/validation versions | Reviewed lockfile updates, without incompatible Workbox overrides. XLSX official tarball/PDF.js pins preserved; explicit Vite 5 transpilation targets retained. Final audit evidence below. |

## Development database verification

- Reproduced the settlement failure by temporarily installing the inspected Production read-model definitions in a Development rollback transaction, then verified the exact six-file financial upgrade chain.
- 28 synthetic settlement cases: 14 full, 14 partial, 28 pending receipts ignored, 7 unallocated legacy single-invoice cases.
- Period test covers separate invoice/payment months, real cash vs settlement credit, cash/insurance separation, overdue/settled balances, monthly direct costs and cancelled/deleted-parent eligibility.
- Full-state comparisons cover all 143 public tables, Auth users, public sequences, migration ledger and inspected read-model definitions/ACLs after rollback.
- The read-model suite deliberately does not call payment-creation RPCs that consume nontransactional receipt sequences. It uses explicit synthetic receipt references with ordinary guards/triggers enabled.
- Public token surface: 13 functions, 26 invalid/null-token denial probes; no private fields returned and no state changes. Valid signature workflows are covered by the existing workflow tests, not claimed as newly executed by this denial probe.
- Profile authority and lookup tests cover self-escalation denial, wrong-tenant isolation, role lookup parity, private deduplication ACLs and preserved service access.
- Synthetic browser tenant has a full-settlement invoice, partial-settlement invoice and cash invoice: total 367.500, actual receipts 220.000, outstanding 132.500. Separate operating voucher 30, HR payroll 300 and fixed-rent setting 100 test monthly composition without allocating operating costs to vehicles.

## Migration handling

These six reviewed read-model migrations already existed on Development and were recovered into the current source branch:

1. `20261101082501_reports_invoice_settlement_discount_receivables.sql`
2. `20261101083908_reports_insurance_statement_settlement_discount.sql`
3. `20261101084659_reports_center_summary_settlement_discount.sql`
4. `20261101085816_monthly_vehicle_settlement_cost_release.sql`
5. `20261104043300_reports_summary_payment_period_and_receivable_parity.sql`
6. `20261104043915_monthly_vehicle_parent_eligibility_guard.sql`

Previously installed Development security migrations recovered/reviewed:

- `20261104044624_accounting_guard_null_tenant_and_supplier_permission.sql`
- `20261104045828_rls_stable_uid_scalar_initplans.sql`
- `20261104050619_profiles_select_policy_preserve_update_planning.sql`
- `20261104051402_remove_verified_redundant_workshop_indexes.sql`
- `20261104072551_document_access_active_profile_guard.sql`
- `20261104123558_profiles_rls_update_identity_without_self_recursion.sql`
- `20261104124329_expense_work_order_lookup_rls_parity_and_private_dedupe_acl.sql`
- `20261104125745_isolate_auth_signup_profile_provisioning.sql`
- `20261104130809_profiles_browser_authority_fields_guard.sql`

Applied in this task on Development only, with actual returned ledger versions (no manual ledger repair):

- `20261105082707_active_profile_identity_gate.sql`
- `20261105082709_consolidate_role_scoped_permissive_policies.sql`
- `20261105085159_restore_monthly_workshop_overheads_readmodel.sql`

`manage-users` Development Edge version 3 is active with JWT verification retained. Production Edge was not changed.

## Advisor findings: do not equate labels with verified vulnerabilities

Development performance WARN count is zero: 37 overlapping-policy WARN findings removed by the proven consolidation. The earlier guarded scalar-RLS and verified duplicate-index fixes are installed on Development, not newly applied to Production.

Remaining Development performance INFO at the inspection snapshot: 136 uncovered foreign keys, 122 unused indexes, 1 absolute Auth connection-allocation notice. Usage counters can change. These are not grounds for mass index deletion/creation on an empty/small test database; Production workload/plans are needed.

Remaining security entries:

- 7 RLS-enabled internal tables without policies: browser roles have no table privileges; intentional default deny. No fake allow/deny policy was added just to clear an INFO label. [Advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
- 13 anonymous and 93 authenticated executable security-definer notices. These include intentionally public token routes and guarded staff APIs. Invalid-token, tenant, role and inactive-profile proofs above are the actual verification scope; this is **not** a claim that every API has had a new complete valid-input E2E run. [Anonymous API warning](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated API warning](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).
- The authenticated function count increased by one when the missing monthly detail RPC was restored; its guard and ACL are verified, not silently suppressed.
- Production's leaked-password-protection notice is not changed by this task. No Production Auth configuration change was authorized here.

Remaining dependency advisories after the security upgrade are build/lint tooling: Workbox glob/minimatch, TypeScript-ESLint minimatch and Rollup deepmerge. No application input consumer was found for these paths; this is exposure classification, not a claim that upstream vulnerabilities are fixed. No incompatible major override or unpatched downgrade was forced. Raw `npm audit` remains nonzero. High/critical counts are zero in both dependency scopes.

## Final verification evidence

- Protected Development Preview: `https://temo-work-order-preview-m2hwk3dl0-alwafaoman1-cells-projects.vercel.app`.
- Application deployment: `dpl_9vhsk9y4czKF9CcFqGGyJo5LphA5`, READY, Development backend verified by a build-time guard. No Production alias was assigned.
- Full project typecheck passed. ESLint: zero errors, zero warnings. Production-mode Vite build passed on the remote 8 GB builder; no heavy local compile/OCR worker was started.
- Full Vitest: 237 files, 1,264 tests total; 1,258 passed, zero failures/failed suites, 6 opt-in tests skipped. The skipped cases are 5 OCR/representative-document runtime cases and 1 vehicle-centre SQL parity case; this task does not claim those were executed.
- All 1,440 deployed source-file hashes match the validated local snapshot. Only this verification report and its change manifest were added afterwards; no executable changes were made after the successful build.
- Actual remote audits: production-dependency scope 4 moderate/2 low, full tree 10 moderate/2 low. Both have zero high/critical. `auditClean=false`; raw audit exit is still nonzero. The successful QA gate is a high/critical gate, **not** a zero-advisory claim.
- Build notices remain visible: a startup chunk above 500 kB, PWA precache inventory, package install-script review and a hosting-provided npm cache-option warning. No warning threshold was raised or audit suppressed to conceal them.
- The first real browser run verified totals, actual XLSX (3 rows while only 1 is visible), PDF generation and payment/insurance separation. It exposed narrow test-harness issues (table heading counted as a summary, blocked public fonts, then blocked read-only permission RPC); these were corrected in the harness without opening business writes.
- The actual exported PDF is 1 A4 page, 219,218 bytes in the first run, with all 3 rows visible and no clipping/blank page on rendered inspection. This does not claim every print template/physical printer has been tested.
- Final real browser End-to-End: **PASS**, 10 checks. Exact summary cash/receivable totals; actual XLSX includes all 3 filtered rows although only 1 is visible; real one-page PDF; separate payment-date period; separate insurance/cash; injected 503 produces a visible error without stale/false-zero summary and retry recovers; Desktop/tablet/mobile views; actual monthly voucher 30 + HR 300 + rent 100 = 430; actual foreign-tenant RPC request denied. Zero unexpected page, console, HTTP or blocked-write errors. Deliberate 503/foreign-tenant rejection probes are not counted as unexpected errors.
- The final monthly positive path uses actual Development RPC + settings + browser composition. Mixed HR/overhead failure, export denial and retry are additionally covered by focused UI/service regression tests; this is distinct from a newly executed HTTP HR-outage scenario.
- Final browser runner: `dpl_7cmNnWgss1K4fQnmsCWcChabwnVJ`, protected Preview only. No business writes were allowed through the browser network guard.
- Final data check: pre-existing rows across all 143 public tables, existing Auth users and public sequences preserved. Ledger differences are limited to the explicitly applied Development migrations above; no unrelated/manual ledger repair. The synthetic tenant/evidence remains clearly labelled, and its test account was disabled with read-back confirmation after verification.
- Latest PDF: 1 A4 page, 219,409 bytes; no JavaScript, no blank page or clipped table in the rendered inspection. No physical printer or every-template claim.
- Observed pre-existing UI limitation: several monthly-report labels still rely on partial automatic translation and remain mixed Arabic/English. The new safety/error messages are explicitly translated; a complete legacy-label rewrite is not claimed by this financial/security validation.

Final Git state: no new commit, no staging/push/merge, branch `codex/finance-security-development`, HEAD remains `87facc590fc4458a51736397732e97962e60b5b2`. The scoped modifications and reviewed recovered migrations remain local for approval.

The exact changed-file list and SHA-256 hashes are recorded in `docs/finance-security-change-manifest-2026-11-05.json`; the manifest excludes itself to avoid a circular digest. Private `.vercel/` fixtures, credentials and test artifacts are not release files.

Private local evidence (ignored, not part of a future release): `final-finance-qa-evidence.json`, full test JSON/build log, `financial-development-proof.json`, `finance-rpc-denial-matrix.json`, `finance-edge-runtime.json`, policy trial/rollback results and rendered PDF/screenshots under `.vercel/`. No service key/password is published in these reports. The one-use test sign-in is encrypted locally and never part of the application build.

## Production release gate

Production remains **Not Applied**. The live report discrepancy remains until a separately authorized targeted release is applied.

Before any future release: verify a restorable backup, refresh the read-only 28-case baseline, reconcile the exact affected ledger/body/ACL definitions, and install only the reviewed required migration sequence. Preserve no-op/drift checks. Never run blanket `db push` or repair unrelated ledger rows. Deploy database/Edge prerequisites before the matching interface, then verify Production read-only and through separately authorized operational writes. Keep a reviewed reverse-definition/policy rollback plan.

This evidence is a bounded financial/security Development validation, not a certificate that every ERP workflow, physical printer, phone camera, OCR document or external provider is error-free.
