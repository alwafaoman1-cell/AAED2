# Production release — 24 November 2026

The user explicitly approved GitHub upload and Production publication after a verified fresh backup. Application commit: `4271c2f41be96a1a035fe666aeef717f15e1b53e`, on `codex/finance-security-development`. The branch remains configured to skip automatic Git deployments; this release was built and promoted explicitly. No merge into `main` was performed.

## Published scope

- Cloud-backed administrator workflow requirements setting, defaulting to **enabled**, with mandatory reasons and canonical server audit events for operational exceptions. Permissions, tenant isolation, vehicle/visit identity, duplicate prevention, one-time receipt use, prior signed records, and separate cash/insurance accounting remain protected.
- Prior vehicle visit manager controls and customer communication changes already on GitHub, including the pending manager migration.
- Work-order batch/list/detail printing no longer creates or requires a customer portal token. Existing signatures remain read-only inputs.
- English-only extraction for newly processed documents, lazy OCR initialization for native PDFs, and bounded legacy queue compatibility. Requested engine versions and finalized historical extraction records remain unchanged. Worker policy/timing metadata survives older clients' parser updates.
- The warm OCR process implementation is included in source, but remains **Development-only and disabled in Production**. Its memory suitability has not been established for the Production daemon's 2 GiB allocation. Local benchmark timings are not a Production speed guarantee.

## Fresh backup and restore verification

At 12:41 UTC a consistent, read-only snapshot was taken from Supabase project `ifnfwssdtjuzdtshnrht`; independent verification finished at 12:57 UTC, before any release DDL or deployment.

- Full native PostgreSQL custom archive: 204 tables and 26,002 rows; 51,470,012 plaintext archive bytes, encrypted with Windows current-user DPAPI.
- Independent typed row snapshot and original PostgreSQL fingerprints, schema catalogue, sequences, roles, and migration ledger.
- Actual isolated PostgreSQL 17 localhost restoration: 203 tables and **all 26,002 source rows**, with exact row counts and fingerprints; 155 business, 27 Auth, 10 Storage, 10 Realtime and one migration table. Restored 348 application functions and 453 policies.
- All 705 Storage objects, totaling 370,352,337 bytes, downloaded, independently decrypted and SHA-256 checked. These include the stored document/signature media.
- Previous Edge source/configuration preserved: `ai-extract-data` v21 and `document-worker-download` v8, including their existing JWT settings.
- The provider-managed Vault extension cannot execute on the localhost installation. Its eight extension/configuration/ACL restoration entries were excluded only from that rehearsal. The original archive retains them, and its source secrets table contained **zero rows**. Provider root keys and service configuration still require the original provider environment or separate provider recovery.
- No provider physical/PITR backup was available. This is a verified manual logical backup, not a PITR restore test. DPAPI recovery requires the original Windows user profile/keys.

Private backup gate and restoration notes are under ignored `.vercel/release-20261124/manual-backup/`. No backup, credential, Production row dump or Storage object was committed or uploaded to GitHub. The actual restoration server was stopped and its cluster removed. An earlier stopped, empty initialization cluster remains locally because automatic approval review rejected its deletion with `blocked by policy`; it contains no Production rows.

## Database and Edge release

All six migrations were first executed against the real Production schema inside a transaction that was completely rolled back. Their source drift guards passed. Application then used one atomic transaction and retained the original 258 migration records, adding exactly these six:

1. `20261117082245_vehicle_visit_manager_controls`
2. `20261123140431_workflow_requirement_policy`
3. `20261123140433_workflow_requirement_intake_gates`
4. `20261123140435_workflow_requirement_lifecycle_gates`
5. `20261123141053_workflow_requirement_claim_gates`
6. `20261124102637_document_english_only_extraction_policy`

Preexisting business/Auth/Storage row fingerprints and sequence values matched within the application transaction, excluding only four explicitly checked additive defaults: `manager_adjustment={}` and three new nullable policy/exception columns. No existing forms, signatures, receipts, financial documents or extraction results were backfilled or rewritten. New settings/audit tables were empty immediately after DDL, with the operational policy strictly enabled at revision 0.

Fresh-connection verification confirmed the schema, ledger, ordinary administrator policy read and vehicle-center RPC. Anonymous policy modification remains denied. Security advisor categories before/after were unchanged; existing advisories were not treated as newly resolved.

Edge functions were deployed and their complete sources read back exactly:

- `document-worker-download` v9; existing `verify_jwt=false` retained because the handler performs its own secret/lease/tenant validation. Anonymous GET returns its expected 403.
- `ai-extract-data` v22, including shared English policy; `verify_jwt=true` retained. Anonymous GET returns its expected 401.

## Application and daemon

Published site: https://aaed-2.vercel.app/

- Deployment: `dpl_eDMtzkZxXPVYt6ScXyTQMo524df7`.
- Promoted at 13:07 UTC after staged Production shell/assets and backend checks.
- Build input source digest: `724b161a3c0cdb9205f9df0006e6895016a31369f46d5d0d803be20b8f8ce422`.
- The deployed main bundle is `/assets/index-b8hNJ7SC.js`; it references the intended Production backend and contains no Development project reference.
- New daemon image: `sha256:331bf6a21c20b4b17f502ef888b6b6c27d0f8f587879b939d6085b7a292f44a4`; ready 1/1 in `syd1`, 2 GiB. The Linux build successfully initialized/cached the English recognizer. A polling document-worker DB connection was observed.
- Read-only observation of independent user activity after publication found a new `1.0.7-en-worker` extraction at `verified`, with protected `languagePolicy=english_only` and `workerProcessMs=37176`. No document contents/identifiers were exported into this report, and the release agent did not create or modify that business record. This single observation establishes a live successful path, not comparative accuracy or latency.

Previous rollback target: `dpl_FRFVduS1udwyTzqo7AU9vsekrnqy`; previous daemon image `sha256:82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`. Preserve the new audit/history if a subsequent rollback is required; do not restore an old full database over later legitimate work.

## Validation and limits

- Clean, isolated `npm ci` from the committed lockfile: Vite 7.3.7, Vitest 4.1.12, TypeScript 5.8.3. Typecheck, ESLint, Production build and the full frontend suite passed: **2,383 passed, 9 skipped** across 345 files.
- Three opt-in checks against previously recorded synthetic OCR artifacts passed separately, including English identifier exactness (62/62), unchanged older baseline misses and Arabic-only negative fixtures. Six distinct frontend checks remain skipped after this supplemental run; hosted Development parity/optional artifacts are not claimed as covered.
- Python worker/core tests: 87 passed. Isolated PostgreSQL/WASM checks: 31 policy/claim/order, 19 intake, 30 lifecycle, 16 extraction policy/queue — **96 passed**.
- Original installed-runtime checks also passed before the independent locked dependency run. Vite reports its existing large-chunk warning. No claim is made that a build alone proves business operations.
- Live authenticated browser checks: new settings panel in Arabic at desktop and 390 px mobile, English at 820 px tablet; no horizontal overflow, policy checked/enabled and revision 0, no console errors. Arabic and default viewport restored. Existing unrelated settings translations were not audited as fully English.
- Live selection and preview of two stored work orders rendered both documents without `PORTAL_VEHICLE_REQUIRED`; preview closed and selections cleared. No physical print job was submitted and no new portal token was issued by the printing path. PDF download on a physical iPhone was not repeated in this release.
- Seven public route shells and the deployed asset returned HTTP 200. A shell smoke test is not an authenticated lifecycle test; operational exceptions/full lifecycle were exercised in the isolated DB tests, not by changing real Production visits.
- Runtime logs include a Requests dependency warning and Paddle isolated-child termination output. The observed new extraction completed and was verified despite those messages. Warm-process capacity and a real-document comparative Production speed benchmark remain unverified.

Detailed private release evidence is in ignored `.vercel/release-20261124/`; database archive and Storage media remain local and encrypted.
