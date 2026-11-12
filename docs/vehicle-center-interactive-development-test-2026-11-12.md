# Vehicle center: real Development action test — 2026-11-12

Follow-up: the association defect below was subsequently repaired and reverified in Development only. See [the scoped repair report](handover-visit-link-development-fix-2026-11-12.md). The original test findings are retained below as evidence.

## Outcome

**Partial pass, not end-to-end acceptance.** Approval, start work, completion, cloud draft persistence, signature validation and handover finalization were exercised through the authenticated local application. A real handover/visit association defect remains: the finalized handover has no `vehicle_entry_id`, so the visit detail falsely reports missing handover evidence and the canonical visit remains `ready`/inside while the order and claim are delivered/with-customer. The center removes the vehicle from active workshop rows and lists it as delivered, but still shows the missing-handover warning.

No Production project was queried or mutated. No commit, push, remote change, deployment, schema migration, historical backfill or direct SQL update was performed. SQL was used for independent readback only. The local preview server remains on `http://127.0.0.1:5194`; its build targets Development `rrhyglrnlveygyiandhs`.

## Fixture and retained state

- Tenant: `00000000-0000-4000-8000-000000005741`.
- Visit: `TEST-VISIT-20261102`, `bfe7ae3e-757c-475f-a5bc-1cdf0b8176a9`.
- Claim: `DEV-PREVIEW-CLAIM-001`, `d6f84766-206d-4f96-b26d-215be79b4204`.
- Order: `WO-I-26-0001`, `9d4bd53d-bafa-43fe-9c61-4f70937a5d60`.
- Fictional Toyota Hilux / `TT 99991`; customer explicitly marked as preview/test, with no email or phone. Claim notes explicitly identify it as fictional.
- Approval test value: **1 OMR**, entered in the normal approval UI. Any resulting Development accounting side effects are retained as test data; this is not a real approval.
- Final handover: `VH-2026-00001`, `9b33fa4d-5f75-414f-b243-6946048bf705`, finalized once. Recipient and operator were named TEST, declarations/warranty explicitly state no real handover/customer acceptance/warranty, and the electronic image reads TEST. No real identity or customer signature was used.
- No cash or insurance invoice was created; invoice counts for this order/claim are both zero. No customer-send action was used.
- Test state remains stored for review; no reset, deletion, or manual rewriting of finalized evidence was attempted.

## Live readback

| Step | Application action and independent result |
|---|---|
| Baseline | Claim pending/0, workflow arrived/revision 0, order received, inside workshop, no handover. |
| Approve | Normal card action opened the approval form. Saved 1 OMR; claim approved, insurance approval flag true, workflow approved/revision 1. Reload retained it and exposed Start work. |
| Start | Normal transition confirmation with an explicit Development-test note. Workflow in_progress/revision 2; order and claim repair stage in_progress and start timestamps saved. Reload retained it. |
| Complete | Card action opened the original work-order status dialog. Selected Ready, confirmed the required closing review, then used Save (not Save and send). Order completed; workflow ready/revision 3; claim completion timestamp set. Reload retained it and exposed Deliver vehicle. |
| Reject unsigned delivery | Normal finalization without a signature showed the signature-required message. Independent readback: zero handovers, workflow still ready, order still in_workshop. |
| Save draft | Test-only recipient/operator/declarations saved to a cloud draft; reload and reopening restored those fields. |
| Save TEST image | Used the real canvas pointer UI. Cloud image was read back and visually inspected as nonempty TEST lettering. |
| Finalize | Normal UI finalizer produced VH-2026-00001. Database readback: finalized timestamp set; order delivered/with_customer; claim repair_stage delivered/with_customer. Exactly one handover. |
| Reload list | In workshop 0; closed Records 1; Delivered contains the fixture. No redundant work-stage filters in Delivered. |
| Visit evidence | **FAIL:** record lacks entry FK, workflow remains ready/revision 3, entry physical location remains inside, detail says delivery_without_signed_handover, and delivered card offers Review record despite the finalized receipt. |

## Local UI defect fixed

At the actual narrow in-app viewport, the standalone handover `section` was a shrinking flex child of the quick-action dialog. It became roughly 501px tall despite over 2,200px of content. `overflow-hidden` clipped its contents and the footer covered the signature canvas; wheel scrolling could not reach the pad. DOM geometry and the visible screenshot confirmed the overlap.

`src/components/workorders/VehicleDeliveryReceiptDialog.tsx`: add `shrink-0` to that standalone section. This prevents compression and lets the existing outer dialog scroll normally. After rebuilding and reloading at the same viewport, the canvas and buttons were reachable; TEST could be drawn and saved. No persistence, financial, signature-validation or finalization logic was changed.

## Remaining association defect

The fixture already had `vehicle_entries.work_order_id` pointing to its order, but both `job_orders.vehicle_entry_id` and `insurance_claims.vehicle_entry_id` were null. `saveVehicleDeliveryReceiptDraft` copies the order's null `vehicle_entry_id` directly into the handover. The live `finalize_vehicle_handover` permits this and updates order/claim custody, without assigning the visit or transitioning its workflow. The visit-detail reader queries handovers exclusively by `vehicle_entry_id`, so it cannot discover this otherwise finalized receipt.

The independent SQL evidence and final browser state are retained in `.vercel/center-interactive-e2e-proof-2026-11-12.json`. No finalized-record edit, manual stage override, fake handover, blanket synchronization, or deletion was used to hide the discrepancy.

Next repair should validate an unambiguous same-tenant/vehicle/claim/order visit link before finalization, keep the handover and visit state consistent, and explicitly reject ambiguous/missing links. Repairing this already finalized test record must use the established audited correction path, preserving the signed payload. This report does not authorize a Production migration or historical correction.

Additional observed timing detail: `job_orders.work_completed_at` and `completed_at` remained null after the status became completed, while the claim completion time and visit transition were set. This was not rewritten during the test.

## Local checks

- Fresh Vite build/PWA generation: passed, exit 0. Log `.vercel/center-live-development-build-2026-11-12.log`. Existing chunk-size warning remains.
- Targeted runtime regression: **4 files / 56 tests passed**, exit 0, 33.53s. Log `.vercel/center-interactive-e2e-target-2026-11-12.log`.
- ESLint for the changed component: passed, exit 0. Log `.vercel/center-interactive-e2e-lint-2026-11-12.log`.
- Full-project TypeScript: passed, exit 0. Log `.vercel/center-interactive-e2e-typecheck-2026-11-12.log`.
- The earlier full-suite success remains a separate result. No full-suite success is claimed for the actual live handover path; this test reproduced the association failure above.

Physical delivery, paper signature, real customer messaging, invoice issuance, payment and Production behavior were not exercised.
