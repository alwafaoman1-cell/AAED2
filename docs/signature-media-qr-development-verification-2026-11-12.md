# Signature media, QR and custody cycle — Development verification

Date: 2026-11-12. Scope: local application at `http://127.0.0.1:5194`, connected exclusively to Development `rrhyglrnlveygyiandhs`. No Production access/change, commit, push, deployment, migration or remote configuration change.

## Diagnosis and implemented fix

The deployed Development function `vehicle-entry-signature-media` exists and is ACTIVE at version 5. Its actual OPTIONS response to origin `http://127.0.0.1:5194` returns `Access-Control-Allow-Origin: https://aaed-2.vercel.app`. This is a CORS mismatch, not a missing service. The deployed source also does not bind entry-photo access to `intake_revision`.

The handler now allows HTTP loopback origins only when its configured Supabase URL is the exact Development project. Other origins must be explicitly allowlisted; disallowed origins receive 403. Existing explicitly allowed origins are retained. Preflight headers cover the current client headers. Token, tenant, visit, path, image MIME type and 15-minute Storage signing restrictions remain. Normal entry links must match the current intake revision, including a final revision check after URL signing. Inspection-release links retain their separate hashed-token and photo-ID scope. Oversized bodies are checked even without Content-Length. Storage signing failures are distinguished from a visit without photos; valid photos remain visible during partial failure.

The Edge entrypoint and the local runner execute the same extracted handler. To honor the no-deployment instruction, the corrected handler runs on loopback `127.0.0.1:5196`, using Development server credentials only in process memory. They are never embedded in the browser or written to source. The explicit local client override additionally requires the exact Development project, a loopback page and a fixed loopback endpoint. It sends the signing-link token only, without forwarding the staff session. Ordinary builds without that explicit flag keep the normal Edge invocation.

**The hosted Development function remains version 5. Its CORS/revision fixes have not been deployed.** This report proves the corrected local handler against real Development data, not a hosted-function release. Reference for the preflight requirement: https://supabase.com/docs/guides/functions/cors .

## QR and camera changes

- Added QR image decoding using the actual `html5-qrcode` decoder, retaining camera and manual number/link entry.
- Decoding never authorizes delivery by itself. The server must verify the receipt for the same visit.
- Reference edits invalidate pending verification responses, preventing stale approval from being restored asynchronously.
- Camera import/start errors are handled. A pending camera request times out after 15 seconds and restores the manual/image alternatives. Late camera starts are stopped; scanner teardown handles stop failures.
- Added English translations for new labels and partial-photo warnings.

## Actual Development exercise

A new fictional insurance visit was created; previous visits were not reused or edited:

| Item | Value |
| --- | --- |
| Entry | `TEST-bdf2f306d0` / `dec60f21-f126-4ee7-83fa-713f98712cd6` |
| Work order | `WO-I-26-0007` |
| Claim | `TEST-RECEIPT-bc6ef15` |
| Receipt | `VIR-TEST-bdf2f306d0-R2` |
| Final handover | `VH-2026-00005` |

A synthetic PNG color card was uploaded to Development Storage under this visit. The local signing-photo service returned one signed URL; downloading that URL reproduced the uploaded SHA-256 exactly (`c8116456a0e9b6176eba30027484d38e4d407dc3af176f59b19c2e8584a67a0d`). The image rendered in the actual public signing page. A clearly fictional signature was drawn in that page and saved as `TEST Media QR Signer — Development only`; receipt issuance occurred automatically.

A QR PNG was generated from the issued receipt's actual verification URL. The real UI decoded that file, displayed the reference and verified the correct vehicle/holder through the server. The same QR was decoded and verified again inside the delivery form. Through the local UI, the claim was approved for one test OMR, work was started, the work order was completed and the handover finalized. The actual recipient `TEST QR Actual Recipient — Development only` differs from the intake signer and both are retained. Workflow reached delivered/revision 4; receipt became used with exactly one use audit event. Reuse was rejected in the UI and server. Repeating finalization returned the same finalized record. No cash or insurance invoice, payment or customer message was created/sent. No actual repair or physical delivery occurred.

A separate unsigned fictional visit tested stale-link access: after a material revision, the old photo link returned 404, while its current link correctly returned an empty photo list without an unavailable error. A non-QR image was rejected by the real decoder with a recoverable message.

## Camera verification boundary

The real Scan QR button was exercised in the in-app browser. No camera video became available; the request remained pending. The corrected UI exited after 15 seconds with a camera-permission/alternative-entry message, and manual/image controls remained usable. This is a confirmed timeout/fallback test, **not proof of physical-camera capture or live optical QR scanning**. Those still require a browser/device that supplies camera access. Automated tests cover decoded-frame handling, stopping/clearing the scanner and camera-start rejection. No camera permission or browser security setting was changed.

## Preservation and checks

Before creating the test visit, an encrypted Development checkpoint was restored into typed temporary tables for all 15 tables: `.vercel/intake-receipt-before-media-qr-camera.dpapi`, 2,114,918 bytes. The final comparison confirmed every pre-existing row unchanged across the 14 non-settings tables, including 37 entries, 3 signatures, 3 signed revisions, 16 handovers, 64 work orders and 33 claims. Existing settings and audit events were preserved; only legitimate new test audit events were appended. Migration ledger is unchanged.

- Full suite: **305 files passed, 3 skipped; 1900 tests passed, 6 skipped**. Final command: `vitest run --maxWorkers=2`.
- Typecheck passed; scoped ESLint passed; fresh Development-targeted Vite build passed; tracked-file whitespace check passed. Existing bundle-size warning remains.
- Live Storage byte comparison, valid/empty/stale photo responses, real QR image decode, invalid-image rejection, receipt verification/finalization/reuse denial passed.
- Database regression passed with all test writes rolled back and before/after fingerprints equal: versioning, legacy exception permissions/reason, signatures/snapshots, cross-tenant guards, idempotency, atomic consumption and late-failure rollback.
- Initial broad run exposed source-contract paths needing adjustment after extracting the handler, two missing dictionary entries and six list UI timeouts under concurrent full build/test load. Corrected contracts/translations passed; all tests subsequently passed in the final bounded-worker full run. No tests were removed or skipped to obtain that result.

Proofs/logs are local ignored artifacts: `.vercel/intake-media-live-proof.json`, `.vercel/intake-media-stale-proof.json`, `.vercel/intake-media-qr-cycle-preservation-proof.json`, `.vercel/intake-media-qr-full-suite-final.log`, `.vercel/intake-media-qr-db-regression.log`, `.vercel/intake-media-qr-typecheck-complete.log`, `.vercel/intake-media-qr-lint-complete.log`, `.vercel/intake-media-qr-build-final.log`.

## Files changed in this task

- `supabase/functions/vehicle-entry-signature-media/index.ts`, new `handler.ts`.
- New `scripts/serve-signature-media-development.mjs` and `src/lib/vehicleSignatureMedia.ts`.
- `src/pages/public/VehicleEntrySignPage.tsx`, `VehicleInspectionReleaseSignPage.tsx`.
- `src/components/vehicle-entry/VehicleIntakeReceiptCheck.tsx`.
- `src/i18n/autoDictionary.ts`.
- New handler/client tests, expanded `vehicle-intake-receipt-check.test.tsx`, updated `vehicle-entry-contract.test.ts` and `vehicle-inspection-release-contract.test.ts` to follow the extracted handler/client boundary.
- This report and the preceding implementation report's verification boundary.
- Ignored `.vercel` launch/build/test fixtures and synthetic output PNGs. Existing unrelated working-tree changes are preserved.
