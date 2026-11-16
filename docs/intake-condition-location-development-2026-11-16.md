# Intake condition, odometer and location — Development, 2026-11-16

This follow-up preserves the uncommitted actual-deliverer identity feature and fixes the three reported intake/receipt display issues. Development only; no commit, push or Production deployment.

## Causes and changes

- The portal displayed the review-only new-damage question for every intake and interpreted an absent field with wording about a previous form. Normal intake does not collect that comparison. The question now appears only on a linked review visit. Recorded Yes/No remain distinct from an unrecorded assessment; unknown running status uses neutral wording. Initial-intake consent refers to recorded damage, while review consent retains new damage.
- Odometer belongs to the visit's `vehicle_snapshot.mileage`. A joined master vehicle could hide that reading with an empty/missing mileage. Both document builders now resolve the saved snapshot first, then the same frozen record's review reading. Numeric/text zero is retained. Selecting a master vehicle with zero also preserves it. Unknown historical readings stay unknown; today's master reading never fills an old signed form.
- Both intake form and receipt explicitly show **Vehicle location at intake / موقع المركبة عند الدخول**: In workshop / داخل الورشة or With customer / مع العميل, from the supplied saved record. A saved bay appears only for an in-workshop record, never alongside customer custody. Missing historical fields are labelled Not recorded.
- The public signed-document RPC previously removed location/bay from its allowlist although they were present in the frozen snapshot. New migration `20261116073742_vehicle_intake_frozen_location_projection.sql` adds only those two frozen fields. It never substitutes the current entry/workflow location and leaves all identity functions, permissions and immutable evidence untouched.

## Files

- `src/pages/public/UnifiedVehicleCustomerPortal.tsx`: review-only assessment, neutral missing wording, appropriate intake consent.
- `src/lib/vehicleIntakePresentation.ts`, `vehicleEntryService.ts`, `vehicleIntakeReceipt.ts`: shared saved odometer/location resolution and bilingual document labels.
- `src/hooks/useVehicleEntryEditor.ts`: preserve zero when selecting a vehicle.
- Portal, presentation, editor and running-status print tests cover initial/review state, zero/text/blank readings, saved location, stale bay suppression, owner/signature preservation and historical gaps.
- The new migration adds the frozen public-document projection; the already-applied `20261116065641` identity migration is unchanged.

## Validation

- Full exact-lock suite: **2,137 passed, zero failed, six optional skips**, across 326 test files. Typecheck, lint and fresh build passed.
- Two test-only typing corrections were subsequently checked with final typecheck, scoped lint and **84 passing behavioral tests**. All application files remain byte-identical to the full-suite/browser snapshot. Original full-suite digest: `85ae3d0eda12fbaec82591e2a7ba0b88dc402621ddba650f3e6e7a01e4b97555`; final source digest: `20869c4ac19b7751332e3b46307149576236df8df5982800d5354b52f7dab3fa`.
- **38 WebKit checks passed**, Arabic/English, 390/834px. Actual canvas, identity readback, preview and download controls were exercised with synthetic transport and zero external browser requests.
- Two real downloaded combined PDFs, each two nonblank A4 pages, were rendered and visually inspected. Both documents show zero odometer, their saved workshop/customer location, and the same actual name/ID/signature. English body output contains no Arabic.
- Fresh Development backup: 192 tables / 2,972 rows, encrypted/decrypted/hash verified, with 154 business tables restored into typed temporary tables for verification.
- Candidate and applied-schema rollback tests sign synthetic intakes with zero/text mileage, finalize a legitimate handover to move current custody to the customer, and verify that the original signed document retains its saved workshop location, bay and reading. The original signature, form and owner remain unchanged.
- Official CLI applied only version `20261116073742` to Development `rrhyglrnlveygyiandhs`; ledger count is 319. No bulk database push or manual ledger edit.
- Independent read-only comparison retained all 2,505 original operational rows across 164 tables exactly, including existing signatures, frozen snapshots, receipts and Storage metadata. Only the intended document projection changed; prior identity functions and all existing permissions remained unchanged.

Private database receipts are in `.vercel/intake-condition-location-db-20261116/`; source/browser/PDF receipts are in `.vercel/intake-condition-location-development-20261116/`. Both are excluded from Git.

## Boundaries

The document location describes its saved intake, so later physical delivery cannot alter the signed original. Current custody continues through the existing visit/handover views. Historical blank readings/locations are not backfilled. Browser testing uses WebKit emulation and synthetic API responses; separate Development SQL tests cover persistence. Physical phones/printers were not tested. A later authorized Production release must include the application and both outstanding Nov16 migrations together.
