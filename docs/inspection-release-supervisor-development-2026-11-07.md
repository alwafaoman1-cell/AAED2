# Inspection and temporary release — supervisor workflow

Subsequent approved rollout: the tested feature was selectively published and verified on Production. See [the dated Production execution report](owner-confirmed-identity-and-visit-release-2026-11-07.md). The Development-only statements below record this earlier validation stage.

Scope: Development only (`rrhyglrnlveygyiandhs`). No Production deployment, migration, historical rewrite, commit or push.

## Changes

- Replaced the fourteen-field manual-first report with explicit inspection, pending-action and exit-condition choices. Additional findings and notes are expandable and optional; existing free text is retained.
- Prefilled the named recipient from the **visit's saved customer snapshot**, not a reassigned registry owner. Identity/contact can be edited explicitly. No negative findings are preselected.
- Save uses the existing RPC, then tenant-scoped readback of the exact report and field values. A nominal acknowledgement alone is not success.
- Save-and-prepare works with the newly returned report identity. Failed save cannot prepare a link; failed link does not disguise a successfully saved draft as full success.
- Public signature capability is verified against the actual existing `signed` contract, not a fabricated public `status` field. Link expiry and changed recipient/report prevent stale message sending.
- Integrated the existing supervisor message center: reviewed, manual sending with canonical customer/vehicle/work-order references and stable per-report revision identity. Opening an external WhatsApp draft is labelled **not proof of sending**.
- Completed signed report links remain read-only; the existing customer-signature and actual-return procedures are preserved. Preparing a link is not physical release, final delivery, a new visit or a financial transaction.
- Known choices translate in the form, public customer view and print template; historical custom text remains unchanged. Mobile primary action wraps; busy operations block dismissing the supervisor/center workspace.

## Application files (selective overlay)

1. `src/components/vehicle-entry/InspectionReleaseChoiceField.tsx`
2. `src/components/vehicle-entry/VehicleVisitLocationPanel.tsx`
3. `src/pages/vehicle-entry/VehicleInspectionReleasePage.tsx`
4. `src/pages/public/VehicleInspectionReleaseSignPage.tsx`
5. `src/pages/apps/SupervisorEntryWorkspace.tsx`
6. `src/components/supervisor/SupervisorVisitMessages.tsx`
7. `src/lib/inspectionReleaseOptions.ts`
8. `src/lib/i18n/inspectionRelease.ts`
9. `src/lib/i18n/vehicleVisitMessages.ts`
10. `src/lib/vehicleInspectionRelease.ts`
11. `src/lib/messaging/vehicleVisitMessages.ts`

Tests: `inspection-release-options.test.tsx`, `inspection-release-save-confirmation.test.ts`, `inspection-release-supervisor-save.test.tsx`, `vehicle-visit-messages.test.ts`.

The frozen bundle is based on the previously verified vehicle-visit workspace Preview, with only the above fifteen application/test overlays. Older unrelated finance/security/worker/Edge-function changes in the dirty checkout are not included.

## Verification evidence

- Targeted tests: 49 passed, 0 failed.
- Targeted lint: passed.
- Actual Development authenticated-supervisor SQL rehearsal: save twice reuses one report; public link reads the real report; unknown tenant and anonymous saving denied. Rehearsal rolled back.
- Full remote gates and actual browser workflow results: see final verification entry below.

## Boundaries

- No real customer message is sent during automated checks. Provider failure is tested explicitly; the actual Development message pipeline is exercised with `dry_run` and must not be reported as delivery.
- Device viewports are automated browser emulations, not a physical iPad/camera/printer test.
- No change to signature requirements, financial posting, invoice numbering or historical custody policy.
- Test records are synthetic and isolated; no Production records are copied.

## Final verification

- Exact final Preview: https://temo-work-order-preview-6xsb3aj9w-alwafaoman1-cells-projects.vercel.app/supervisor
- Deployment: `dpl_6GyvXQSrzztjwwPjCDxeajFRCfjS`, Preview/Development only.
- Full remote typecheck, lint and production-mode build: passed. Full regression: **1,722 tests; 1,716 passed; 0 failed; 6 conditional skips**. Existing dependency/build chunk-size notices remain; this is not a claim that the whole repository has zero warnings.
- Actual supervisor workflow on the preceding functionally identical candidate: controlled failed save created no row/link; successful retry created exactly one report; public capability verified; message review enforced; provider rejection shown explicitly; actual Development dry-run logged; anonymous signature synchronized temporary custody; read-only link preserved signed report; actual return synchronized the original visit. No final delivery, invoice, expense or payment was created.
- The first browser harness marked its final aggregate assertion failed because it counted the **deliberately injected save HTTP 400 console entry** as unexpected. The raw failure was retained, not rewritten. All ten operational checks completed. `.vercel/release-options-operational-evidence.json` records that precise expected failure separately; there were no other HTTP/console/page errors or blocked requests.
- Exact final Preview browser recheck: **PASS**, 0 HTTP/console/page errors, 0 blocked requests, **0 browsing writes**. Saved choices, real dry-run history and actual print-template preview verified. English/LTR and Arabic/RTL at desktop/tablet/mobile widths: no horizontal overflow. This final candidate adds only primary-button wrapping and the return-dialog accessibility description to the already exercised workflow.
- Data fingerprint verification: **PASS**. All non-fixture Development rows, Auth users, public sequences and migration history unchanged. One report, one entry, one existing cash work order; vehicle registry customer unchanged; zero financial rows in the fixture.
- All automated browser sessions revoked. The isolated synthetic supervisor account is disabled after verification; test evidence retained, not deleted.
- The fifteen source/test overlay hashes match the frozen final bundle. No Git commit/push, Production deployment or database migration was performed.

Local ignored evidence: `.vercel/release-options-qa-manifest-20261107.json`, `.vercel/release-options-cloud-final.log`, `.vercel/release-options-tests.json`, `.vercel/visit-workspace-browser-release-20261107.json`, `.vercel/visit-workspace-browser-release-review-20261107.json`, `.vercel/release-options-operational-evidence.json`, `.vercel/release-options-data-verification.json`, and `.vercel/visit-workspace-images/release-review-*.png`.
