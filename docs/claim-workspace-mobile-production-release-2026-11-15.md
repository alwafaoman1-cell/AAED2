# Claim workspace and mobile PDF Production release — 2026-11-15

Completed under the user's explicit authorization to push and publish after a verified backup. Live application: https://aaed-2.vercel.app .

## Released source

- Application commit: `b3e103c10bdb0871cde62889083bff2409aabab8` on `codex/finance-security-development`, pushed to GitHub. The existing Production branch setting and `main` were preserved.
- Deployment: `dpl_GG1iiFqzA8xSCjQh59tJEnZUmbgj`.
- Immutable deployment: https://aaed-2-o5u8orak6-alwafaoman1-cells-projects.vercel.app .
- Deployment source digest: `428c78d7458d1492faddfcaaa862a3014f0d5f4feed2577c00504c802b340386`.
- Main asset: `/assets/index-Cb_SCSrT.js`; live bytes match the tested staged asset.
- Rollback application: `dpl_Ej2xVuMsJ7ANEeGKGrdRU3xtnXnY`. Rollback must preserve the existing portal plate gate; do not restore old database snapshots over concurrent workshop activity.

The 17-file application change reorganizes the existing claim controller into one identity/action surface, a read-only amount summary and six responsive stages; simplifies UPL/delivery actions; retains form state and existing authorization/approval/arrival/duplicate guards; blocks invoice generation after failed Save; and fixes WebKit PDF font transfer and stylesheet-readiness failures. See [Development audit and file map](claim-workspace-mobile-development-2026-11-15.md) for changed paths and behavior.

## Verified backup and preservation

- Fresh encrypted logical backup: 193 tables / 24931 rows. Decryption and plaintext hash verified; 155 business tables restored into typed temporary tables only, checked and rolled back. No original table was restored or rewritten.
- Managed physical backup `2266864931` was COMPLETED at 2026-11-14T22:00:53.440Z; no physical restore was exercised.
- All 670 Storage objects (347526660 bytes) downloaded into an encrypted private backup, decrypted and hash verified. A second offline verification checked all 673 encrypted artifacts and bound their ciphertext hashes to the release gate.
- Final read-only comparison: 165 operational tables, 24484 original rows retained exactly; 0 changed or missing originals. Signatures, frozen revisions, finalized handovers, custody receipts, damage marks, media and Storage metadata preserved.
- Schema, functions, policies, triggers and migration ledger unchanged. Production ledger remains 256 entries. This frontend release applied **zero migrations and zero Edge deployments**. Historical local/remote migration-ledger differences remain outside this release; no bulk database push or ledger repair was attempted.
- Signing-media service remains ACTIVE v7 with unchanged source, bundle and verification settings. OCR remains ready 1/1 on the same pinned Production image.

Backup files, browser fixtures and verification traces remain private in `.vercel/claim-workspace-production-release-20261115/`, excluded from Git and deployment.

## Validation and live checks

- Fresh exact-lockfile local validation: 2,021 tests passed, zero failed, six optional skips; typecheck and lint passed. Every QA runtime/test file matches the Git export exactly or by CRLF-to-LF conversion only.
- Actual Production cloud build repeated typecheck, lint, the full 2,021-test suite and Vite/PWA build successfully. No dependency or lockfile change.
- Earlier actual-page synthetic browser validation: 444 checks / 98 layouts, Arabic and English, phone/tablet/desktop, Chrome and WebKit. No external business requests.
- Staged compiled-code browser/PDF checks: **20 passed**; live WebKit checks: **23 passed**, zero errors. All 128 executed live assets match staged SHA256 hashes. Authentication/REST inputs are synthetic and business requests are never forwarded.
- Both live repair-estimate downloads (Lump Sum and UPL) are one nonblank A4 page. Noto/Inter were loaded during actual rendering; embedded PDF image streams match the inspected staged PDFs byte-for-byte. Private receipts: `live-browser-proof.json`, `live-pdf-artifact-proof.json` and `live-rendered-image-comparison.json`.
- Seven staged/live SPA routes, no-store entry points, camera policy, Production Supabase reference, exact staged/live main-asset bytes, live alias and preserved OCR image verified.
- No real signature, delivery, claim, invoice, payment, customer message or operational record created or changed for validation.

## Limits

WebKit/Chromium engine tests do not constitute testing on a physical iPhone/iPad or printer. The compiled-code harness supplies synthetic authentication/REST responses and blocks business networking; it does not claim a real cloud Save or delivery. Existing archived forms/signatures were preserved. Existing PDF template content/translation rules were not redesigned. Older shared controls and the existing visited PaymentsSection paid-status effect retain the limitations recorded in the Development audit. Native WebKit CSS font-cache ownership remains browser managed.

This report is a documentation-only follow-up to the application commit above; it does not change deployed application bytes.
