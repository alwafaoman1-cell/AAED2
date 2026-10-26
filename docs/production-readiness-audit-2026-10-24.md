# Production readiness audit — 2026-10-24

Scope: read-only inspection of Production Supabase `ifnfwssdtjuzdtshnrht`, comparison with Development `rrhyglrnlveygyiandhs` and repository migrations, plus targeted local regression tests. No Production write, SQL migration, history repair, commit, push, or deploy was performed by this audit.

## Current deployment and validation

- The `aaed-2.vercel.app` alias resolves to a READY Production deployment at commit `3acd15ff0103cf44c0e3dd72fbf1685aabe7e0c0`.
- Targeted confirmed-save/security tests: 5 files, 17/17 tests passed. Full suite: 161 files and 792 tests passed; 3 files/5 tests skipped (private document-runtime samples).
- TypeScript typecheck and Vite/PWA build passed. ESLint finished with 0 errors and 123 warnings; it is not a zero-warning build. The build reported mixed static/dynamic imports and several large chunks.
- A browser-to-Production cloud-save write and read-after-reopen remains untested. The user must nominate a safe nonfinancial record, or perform the save personally; a read-only audit cannot prove this path.

## Migration history

| Item | Count |
| --- | ---: |
| Repository migration SQL files | 262 |
| Production history entries | 194 |
| Development history entries | 228 |
| Repository files absent from Production by exact version | 84 |
| Of those, present in Production under a different version but same migration name | 16 |
| Repository files absent from Production by both version and name | 68 |
| Production migration names absent from Development history | 13 |
| Development migration names absent from Production history | 47 |

The 16 renumbered migrations include the October document/vehicle-entry and confirmed-save releases. A matching name is an identification clue, not proof of equal SQL text or side effects. The 68 older unmatched files include superseded work-order numbering and invoice-number migrations, accounting/reporting foundations and later patches. The 2026-10-13 drift audit inspected its then-current 69 unmatched files; it is historical evidence, not authorization to repair today's ledger. Never replay a renumbering or invoice-number migration based on history alone. Comprehensive `supabase db push` and blanket `migration repair` remain unsafe.

Current catalog spot-checks confirm two unresolved integrity/compatibility gaps from the older audit:

1. The public tracking/signing functions still resolve `customer_portal_tokens.token`, not legacy `job_orders.tracking_token`. All 185 non-deleted work orders have a legacy tracking token different from their current portal token. This is a compatibility risk for previously issued legacy links, not proof that all 185 links were shared. Do not replay the old function-renaming migration as a fix.
2. `insurance_invoices` has a tenant-scoped admin/manager DELETE policy but no DELETE guard trigger. `claim_payments.offset_against_invoice_id` has no foreign key. Production currently has 58 payment references to an insurance invoice and zero orphan references. The active `useDeleteInsuranceInvoice` client hook hard-deletes by ID and reports success without checking whether a row was deleted. Deleting a linked invoice could orphan a payment reference. A forward-only, tested deletion policy/guard is needed; do not delete payments to silence the issue.

These spot-checks do not prove equivalence for each of the remaining historical files. Each history-only candidate still needs definition, grant, trigger, policy and data-effect evidence before a repair.

## Supabase Security Advisor

Current Production findings: 8 `rls_enabled_no_policy` (INFO), 13 anonymous-callable SECURITY DEFINER functions (WARN), 91 authenticated-callable SECURITY DEFINER functions (WARN), 1 leaked-password-protection setting (WARN). These are advisory counts, not 113 confirmed vulnerabilities.

- The eight no-policy tables have RLS enabled; seven also have no anonymous/authenticated SELECT grant. `message_idempotency_keys` has a SELECT grant but still no RLS policy, so ordinary roles have no row access through RLS. These are internal fail-closed tables, not a reason to add broad policies.
- The 13 anonymous SECURITY DEFINER functions are public invoice/tracking/signature/feedback flows or tenant-hostname resolution. They need bearer-token and abuse-limit review, not blanket revocation that breaks customer links. `log_public_tracking_open` accepts an arbitrary nonempty short code and inserts a log row; this is a concrete abuse/spam surface to harden separately.
- The 91 authenticated functions include privileged RPCs. A first static pass found 27 without an inline auth expression; many delegate to guarded functions (e.g. document review and reports), so a line-count or regex result must not be called an access bypass. The reviewed numbering activation and staging-tenant attachment functions have explicit privileged-role checks.
- Password leak protection is an Auth configuration decision; enable it after evaluating sign-up/reset behavior. It is not fixed by a database migration.
- The reviewed duplicate permissive SELECT/ALL policies contain tenant predicates, a platform-admin exception, or `false`; this limited check found no cross-tenant SELECT bypass. It is not a substitute for an authenticated multi-tenant runtime test.

Remediation references: [RLS no policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated SECURITY DEFINER](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [leaked password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Supabase Performance Advisor

Current Production findings: 133 unindexed foreign keys (INFO), 55 RLS initplan warnings, 104 unused indexes (INFO), 37 multiple permissive policies, 2 duplicate indexes and 1 Auth connection allocation advisory. Do not create or drop indexes from counts alone.

The two duplicate-index pairs were verified identical in `pg_indexes`:

| Table | Used index (`idx_scan`) | Duplicate (`idx_scan`) |
| --- | --- | --- |
| `accounting_journal_lines` | `accounting_journal_lines_report_account_idx` (4) | `accounting_journal_lines_account_idx` (0) |
| `job_orders` | `idx_job_orders_tenant_active_created` (916) | `idx_job_orders_tenant_not_deleted` (0) |

Both duplicate indexes are small (112 kB and 16 kB respectively). Removal is a low-priority performance cleanup, not an emergency. The largest advisor-flagged table has roughly 1,533 estimated rows; the `expenses` and `job_orders` estimates are roughly 384 and 228, so the 133 foreign-key advisories do not alone explain current application latency. First test an exact forward migration on Development and verify dependent queries/plans; a zero `idx_scan` since statistics reset is not proof an index will never be used. Prioritize high-frequency RLS-policy optimization by measured query cost and confirm tenant semantics before altering policies.

## Gate before declaring 100% readiness

1. Perform one limited Production UI save on a user-nominated nonfinancial record; verify database acknowledgement and persistence after reload/reopen, with a reversible change and audit trail.
2. Preserve the migration ledger as-is until every candidate is classified and a safe future-migration workflow is agreed. Do not use `db push` globally.
3. Resolve the confirmed insurance-invoice deletion integrity risk with a forward-only Development-tested guard before Production approval. Review public log insertion abuse and Auth password protection separately.
4. Repeat Security Advisor and relevant runtime tests after any approved change; do not call the project zero-warning while 123 ESLint warnings and the listed database advisories remain.
