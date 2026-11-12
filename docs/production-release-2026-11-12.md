# Consolidated Production release — 2026-11-12

Scope authorized by the owner: publish all current application/source updates to GitHub and Production, including required Supabase migrations and changed services, after taking and verifying a backup. Preserve existing business data, signed forms and signatures. Private QA output, credentials and backup contents are excluded from the public GitHub repository.

## Verified pre-release gates

- Production project: `ifnfwssdtjuzdtshnrht`; Vercel project: `aaed-2`.
- Existing Production deployment retained for rollback: `dpl_6vdiasVPg7NRoyhcLckcNWxjFoKF`.
- Completed physical backup: `2236863056`, taken `2026-11-11T22:00:39.078Z`.
- Fresh encrypted logical checkpoint: 183 tables / 24,414 rows, including 84 vehicle entries, 24 intake signatures and 90 handovers. Decryption verified. All 145 business tables were restored into typed temporary tables and matched their original row-count/hash fingerprints. No full physical restore or replacement of the live database was performed.
- Initial backup-restore verification correctly stopped on numeric JSON serialization differences. The verified checkpoint preserves raw PostgreSQL JSON text and its numeric representation; no Production business row was changed to make verification pass.
- Existing OCR worker image is held at its currently running SHA-256 digest, with no source/dependency/model upgrade as part of the frontend deployment.
- Full local application suite: 1900 passed, 6 existing optional tests skipped. Typecheck, full-source ESLint and scoped integrity/whitespace checks passed.

## Database scope

Previously released migrations through `20261110051157` are already in Production and will not be reapplied. The release adds:

1. `20261112080726_bind_handover_visit_before_finalization.sql`
2. `20261112094812_vehicle_intake_custody_receipts.sql`
3. `20261112100850_vehicle_intake_receipt_evidence_hardening.sql`
4. `20261112102925_preserve_legacy_signed_intake_before_edit.sql`
5. `20261112104710_enforce_intake_evidence_tenant_boundaries.sql`
6. `20261112132108_preserve_active_legacy_unsigned_signature_links.sql`

The last migration preserves the two still-valid unsigned legacy links discovered during preflight: it binds only unchanged legacy revision 1, without changing the token, expiry or previous fields. Revoked, expired, consumed, already-signed and newer-revision links are excluded. A Development rollback test verified preservation, signing through the same link, exclusion cases and invalidation on the next material edit. No prior signature is copied or re-signed. Existing visits remain legacy; new visits require receipts.

Production DDL rehearsal passed and was fully rolled back. All 155 pre-existing business/Storage-table fingerprints stayed unchanged, discounting only newly added revision-policy columns. The 28 changed/new function bodies and owners match tested Development after newline normalization; ACLs match after ordering normalization, with one explicit preservation rule: the pre-existing handover immutability guard keeps its narrower Production ACL unchanged. No client privilege was expanded to make the comparison pass. The final source/SQL manifests and private detailed checkpoint/verification evidence remain ignored under `.vercel/release-20261112/`.

## Service and release procedure

`vehicle-entry-signature-media` receives the tested revision-bound photo service fix. `unified-message-send` source already matches the live version 20, so no provider sends, queue replay or redundant service replacement is required. Other unchanged services retain their configuration.

The application is built as a staged Production deployment with the actual Production environment and an explicit check that no local photo-service override is enabled. The build runs typecheck, lint, the full test suite with isolated test credentials and Vite build. Migrations are applied through an isolated, ledger-matched official CLI workspace, without blanket `db push`, resetting the database or executing historical repair scripts. The staged application/backend are verified before assigning the live domain.

## Completed release and independent read-back

**Published and verified on the live Production domain:** https://aaed-2.vercel.app .

- Application/source commit: `9d85ccc0c32a34104f510f6c66bbecd097568dcf`, pushed to `codex/finance-security-development` in `alwafaoman1-cell/AAED2`. It consolidates 260 changed/new files. The completion update to this report is documentation only.
- Production deployment: `dpl_iQKEMbumHumciqbfhM2tYbPvUw46` — READY and promoted. Its immutable URL is https://aaed-2-bwjui7w3s-alwafaoman1-cells-projects.vercel.app .
- Prepared-source digest: `a069bdd64b557e16dd576a56e0a76b096294ee4e899c6ccef3e1eb7a3092be6c`.
- All 1,658 exported Git blobs were checked against the commit before the bounded deployment-only configuration additions: Production build/test guards, upload inclusion rules and the unchanged OCR image pin.
- Actual cloud gates: typecheck PASS, full-source ESLint PASS, **1900 tests passed / 0 failed / 6 existing optional skips**, and Vite Production build PASS.
- All six listed migration versions were applied by the official CLI. The previous 246 migration records remain unchanged. No blanket database push, reset or manual ledger edit occurred.
- Production `vehicle-entry-signature-media` is ACTIVE at **version 6**, bundle `a06a2a4a28afd650ea3334b23678d37015dece0893d4ad1f3e7091e7a3e34b5e`. Downloaded entrypoint and handler match the tested source. Its existing `verify_jwt=false` remains, with token/tenant/visit/revision restrictions in the handler.
- Existing `unified-message-send` version 20 already matches the repository source and was retained. No WhatsApp/email message, queue replay or provider test send was performed.
- The live alias independently resolves to the new deployment. Four relevant SPA shells and the actual new JavaScript asset (`/assets/index-CRJaqA4r.js`) were fetched from the public live domain and matched the staged deployment. Root/index/service-worker no-store headers and camera Permissions-Policy remain in place.
- The real browser opened the live application, loaded that same new asset and displayed the normal staff sign-in screen without console errors. No new Production staff authentication/session was created to bypass that screen. Authenticated backend context/permissions were separately checked under an ordinary existing administrator role.
- The OCR daemon remains ready 1/1 on its exact previous image digest `82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`.

## Data preservation and concurrent workshop work

All 24 pre-existing intake signatures and all 90 pre-existing handover rows match the backup. This includes all 88 finalized handovers. The 84 entries present at checkpoint remain legacy visits, while the default/trigger enforce the receipt policy for new visits. New receipt tables retain RLS and deny direct anonymous/authenticated/service-role table access; authorized staff use the scoped RPCs.

The broad snapshot comparison correctly flagged ordinary workshop activity during preparation. Eight old-row differences across six tables were reviewed: two unsigned entry edits, two replaced damage marks for an unsigned form, one intentionally revoked/reissued signing link, two numbering advances and appended audit events. Entry/audit/revocation timestamps and replacement/report creation evidence place these actions **before migration execution started at 2026-11-12T13:52:12Z**. The previous audit events are retained. User activity was preserved, with no attempt to restore old values over current work. No signed form or signed handover was involved in those edits.

The Production photo service was exercised read-only on five actual active unsigned signing links. Every form remained readable, photos returned successfully (3/4/4/3/3 images), and an actual temporary Storage image URL returned image bytes successfully. Invalid tokens and a non-allowlisted Production loopback origin were denied. No customer signature or receipt was submitted/consumed by these checks.

Detailed private evidence: `backup-proof.json`, `rehearsal-proof.json`, `git-export-proof.json`, `build-proof.json`, `staged-http-proof.json`, `migrations-applied.json`, `database-after-proof.json`, `concurrent-activity-review.dpapi`, `database-reviewed-proof.json`, `photo-http-proof.json` and `live-release-proof.json` under ignored `.vercel/release-20261112/`. Backup contents, browser/runtime secrets, customer images and private QA output were not pushed to GitHub.

## Boundaries and recovery

- Initial staging stopped before publication because upload rules excluded the image-pin Dockerfile. A subsequent full-test gate caught archive-only CRLF conversion in three text contracts. Exporting with `core.autocrlf=false` reproduced all Git blobs exactly; the affected 58 tests and then the complete cloud suite passed. No assertion was removed, weakened or skipped to obtain publication.
- Physical-camera capture/live optical QR scanning remains a device/browser verification boundary, as documented in the preceding Development report. Actual image-file QR decoding and the receipt lifecycle were tested in Development; Production checks were read-only.
- Existing security-advisor notices remain, including intentional RPC-only table/function notices and the existing Auth password-protection advisory. This release does not claim an empty advisor report. The post-release health advisor returned no notices.
- Retained frontend rollback deployment: `dpl_6vdiasVPg7NRoyhcLckcNWxjFoKF`. Previous Edge source and database snapshots are backed up privately. A database recovery must preserve any new workshop activity after cutover; no destructive automatic database rollback was performed.
