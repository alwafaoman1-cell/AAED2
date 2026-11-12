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

Post-release evidence and final deployment/commit identifiers are recorded after actual completion. This preparation record alone is not proof of publication.
