# Full regression and persisted Development vehicle cycle — 2026-11-12

Scope: rerun the complete local suite after the handover-link repair and independently exercise the actual authenticated local UI against Development `rrhyglrnlveygyiandhs`, from pending insurance approval to final handover. No Production project was queried or mutated. No commit, push, remote change, web deployment or new schema migration was performed in this follow-up.

## Real persisted cycle

A new, explicitly fictional fixture was used so the original signed final receipt did not need to be cancelled, reset or reused:

- Visit `ENT-2026-0007` / `806983b9-2b5c-421b-96c7-1f0879d4d452`.
- Order `WO-I-26-0005` / `c502f302-adcf-48d8-9899-e9265bd79dd0`.
- Claim `TEST-CYCLE-20261112-ce5d7e` / `39b71a12-fb8f-490d-a4a6-8c21e2940f6a`.
- Synthetic Full Cycle Test vehicle, plate `QA 915643`, fictional customer without email or telephone.
- Development test tenant `00000000-0000-4000-8000-000000005741`, existing enabled manager. Approval amount **1 OMR** is test data, not a real insurance approval.
- The fixture deliberately reproduced the original one-way association: entry points to order/claim, their entry backlinks initially null. The normal intake function was used; the missing backlinks were part of the explicit initial synthetic fixture, not an alteration to signed data.

Every action below was saved through the application's existing authenticated UI. Each stage was independently queried on a separate administrative read-only connection after the browser request completed; the page was reloaded before the next action.

| Step | Confirmed persisted result |
|---|---|
| Initial | Claim pending, 0 approved; order received; workflow arrived / revision 0; inside workshop; no handover. |
| Approve claim | Approved / 1 OMR; workflow approved / revision 1. Reload exposes Start work. |
| Start work | Order and claim repair stage in progress; workflow in_progress / revision 2. Reload exposes repair-status action. |
| Complete order | Original status dialog and mandatory closing review, then Save without send. Order completed; workflow ready / revision 3. Vehicle remains inside. Reload exposes Deliver vehicle. |
| Unsigned finalization | Signature-required message; no handover created and state remains ready / inside. |
| Draft save after clock fix | One cloud draft; trigger automatically binds handover/order/claim to this exact entry; no manual repair or stage override. |
| Reopen draft | Test recipient, declarations and exact delivery time **12:36:40 Oman time** restored after reload. |
| Sign/finalize | A non-personal TEST image drawn using the actual pointer canvas; existing finalization UI produces **VH-2026-00002**. Workflow delivered / revision 4, no review reason; order and claim custody with customer, entry physically with customer. |
| Reopen final | Original new receipt opens as Final, date/time and all recipient/declaration/signature controls disabled, Save draft disabled, no new-finalize action. Time remains **12:36:40**. |
| Center | Active workshop count 0; delivered records count 2 (original fixture plus this new fixture); no missing-handover or review warning. |

Independent assertions also verified exactly one handover and one automatic-binding audit for the new visit, revisions `[0,1,2,3,4]`, unchanged timestamp between draft and finalization, valid delivery time after arrival, nonempty persisted signature identical to its saved snapshot, finalization retry returning the same row without a duplicate receipt, and database rejection of signed-content mutation. These retry/denial probes were rolled back.

Cash and insurance invoice counts for the new order/claim remained **zero at every recorded stage**. Claim status remains approved, not paid. No customer-send action was used. The fictional final receipt, declarations and warranty explicitly state that this is not an actual delivery or real customer acceptance.

The original finalized `VH-2026-00001` was compared as a complete row against its before-image at every stage and at the final check, including signature, contents, links and timestamps: **unchanged**. The newly finalized test fixture is retained for review; no immutable history was deleted as cleanup.

## Additional defect found and fixed locally

The actual UI test caught a time defect not covered by the earlier suite: `saveVehicleDeliveryReceiptDraft` assigned every date-only handover **12:00 noon**. The new visit arrived at **12:05**, so the database correctly rejected the attempted draft as delivery before arrival. No rejected draft was persisted. Neither the arrival time nor the database guard was changed to make the test pass.

Local fix:

- `src/components/workorders/VehicleDeliveryReceiptDialog.tsx`: explicit editable Delivery time (Oman time), restored from cloud drafts and disabled for finalized records. Save carries the visible date/time rather than discarding the saved timestamp.
- `src/lib/vehicleDeliveryReceipt.ts`: remove hardcoded noon; persist explicit timezone-qualified timestamps, retain existing supplied timestamps, use the current instant for today's date-only legacy callers, require an explicit time for historical date-only writes, and handle date/time display in Asia/Muscat including UTC date rollover. Validate impossible or missing date/time values.
- `src/lib/i18n/vehicleHandoverLinks.ts`: Arabic/English time label and validation message.
- `src/test/vehicle-handover-delivery-time.test.ts`: afternoon-arrival save payload, retained explicit timestamp, historical date without fabricated time, timezone rollover, and invalid date/time rejection.
- `src/test/vehicle-handover-draft-loading.test.tsx`: update the existing receipt-service mock for the new date/time helpers.

The local source was rebuilt and the same unsaved test form retried after reload. Draft and finalization then succeeded with a proper explicit timestamp. This client fix is served locally against Development; it has not been deployed.

## Validation

- First complete suite after the link repair, before the additional clock fix: **299 files passed, 3 skipped; 1,867 tests passed, 6 skipped; zero failures**, 422.42s. This green result did not conceal the independently reproduced clock defect.
- Clock-fix targeted run: **4 files / 13 tests passed**, zero failures (7.83s).
- Full-project TypeScript: passed, exit 0. ESLint for all changed source/test files: passed, exit 0.
- Fresh Vite/PWA local build: passed, exit 0; existing chunk-size warning retained.
- Final complete suite on the clock-fixed source: **300 files passed, 3 skipped; 1,872 tests passed, 6 skipped; zero failures**, exit 0, 421.25s. Log `.vercel/handover-cycle-full-suite-final-2026-11-12.log`.
- Fresh real Development SQL/RLS regression: PASS for insurance/cash binding, conflicting/ambiguous identity rejection, draft/finalization retry, custody/workflow synchronization, finalized immutability, client-maintenance denial, standalone compatibility and missing-profile denial. All synthetic regression writes rolled back; current main fixtures and unrelated rows remained unchanged. Log `.vercel/handover-cycle-db-regression.log`.
- Fresh security probes: cross-tenant and anonymous writes denied; private binding helper not callable by authenticated/anon; all writes rolled back. Log `.vercel/handover-cycle-security.log`.
- Complete persisted-cycle assertion: PASS. Original receipt unchanged, automatic backlinks confirmed, exact draft/final delivery timestamp retained, one receipt/one binding audit, append-only revisions 0–4, no invoices, rejected signed edits and idempotent finalization retry. Proof `.vercel/handover-cycle-final-proof.json`.

All requested verification is complete for this Development scope. No outstanding failure remains in the tested approval-to-handover path. The original fixture and the additional explicitly marked test fixture are both retained as delivered records for review.

The six default skips require real OCR/private samples or externally supplied Development SQL-parity data. They are not reported as passing. No physical delivery, real customer signature, WhatsApp/email send, actual invoice/payment transaction, physical printing or Production certification is implied.

Private evidence: `.vercel/handover-cycle-20261112.json`, `.vercel/handover-cycle-*-proof.json`, `.vercel/handover-cycle-final-proof.json`, `.vercel/handover-link-full-suite-2026-11-12.log`, `.vercel/handover-cycle-full-suite-final-2026-11-12.log`, `.vercel/handover-time-target.log`, `.vercel/handover-time-typecheck.log`, `.vercel/handover-time-lint.log`, `.vercel/handover-time-build.log`. Connection secrets are not in tracked files.
