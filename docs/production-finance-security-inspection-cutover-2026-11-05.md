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

Actual deployment identifiers and final Production verification are appended after cutover.
