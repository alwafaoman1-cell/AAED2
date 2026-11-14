# Review visits reuse the previous claim and order — Development only

The previous return feature created a fresh visit/signature/receipt but inherited the ordinary insurance approval path. It therefore asked for a new claim/order. This repair gives attested review returns an independent operational path while retaining explicit references to the original visit, finalized handover, claim and work order.

## Result

- Review stages: arrived for review → review in progress → ready for re-delivery → delivered after review. No new approval stage or claim/order creation.
- Historical references come from the immutable review relation and its original finalized handover. The original order/claim's one-to-one visit ownership is retained; their status, financial fields and original delivery dates are not reopened or overwritten.
- Database triggers reject attaching new claims/orders to the review visit or reparenting old financial records to it. Normal intake/approval rules remain unchanged.
- Review completion records findings. Re-delivery requires the current review visit's issued receipt, an actual recipient and a fresh electronic recipient signature. It creates a distinct finalized handover, consumes only that review receipt and advances only the review workflow/custody. Repeated delivery request IDs return the same finalized record.
- A nullable `review_return_id` on handovers identifies the attested review relationship. Ordinary visits retain one finalized handover per order; review visits have a separate one-finalized-handover-per-review constraint. The binding trigger validates tenant/vehicle/source references and prevents using this classification to bypass ordinary uniqueness.
- Previous signed handovers and signatures stay immutable. Cancelling a finalized review handover is rejected rather than rewriting the original delivery.
- The UI shows previous visit/claim/order/handover links and review findings, hides ordinary claim/order/approval actions, and refreshes the receipt/history caches after delivery. A delivered review can start another distinct review through the existing return action.
- Receipt output includes historical claim/order references and the new review handover/findings/recipient signature separately from the frozen intake snapshot and initial signature. English labels are English-only; entered customer text is preserved as entered.

## Files

- `supabase/migrations/20261114131838_review_visit_reuses_prior_workflow.sql`
- `src/lib/vehicleReviewVisit.ts`
- `src/components/vehicle-entry/VehicleReviewWorkflowPanel.tsx`
- `src/pages/vehicle-entry/VehicleVisitControlPanel.tsx`
- `src/components/vehicle-entry/VehicleVisitInlineActions.tsx`
- `src/lib/vehicleVisitLifecycle.ts`
- `src/lib/vehicleCenterPresentation.ts`
- `src/lib/vehicleIntakeReceipt.ts`
- `src/test/vehicle-review-workflow-panel.test.tsx`
- `src/test/vehicle-intake-receipt.test.ts`

## Verification

Development project only: `rrhyglrnlveygyiandhs`. No Production database/API/browser actions, commit, push or deployment were performed for this repair. HEAD remains `04a4adde4d6cfd5bfbfb95e6615a15d13588a565`.

Before Development DDL, a fresh encrypted checkpoint passed decryption and typed temporary-table restoration for 18 tables, including the review relationship and vehicle/customer data. Plaintext checkpoint SHA-256: `8166502511f9d8e745dc32f92f7820e29822b84a2ca134f0a4ed13cb35855f8a`. Private backup/test scripts stay ignored under `.vercel/`.

The existing database receipt regression passed in a rolled-back migration rehearsal, including signature preservation/revision invalidation, exact receipt reuse/consumption, legacy exceptions, permission/tenant restrictions and late-failure rollback. The new review regression passed both in rehearsal and against the applied Development schema for cash and insurance: direct approval rejected, review starts without creating financial records, findings required before ready, old receipt rejected, fresh receipt consumed once, retry returns the same handover, old entry/order/claim/handover unchanged, and direct financial reparenting rejected. Fixtures rolled back with identical original fingerprints.

The browser exercised existing fictional review visit `ENT-2026-0008`: start review, persist findings, prepare delivery, verify receipt `VIR-ENT-2026-0008-R1`, record fictional recipient and a newly drawn test signature, then finalize `VH-2026-00006`. Reload/read-back showed delivered after review and a used receipt. Its historical references remain original claim/order `TEST-RECEIPT-bc6ef15` / `WO-I-26-0007`. No real repair, billing or customer acceptance is represented by the fictional test data.

The post-cycle comparison matched all 66 previous work orders, 34 claims, 5 signatures, 5 signed revisions, 17 previous handovers and the existing review relationship against the checkpoint. The original fields of old handovers were preserved; the schema adds a nullable review classification column.

Full existing suite passed: 1903 tests / 0 failures / 6 existing optional skips (306 passed files / 3 skipped files). Additional tests cover previous-reference display, skipping approval, saved findings, required new receipt/signature/recipient/confirmation, receipt-cache invalidation and escaped PDF references/findings with frozen intake preserved. Final targeted rerun: 41 passed. Project TypeScript build, full-source ESLint, Development build and whitespace checks passed.

Actual receipt preview and PDF download were exercised. Review-specific spacing is compacted to keep references, findings and delivery signature readable; the original frozen intake data is not edited. The final downloaded Arabic receipt was rendered with Poppler and visually checked: one A4 page, with prior references, findings and the new recipient signature complete and no blank page. The initial intake signature is the preserved synthetic test signature.

## Boundaries

Production still runs the previously released feature until separately authorized to release this repair. No automatic charge, new insurance approval, invoice or change to old accounting is introduced. Additional billable work requires its own explicitly chosen business process.
