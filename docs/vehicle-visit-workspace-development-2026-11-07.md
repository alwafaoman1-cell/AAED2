# Vehicle visit workspace — Development verification

Subsequent approved rollout: this tested workspace and its single migration were selectively published and verified on Production. See [the Production execution report](owner-confirmed-identity-and-visit-release-2026-11-07.md). The boundaries below describe the earlier Development stage.

## Boundary

Development only (`rrhyglrnlveygyiandhs`). No Production deployment, Production SQL, commit, push, historical backfill, auto-link, financial repair or renumbering is part of this change. Existing unrelated local changes are not included in the frozen Preview bundle.

Preview: https://temo-work-order-preview-di0218pyq-alwafaoman1-cells-projects.vercel.app/vehicle-entry

Deployment: `dpl_3ZQXQfrJcc36573XEPsquw8Bw5ox` (Preview, not Production).

## Root causes and fixes

1. Quick actions duplicated the stage controller and navigated to separate prerequisite pages. Quick actions now reuse the same controller, with existing approval/cancellation/source-creation, repair-status and handover components embedded in the current workspace. Permission checks and source business guards are retained.
2. The atomic intake RPC hardcoded workshop custody, and the identity step separately hardcoded its display. New inspection forms are explicitly prepared with customer custody and `arrival_confirmation=pending`. An explicit green, permission-checked physical-arrival action confirms arrival atomically across the entry, linked claim/order, operational source and timeline. Historical unmarked customer custody is not treated as a newly prepared visit.
3. Claim-only terminal records were quarantined before cancellation classification. Cancelled records now appear in Cancelled while retaining their missing-link/active-order warnings. No handover, deletion or financial cancellation is fabricated.
4. A missing claim on a valid newly prepared insurance intake was treated as a data conflict. Claim creation remains an explicit available step; insurance approval/start requirements are unchanged. Cash approval remains separate and does not record a payment.
5. Narrow linked-entry reads omitted `vehicle_condition`, losing canonical prepared-arrival evidence. The evidence is now included in that scoped read.
6. Minute-only datetime controls truncated seconds and could put an immediate action before the preceding approval. An untouched default means the real submission time; a manually edited date/time is preserved and still validated by the server.
7. Start choices were repeated in the form. Already-selected service/purpose is now a summary with an explicit Change choices action. Unsaved embedded intake/release forms retain close confirmation.
8. A conflict could render two identical Review badges. Only one Review badge is shown. Tab guidance now explains prepared forms, actual arrival and recorded temporary exits separately.
9. Real browser testing exposed a pre-existing handover draft race: fields were editable while the initial cloud read was still pending, then `applyDraft` overwrote typed recipient details. Editing is now gated until that read succeeds; a failed read shows a retry action, not an unverified editable draft. Stored signatures redraw after loading. The center embeds the existing page presentation in a width/height-constrained dialog, avoiding overflow from the legacy wide dialog footer. Handover validation, paper attestation and financial rules are unchanged.

## Changed scope

The explicit source/test manifest is `.vercel/visit-workspace-qa-manifest-20261107.json` (32 overlays on the previously verified work-order-list release, not the dirty checkout).

- Intake: `VehicleEntryIdentityStep`, `useVehicleEntryEditor`, `VehicleEntryForm`, `vehicleEntryService`, new `vehicleVisitIntake`.
- Workspace: `VehicleVisitQuickActionDialog`, `VehicleVisitControlPanel`, `VehicleEntryDetail`, `VehicleEntryList`, `VehicleInspectionReleasePage`; new `VehicleVisitInlineActions`, `VehicleVisitLocationPanel`, `ConfirmUnsavedVisitDialog`.
- Source safety: the expected-status type in `useInsuranceClaims`; existing checked mutation behavior is unchanged. Full work-order actions use the existing `resolveWorkOrderListAction` tenant/deleted/full-record guard.
- Projection/language: `vehicleVisitLifecycle`, `vehicleCenterUpgrade`, new `vehicleVisitWorkspace` resources.
- Generated types: signature for the new arrival RPC.
- Handover: `VehicleDeliveryReceiptDialog` initial-read gate and retry, with `vehicle-handover-draft-loading.test.tsx` testing delayed and failed reads without writes.
- Regression tests: center paging/parity, lifecycle, controller, quick actions, wizard/editor, claim ownership, inspection release and supervisor stage tests; new workspace regression test.

## Development migration

`20261107115803_vehicle_visit_workspace_intake_and_projection.sql`

Rehearsed inside a rollback transaction before applying individually to Development. It checks the exact existing function definitions before replacement; drift fails instead of silently rewriting an unknown implementation. No blanket `db push`, previous ledger repair or business-row update is included.

`register_vehicle_visit_arrival` is a narrowly scoped SECURITY DEFINER coordinator with an empty search path, no PUBLIC/anonymous execute grant, active-role/tenant checks, row locks, revision CAS, exact-identity validation, idempotent acknowledged retries, audit and timeline writes. It does not modify ownership, numbering, invoices, payments or expenses.

## Validation

- Final exact-source cloud gates: full typecheck PASS; full lint PASS; full suite **1706 tests / 1700 passed / 0 failed / 6 conditional skips**; production build PASS. Cloud execution used 4 vCPU / 8 GB to avoid exhausting the local computer. Remaining baseline dependency-deprecation/chunk warnings are not suppressed.
- Development authenticated SQL: prepared inspection custody, center projection, actual-arrival synchronization, retry idempotency, duplicate denial, edit-cannot-reset custody, unknown-tenant denial and anonymous denial PASS; test transaction rolled back.
- Cash authenticated SQL: workshop admission without financial action remains Arrived; no claim/order is fabricated; technician and disabled manager arrival requests denied; test transaction rolled back.
- Real SQL/frontend projection parity: 19 cases PASS, read-only.
- Browser: real wizard save and approval completed; resumed the saved fixture without creating another entry, explicitly confirmed the existing approval-created order, registered actual arrival and started repair from the same center. One entry/order, no navigation, no HTTP/console/page errors and no document overflow at Desktop 1440, Tablet 1024 and Mobile 390 widths.
- Browser cancellation: pending claim cancelled in place with reason, visible in Cancelled without a fabricated entry/delivery; zero failed HTTP/console/page errors.
- Browser cash: complete wizard reused the existing customer/vehicle, workshop entry remained Arrived before any financial action, then one cash work order was explicitly created/linked and customer repair approval recorded, without an insurance claim, invoice or payment. Zero blocked requests/HTTP/console/page errors.
- Browser completion/handover: existing closing review saved the order as completed and synchronized the center to Ready. After fixing the draft-read race, paper-attested handover finalized through the real authenticated RPC, synchronized entry/claim/order/center custody and stage, and appeared only in Delivered, not With customer. No invoice/payment was created. Zero blocked requests/HTTP/console/page errors. The final subsequent source difference is the footer wrapping fix plus its test; final exact-Preview read-only visual verification is recorded separately.
- Data verification: all non-fixture public-table and Auth-user fingerprints, public sequence state and pre-existing migration-ledger rows are unchanged. Exactly the intended Development migration was added. Each actual synthetic visit has one entry and one order; one synthetic customer was reused; vehicle ownership is unchanged; the cancelled claim has no fabricated intake. No expenses/invoices/payments were created.
- Final exact-Preview read-only verification PASS: English center and finalized handover at Desktop/Tablet/Mobile, and Arabic/RTL center at the same sizes (9 viewport checks). No horizontal document overflow, unexpected writes, blocked requests, HTTP errors, page errors or console errors. Arabic screenshots were visually inspected after provisioning the QA browser's Arabic fallback font; handover footer buttons remain reachable.
- These are actual Chromium browser flows with emulated viewport sizes, not a physical iPad/phone hardware certification. All test logins used a regular manager JWT and the synthetic Development tenant; no email/WhatsApp was sent. Sessions were revoked and the isolated test profile was disabled afterwards; evidence records were retained.
- Production boundary verified read-only: the live alias remained `dpl_2q9CuJF36DgGraFfyxWvfdK5BNuQ`; the new migration and arrival RPC are absent there.

## Evidence discipline / retained limitations

Browser harness attempts initially used a row's old claim-only text after it had become an entry row, checked a lazy-loaded button before its data arrived, and attempted Arabic selectors despite the English runtime translation. Another attempt clicked Save before asynchronous closing approval completed and blocked the explicitly generated audit-log setting. A later harness waited for a dynamically selected last dialog to disappear after it had already become the still-open parent, and another guard tried a nested browser read inside a paused request (changed to an ordinary same-tenant, regular-JWT read outside that browser route). These harness failures are not counted as successful end-to-end runs. The genuine recipient-field loading race and footer overflow were fixed, not hidden. The same fixture is resumed rather than deleted or reseeded.

Development Security Advisor still has pre-existing unrelated findings and intentionally authenticated coordinator functions. This task does not silently mass-rewrite RLS or claim whole-site security readiness. Existing archived/conflicting historical records remain reviewable, not automatically repaired. No real vehicle/photo/customer data was copied into the isolated synthetic tenant.

Headless visual QA needs an Arabic font unavailable in the serverless Chromium default Latin/Greek/Cyrillic font set ([Chromium font documentation](https://github.com/Sparticuz/chromium#fonts)). Initial Arabic screenshots therefore were not accepted as visual proof. The existing QA-only `NotoSansArabic.ttf`/OFL assets are provisioned in the browser runner's font directory before repeating visual QA; application fonts/CSS are not replaced by the harness.

## Outcome

**Development verification complete; ready for user Preview review.** Production: **NOT APPLIED**. No commit or push was created; HEAD remains `bcc4b64469651614bef484df76c0a74845ac64b9`. The worktree contains unrelated older changes which remain outside this Preview bundle. A future Production rollout still requires its own reviewed selective migration, backup/recovery gate and release approval; this report is not permission for blanket `db push` or historical data repair.
