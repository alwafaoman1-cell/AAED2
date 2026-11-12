# General vehicle-center flow verification — 9 November 2026

## Scope and result

Verified that the shared lifecycle/location controls are not specific to WO-I-26-0045. No application code, Production data, migration, environment setting, Git commit, push or deployment was changed in this verification task. Existing permissions, approval, financial-closing and evidence requirements were preserved.

The current primary URL still serves deployment `dpl_J8BYy1AearPVT4796UpKt8RTf4sJ`. Source searches found no reference to the corrected work-order/entry IDs in the shared application controllers or lifecycle service.

## Actual browser writes on Development only

Four independently created synthetic visits completed from the center:

| Channel | Temporary release | Final handover | Result |
| --- | --- | --- | --- |
| Cash | Paper acknowledgement | Paper acknowledgement | Passed |
| Cash | Public customer-link electronic signature | Electronic signature | Passed |
| Insurance | Paper acknowledgement | Paper acknowledgement | Passed |
| Insurance | Public customer-link electronic signature | Electronic signature | Passed |

Each included a temporary exit, confirmed physical return, work-in-progress, completion/closing review, Ready and final Delivered. Cash approval was confirmed explicitly; insurance cases started with a valid approved claim, not a cash customer-approval checkbox. Staff action URLs remained `/vehicle-entry`; the public customer signature naturally used its separate customer link.

Readback confirmed custody synchronization between the same entry, order and insurance claim, one entry/order/claim per synthetic visit, one returned temporary-release report and one finalized handover per visit, correct signature-method evidence and no duplicate documents. Ready alone did not move custody out of the workshop. Paper records had no fabricated electronic signature image. Timeline revisions and event times remained chronological and append-only. Financial document/expense/journal fingerprints were unchanged, and the isolated test account was restored to its original disabled manager state with browser sessions revoked.

Browser source: the already-authorized Development preview `https://temo-work-order-preview-44h2ifho2-alwafaoman1-cells-projects.vercel.app`. Its operational controllers, stage/location components, handover and temporary-release flows are byte-identical to the current release. Source differences versus current Production are limited to the later arrival-time display/editor precision helper and its tests, which were separately browser-verified in the preceding release. No origin/CORS protection was bypassed or changed for these tests.

## First arrival, authorization and retry checks

Additional synthetic, rollback-only tests covered both cash and insurance inspection forms:

- Prepared forms remain With customer until explicit physical arrival; saving a form does not invent an arrival or exit.
- Stale/future arrival requests are denied; a successful arrival retry does not append a duplicate event.
- Entry, order and claim custody synchronize on arrival, and work cannot start while the vehicle is outside.
- Skipped completion and unsigned final delivery are denied; backward transitions require the authorized role, a reason and consistent source records.
- Technicians cannot approve cash repairs; wrong-tenant requests are denied.
- Both paper/electronic temporary-release RPCs, return, tenant isolation and idempotency tests were rerun.

Production has an additional conflict guard during initialization of a missing workflow, compared with Development's current function body. The exact Production transition definition was rehearsed inside the rollback-only Development test. The original Development function and its ACL were verified restored afterward; neither environment's persistent definition was altered in this task.

The targeted application regression run passed **86 tests in 9 files**, with no failed tests. The existing React Router future-flag notices remain notices, not newly introduced failures. No full rebuild was required because no application source changed.

## Production verification — read-only

Authenticated tenant-scoped enumeration covered **168 center records**, including pagination:

| Tab | Records |
| --- | ---: |
| In workshop | 24 |
| With customer / temporary custody | 0 |
| Delivered | 102 |
| Cancelled | 27 |
| Needs review | 15 |

There were no duplicated entry rows across tabs. Delivered/cancelled records were not shown as active in-workshop or temporary-customer records. Customer custody requires the canonical pending-arrival or finalized temporary-release evidence rather than an arbitrary location patch.

The live browser opened and loaded the actual stage/location controls for **all 24 currently in-workshop records**. Result: operational writes **0**, blocked application requests **0**, HTTP errors **0**, console errors **0**, page errors **0**. The browser used normal authenticated client access; no privileged key was placed in it. Its session was revoked. Desktop/tablet/mobile layout checks were WebKit viewports, not physical-device certification.

An independently completed real example was observed: WO-I-26-0103 now has a finalized electronic handover, a Delivered center/work-order state and With customer custody. No tester action finalized it. A previous read-only test assumption that it was still Ready was rejected and removed from the generic live test; current records, not a fixed work-order number, are enumerated.

## Data exceptions — do not force transitions

The 15 review records are not evidence that the controls are record-specific:

- 11 claims have no linked entry receipt.
- ENT-2026-0046 and ENT-2026-0001 have work-order link conflicts.
- ENT-2026-0045 has conflicting custody evidence. This is a different entry from ENT-2026-0061 / the corrected WO-I-26-0045.
- ENT-2026-0020 lacks a signed finalized handover despite delivery evidence.

These require factual identity/custody/document review before mutation. They were not automatically linked, moved, backfilled, signed, renumbered or financially modified. Draft/incomplete intake records also remain subject to their normal completion prerequisites. This verification is not a claim that every historical record may safely be forced into every stage.

## Test-harness observations and evidence

The initial concurrent Development attempt encountered one statement timeout while the shared-tenant rollback regression was running. The application was not changed to conceal it: the matrix was rerun serially and all four flows then completed with zero HTTP/console/page errors. Failed-attempt evidence is retained. Live-test selectors were corrected for the entry-specific accessible button labels; no site button or permission was weakened.

Private generated evidence, excluded from Git/public bundles:

- `.vercel/vehicle-center-matrix-browser.json`
- `.vercel/vehicle-center-matrix-durable.json`
- `.vercel/vehicle-center-arrival-permissions.json`
- `.vercel/vehicle-center-production-census.json`
- `.vercel/legacy-visit-browser-live.json`
- `.vercel/visit-center-sql-proof.json`

Outcome: the general shared workflow passed the exercised scenarios. Historical review exceptions remain explicit and were not silently repaired.
