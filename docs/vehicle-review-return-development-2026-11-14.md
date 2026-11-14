# Delivered vehicle review returns — Development

Implemented a separate review arrival linked to the previous finalized handover. The previous visit, used receipt, signed intake revisions and finalized handover remain unchanged.

## Behavior

- Delivered visit cards and the visit control panel offer **Return for review** to the existing intake staff roles.
- Physical arrival confirmation, current delivering person's name, return reason and arrival condition are required. Customer notes are optional.
- The database validates tenant, active staff account, finalized signed delivery, vehicle identity and latest delivery. Creation uses the canonical atomic intake function.
- The same request ID returns the same entry. A different request against a source with an active review visit opens the existing review rather than creating a duplicate. The UI explicitly says existing details were not changed.
- The new entry uses the same vehicle/customer, with no copied signatures, damage map, claim, order, invoices or previous contents. Insurance/cash channel context is retained without transferring accounting records.
- Immutable review metadata records the source visit/handover and arrival facts. Direct relation-table access is revoked and forged/replaced entry metadata is rejected.
- A fresh signature issues a fresh receipt. Review reason, condition and notes appear in the visit, receipt and intake print; the public signing page includes the return reason.
- Used receipt documents show a separate confirmation from that receipt's own finalized handover, including actual recipient, delivering employee, delivery/finalization times and recipient signature (or explicit paper confirmation). The frozen original intake is unchanged.

## Files

- `supabase/migrations/20261114075025_vehicle_review_return_and_receipt_delivery_confirmation.sql`
- `src/components/vehicle-entry/VehicleReviewReturnAction.tsx`
- `src/components/vehicle-entry/VehicleCenterRowActions.tsx`
- `src/pages/vehicle-entry/VehicleVisitControlPanel.tsx`
- `src/pages/public/VehicleEntrySignPage.tsx`
- `src/lib/vehicleEntryService.ts`
- `src/lib/vehicleIntakeReceipt.ts`
- `src/test/vehicle-intake-receipt.test.ts`
- `src/test/vehicle-review-return-action.test.tsx`

## Verification

Development project only: `rrhyglrnlveygyiandhs`. Migration applied there only. No Production changes, commit, push or deployment for this feature.

Before DDL, an encrypted Development checkpoint was restored into typed temporary tables for 15 tables. Decrypted JSON SHA-256: `cf6893dcd774fba2d5a9284eabfbdaf475d1685dfcfefd7727868ec9e3fba853`. Encrypted file SHA-256: `fba3214499776554c02665bbc3df66d561c6169a6c3255cb39a4063a561231db`. Private checkpoint and credentials stay outside version control.

The existing receipt database regression passed both in rehearsal and after applying the Development migration, with rolled-back fixtures and identical before/after fingerprints. The new return regression passed both in rehearsal and against the applied schema, rolling back its fictional fixtures. It verified retry idempotency, one active review child, required arrival, immutable context, denied direct relation reads, no inherited signature/financial links, fresh signing/receipt and original used-receipt delivery confirmation.

The browser created fictional Development visit **ENT-2026-0008**, linked to fictional handover **VH-2026-00005**, and verified the saved reason/condition/notes and workshop presence. A new test signature issued **VIR-ENT-2026-0008-R1**. It remains an arrived review visit for inspection, without creating a new claim or billing transaction. Signature is synthetic and test-only, not a real customer's acceptance.

All pre-existing signed revisions, signatures and handovers were compared against the fresh checkpoint after the new visit/signature: unchanged.

Actual receipt PDFs were downloaded through the app and rendered with Poppler. The review receipt and the previous used receipt with delivery confirmation each fit one A4 page. Both original and delivery signatures remain visible. Fixed an export stylesheet override which had enlarged signature images and split the delivery confirmation.

Targeted tests passed: 5 receipt tests plus 2 return action tests, including uncertain-save retry with the same request ID and rejecting mismatched read-back. Translation/list regression rerun passed 35 tests. Project TypeScript build (`tsc -b`), full source ESLint (`eslint src`), diff whitespace checks and local Development build passed. Full-suite parallel attempts encountered UI timing failures under concurrent build load. The final complete run with `vitest run --maxWorkers=1` passed: **306 files, 1903 tests**, with **3 files / 6 optional tests skipped**. Exit code 0. This final run includes the two new review-action tests and updated receipt tests.

## Scope limits

The review arrival does not automatically approve insurance work or select who pays for review work. Existing approval and accounting flows still apply. Production release requires a separate release step and fresh verified Production backup.
