# Production cutover: finance, security and entry-linked inspection

User authorization: deploy all validated pending updates to the live website, 2026-11-05.

## Release preparation

- Preserve the deployed intake/wizard base `87facc590fc4458a51736397732e97962e60b5b2`; do not rebuild from the older `origin/main` snapshot.
- Include both previously validated scopes: finance/security (64 manifested files) and the entry-linked inspection feature. No ignored credentials, test tenants, output folders or private checkpoints are release inputs.
- Use the current `codex/finance-security-development` branch. Do not merge or overwrite `main`.
- Refresh the complete validation: typecheck, zero-error/zero-warning lint, full tests and Production-mode build on the remote 8 GB builder. Latest test run: 1,278 total, 1,272 passed, zero failures, six existing optional skips.

## Backup and reversal evidence

- Supabase physical backup `2167630934`, completed `2026-11-04T21:56:56.570Z`, was confirmed fresh at preflight. No paid restore project or new full-access Storage credential was created.
- A fresh DPAPI-encrypted checkpoint contains the original function/view definitions, owners/ACLs, policies, triggers, indexes, ledger and hashes of operational/Auth/sequence state. Decryption and hash round-trip passed. No Production row payloads were copied to Development.
- The complete 20-component cutover was rehearsed against the actual Production definitions inside a rolled-back transaction. All drift/catalogue checks passed; no operational rows changed.
- Selective reverse definitions were generated and actually executed on Development inside rollback: 14 existing functions, three views and policies on 59 tables restored. Development schema and row fingerprints were unchanged after rollback.
- This is scoped definition-restoration evidence; a full physical restore was not exercised and is not claimed.

## Atomic migration scope

`production_finance_security_inspection_cutover` contains the reviewed 20 components, with each source path and SHA-256 embedded. Transaction ownership belongs to the migration runner; there are no internal `BEGIN/COMMIT` boundaries.

Production-specific counterparts preserve the reviewed Development semantics and real catalogue drift guards:

- Production acknowledgment rather than the Development-only acknowledgment for scalar-RLS/profile/index work.
- Identical document guard without the original file's internal transaction boundary.
- Signup-trigger fingerprint normalizes only CRLF to LF; the expected reviewed hash and trigger binding remain required. Production's normalized baseline exactly matched Development's old baseline. No checksum was replaced to conceal semantic drift.

The old Development migration files and old remote migration history are not rewritten. Production records the atomic cutover bundle; blanket `db push` remains prohibited until the broader historical ledger difference is independently reconciled.

## Expected outcome and safety boundaries

- All 96 active insurance invoices were inspected: 28 read-model balance differences totaling OMR 3,773.818 before; zero after the rehearsed cutover. Actual collected amounts and stored historical payment/discount data are unchanged.
- Active-profile and tenant/permission gates, confirmed financial reads/exports, signup/activation handling and the existing-permission RLS optimizations remain paired with the tested frontend and `manage-users` Edge function.
- The entry inspection action saves to the existing report table/DR allocator and links the report UUID to the same claim and visit. No historical auto-linking, backfill, invoice renumbering, classification repair or accounting posting is part of this cutover.
- Database prerequisites and paired `manage-users` code must be ready before frontend promotion.
- Rebuild with Production environment variables; never promote a Development-backed Preview artifact.
- Preserve the existing independent OCR daemon. Check readiness/queue before and after promotion; do not create OCR fixtures on Production.
- Production browser smoke must default-deny business mutations before first navigation, including legacy accounting reconciliation and PDF autosave attempts. Authentication creates a normal session, not a promise of zero Auth session writes.

## Residual disclosures

Intentional security-definer/internal-RLS notices and build-tool dependency advisories are not suppressed. The earlier Development reports describe the tested boundaries; this release does not certify every printer, physical camera, OCR document or external provider error-free. The OCR daemon's existing 180-second shutdown grace versus a 270-second OCR timeout is not changed by this release.

## Completed Production rollout

- Production URL: https://aaed-2.vercel.app
- Application commit: `767ead0fdf7bcdbcb816a608cacb6a32177247ea` (includes the complete pending changes from `a44f0f8`). Pushed to `origin/codex/finance-security-development`.
- Production deployment: `dpl_4schu5osFqb1viTsLE2kuyQGRcfC`, READY; promoted from the staged Production build to the actual site. Staged URL: https://aaed-2-jkk8i6zhr-alwafaoman1-cells-projects.vercel.app
- Installed atomic migration: `20261105111622_production_finance_security_inspection_cutover.sql`. Local filename matches the actual returned Production ledger version; no ledger row was edited manually. Its 20 component definitions and complete ledger SQL were compared with the rehearsed candidate.
- Paired `manage-users`: Production version 19, ACTIVE, JWT verification retained. The previous version's source was preserved privately for rollback.
- Post-install read-only proof: all 145 operational table fingerprints and public/private sequences unchanged; all 96 active insurance invoices inspected, 28 discrepancies → zero; actual cash collection unchanged. Monetary source totals remain in private local evidence, not this source-control report. No historical financial rows, invoice numbers or classifications were repaired or rewritten.
- Actual Production assets verified: the Supabase client uses `ifnfwssdtjuzdtshnrht`, not Development; only the public application key is in the client; the inspection update is present on the actual site's compiled page.
- Independent Production OCR daemon: ready, desired/ready/alive 1/1/1 in `syd1`, 2,048 MiB, associated with the new deployment. No local computer is required. This proves process readiness, not a new customer-document OCR accuracy/throughput test.
- Final full validation: typecheck PASS, lint zero errors/warnings, 1,279 tests total / 1,273 passed / zero failed / six existing optional skips, Production-mode build PASS. A regression test covers SQL separators between all 20 components.
- Actual signed-in Production browser smoke: eight routes returned 200 with visible page headings—vehicle center, work orders, insurance, cash invoices, reports center, monthly profitability, expenses and settings. Existing active-admin login and paired Edge read succeeded. The real entry-linked inspection form loaded its protected identity fields without saving. No page errors, console errors or failed backend responses were observed in the successful run.
- Browser verification default-denied business mutations before navigation. An attempted background POST was deliberately blocked and recorded; it was not allowed merely to make the test pass. No Production save/upload/print-autosave or posting fixture was created. Realtime WebSockets were blocked by the test and are not claimed as newly exercised. Authentication established a normal session for the existing authorized administrator; no email was sent, no password changed and no user created.
- The automatically triggered duplicate Git Preview deployment was cancelled. It was not promoted over the Production deployment.

### Transparent cutover incident

The first combined-file application was rejected at SQL parse time: one component lacked a terminal statement separator that was optional when run individually. No database migration or operational write committed. The briefly updated paired Edge function was restored immediately to its saved source while this was corrected. Explicit separators were added, a regression test introduced, and the **final combined SQL was executed as one statement batch in a new Production rollback rehearsal** before the successful application. The scoped reverse-definition restoration proof also passed again. The failed attempt is not represented as a successful verification.

### Remaining boundaries

- `main` remains unchanged by instruction. Future releases must use the validated release branch/commit until an explicit merge is approved; deploying the older main snapshot would discard frontend improvements.
- The broader historical migration-ledger difference is not repaired by this release. Do not run blanket database pushes; the installed atomic bundle explicitly records the reviewed components.
- Security/performance notices are not zero: remaining intentional authenticated/public definer endpoints and internal-RLS information remain documented; the profile SELECT initplan exception is deliberately retained for safe UPDATE policy behaviour. Leaked-password protection and build-tool advisories were not silently reconfigured or suppressed.
- No full physical restore, fresh Production OCR document, physical phone camera/printer flow or every possible business workflow is claimed as newly tested.
