# Evidence-backed vehicle-center review repairs — 9 November 2026

Scope: the 15 cases identified by the current Production center census. This is not a general historical backfill, vehicle merge, financial repair or authorization to infer physical custody.

## Completed data corrections

Six claims had no `vehicle_id`, despite a unique explicit bidirectional insurance-order relationship and a complete matching Oman plate, make and model. Their references were restored to the vehicle already attached to that same order. No owner/customer identity, VIN, historical operational date, claim financial status or amount was changed.

| Existing order | Matching plate |
|---|---|
| WO-I-26-0034 | 16823 HH |
| WO-I-26-0029 | 6029 TH |
| WO-I-26-0005 | 9692 MH |
| WO-I-26-0001 | 53783 R |
| WO-I-26-0010 | 97819 B |
| WO-I-26-0043 | 3287 BB |

Their existing historical delivery evidence now resolves in Delivered. No intake receipt, physical arrival, delivery document or signature was manufactured. The missing-entry warning remains. Existing claim estimate-dirty triggers were deliberately retained: an identity-reference correction can visibly mark the existing estimate as modified/needs review. No estimate file, pricing or approval was silently regenerated.

ENT-2026-0001 was an unissued, unsigned Draft attached to an already cancelled/deleted claim and deleted order. It was marked Cancelled with an appended reconciliation event and before/after audit. The event records this correction, explicitly not a new physical exit or an invented historical cancellation time. Source deletion markers, original references, location and operational dates were preserved; neither deleted source was restored.

The seven data corrections ran together in one transaction, with exact before-image checks and short lock limits. Within that transaction, fingerprints of invoices, expenses, journals, vehicles/ownership, media, signed handovers, inspection releases, signatures and sequence values were identical before and after. All captured orders and the held/unconfirmed entry remained unchanged. Six claim audit entries and one entry reconciliation audit were appended.

## Read-only projection corrections

Three already rejected claim-only records had been incorrectly placed in Needs review because the missing-vehicle guard ran before cancellation. They now resolve in Cancelled without assigning a vehicle, generating an intake receipt, inferring physical location or changing claim rows:

- C/004/16/26/2510/00167 — 7773 AW.
- C/004/01/26/2503/00342 — 5586 BS.
- 2024/32/26 — 66172 HH.

The new `vehicle_visit_center_page_v2` is security-invoker, has an empty search path, retains the original tenant/role guards, denies anonymous execution and restores the transaction-local presentation version on success or exception. Existing v1 clients retain their original projection to avoid a client/server projection mismatch during rollout. Reloading the app selects the new contract.

Final inspection also found that adding the projection-version read had made the resolver's original IMMUTABLE declaration incorrect. A prepared constant-query regression reproduced an obsolete cached classification on Development. A separate forward migration changes only the declaration to STABLE, preserving the function body, ownership and ACL. The same prepared statement then switches correctly between old and new projections and back. The already-applied first migration was not rewritten.

## Selective source files

- `src/lib/vehicleVisitLifecycle.ts` — cancellation priority and v2 page read.
- `src/test/vehicle-center-paging.test.ts` — expected versioned read endpoint.
- `src/test/vehicle-center-cancelled-identity.test.ts` — cancellation/missing-identity and cache-semantics regressions.
- `supabase/migrations/20261109062945_cancelled_claim_center_projection_priority.sql`.
- `supabase/migrations/20261109065854_vehicle_center_projection_stable_semantics.sql`.

Each migration is applied through the official CLI using a separate exact mirror of the already-applied remote ledger and exactly one pending migration. No blanket root `db push`, manually invented ledger entries or unrelated local changes are included.

## Before/after census

| Tab | Before | After v2 |
|---|---:|---:|
| In workshop | 24 | 24 |
| With customer / temporary custody | 0 | 0 |
| Delivered | 102 | 108 |
| Cancelled | 27 | 31 |
| Needs review | 15 | 5 |
| Total, unique center rows | 168 | 168 |

All pages were enumerated read-only as the actual authenticated tenant admin. No terminal visits appeared in the active-workshop tab and no duplicate center row appeared across tabs. Older v1 clients remain functional with 8 review cases until reloaded; that is deliberate deployment compatibility, not a second data source.

## Five cases deliberately held

| Vehicle / order | Missing fact / unsafe assumption |
|---|---|
| Tesla 71744 W / WO-I-26-0101 | Signed old intake conflicts with customer-held claim; actual current custody requires confirmation. |
| BYD 44872 DD / WO-I-26-0111 | Intake/order custody disagrees. The missing entry/order backlink is not changed because its existing synchronization would also change custody. |
| Kia 92400 W / WO-I-26-0076 | Paid/delivered business status conflicts with inside-workshop custody and missing delivery evidence; actual delivery date and retained signed-paper evidence need confirmation. |
| BYD 52076 H / WO-I-26-0062 | Full-plate claim vehicle differs from the letterless order vehicle holding the VIN; confirm same physical vehicle before a separate, complete reference-graph consolidation. |
| BYD 94260 DD / WO-I-26-0106 | Same identity split. No VIN clearing, vehicle deletion, financial reassignment or blind foreign-key swap was performed. |

The owner's factual questions remain outstanding. Payment status alone is not physical delivery evidence, and similar plate digits are not sufficient authority to merge vehicle identities.

## Backup and verification evidence

- Completed physical backup 2207033078, 2026-11-08T21:56:51.699Z, less than 24 hours old at the correction. No restore was performed.
- Target before-images encrypted locally with Windows DPAPI, SHA-256 recorded and decryption verified. Resolver metadata before the follow-up migration is separately protected. No Storage object was copied or deleted.
- Development rollback rehearsal: identity restoration, stale retry denial, no duplicate vehicle/entry, cancelled projection without fabricated evidence, deleted Draft reconciliation, financial and signature invariants.
- Development actual browser: three isolated synthetic rejected claims; current UI renders Cancelled at Desktop/tablet/mobile widths. No Production data was copied into the fixtures.
- Staged and live Production read-only browser: all ten corrected cases located in the correct tabs; operational writes 0, blocked application reads 0, HTTP errors 0, console errors 0, page errors 0; test sessions revoked.
- Anonymous execution denied and wrong-tenant read rejected with `42501 VEHICLE_CENTER_TENANT_MISMATCH`; no projection-version setting leaked after a denied call.
- Final five-file release passed full typecheck/lint/build on both Development Preview and staged Production: **1,777 tests, 1,771 passed, 0 failed, 6 existing skips, 618 suites**. The prepared-plan fix also passed its real Development and Production constant-plan regressions and 52 targeted unit tests. Function body and ACL preservation were verified against the separately encrypted metadata checkpoint.
- Security Advisor reports no finding against either touched resolver or the new page wrapper. Existing unrelated security warnings were not hidden or claimed resolved.

Browser tests use WebKit on Windows at widths 1366/834/390. This is not physical-device certification. No real customer transition, signature or financial save was performed by the Production browser tests.

## Release completion

Status: **ten evidence-backed cases corrected, selectively published and verified on the live primary URL; five factual/identity cases remain explicitly held.**

- Live URL: https://aaed-2.vercel.app/vehicle-entry.
- Final deployment: `dpl_GvSLWtSXfBrYTttTkWJTRkRiyQuh`.
- Final source digest: `c6b491df9a588c329adcc03338aa3fde9b7c08613f06e351f3c850432a3b5493`.
- Staged URL: https://aaed-2-8lf2wvdb2-alwafaoman1-cells-projects.vercel.app.
- Development Preview: https://temo-work-order-preview-5onowysv4-alwafaoman1-cells-projects.vercel.app.
- Source base: `bcc4b64469651614bef484df76c0a74845ac64b9`; the current live-source manifest is `.vercel/review-stable-production-manifest.json`. Do not select an older November source snapshot for a later release.
- Both exact migration versions above are recorded in Development and Production; each was applied separately and only after the appropriate Development checks.
- Read-only final live browser verification passed in **Arabic/RTL and English/LTR**, including all ten corrected cases and widths 1366/834/390. Operational write attempts, blocked application reads, HTTP failures, console errors and page errors were all **0**. Both test sessions were revoked.
- Final census: 168 unique center rows, including 24 active workshop, 108 delivered, 31 cancelled and 5 Needs review. No active temporary-custody rows are currently recorded. No entries or vehicles were created by the Production correction.
- Final data readback again matched the original financial/vehicle/media/signature/sequence fingerprints, confirmed exactly six reference-restoration audit entries and one Draft reconciliation, and found no duplicate correction audits. Original operational dates and captured work-order rows remain unchanged.
- OCR Worker remains ready with one replica and the unchanged pinned image. No Worker or OCR feature change is included.

Completion evidence: `.vercel/review-completion-proof.json`, browser and database proofs named above, and the two CLI migration receipts. Existing unrelated project warnings and skipped tests are outside this correction's completed scope; this report is not a claim that every function in the entire ERP is certified.

No new Git commit, push or main merge was created. Private proofs are retained under ignored `.vercel/review-*`; they are not included in the public deployment.
