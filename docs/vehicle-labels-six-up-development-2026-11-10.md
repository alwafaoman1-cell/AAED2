# Internal vehicle cards and customer-custody definition — Development

Date: 10 November 2026. Production: **Not Applied**. No commit, push or main merge.

## Implemented

- Individual, current-page and all-filtered-results selection in the Vehicle Operations Center. Selection persists across pages within the same tenant, tab and filter, including page-size changes. Changing the filter/tenant or receiving a new source scope clears stale selection.
- Bulk **Internal vehicle card** printing: A4 portrait, two columns by three rows, six cards per sheet. A partial last sheet contains only the remaining cards; no extra empty page. Existing single-card 60 × 40 mm printing is unchanged.
- Printing selected snapshots first checks one fresh bounded cloud page. Selecting all does not fetch all records immediately; only the explicit Print action retrieves matching pages, with the existing 100-row request bound, maximum-result limit and scope-drift checks. No partial batch is printed after a read failure.
- Source changes, blocked popups and preparation failures are visible errors, not false success. Filter navigation or unmount aborts the print preview. Native print is opened from the click before asynchronous work, with assets/fonts ready before printing.
- Cards contain visit identity, full plate, make/model/year, a verified order reference, claim reference, date and staff-only QR. No customer names, phones, prices, public customer tokens or original photos are printed. Candidate/conflicting work-order links are not printed as confirmed facts. Legacy claim-only cards are explicitly labelled and link to the authenticated claim, never a fabricated intake receipt.
- Shared escaping, image-URL validation and final HTML sanitization protect the print boundary. The language follows the app; English output and its test watermark contain no Arabic UI text.

## Custody definition

| Tab | Meaning |
|---|---|
| Awaiting arrival | A prepared inspection form whose actual arrival has not been confirmed. It is not proof of a completed inspection or a temporary exit. |
| In workshop | Confirmed actual workshop custody. |
| With customer | A vehicle that arrived and subsequently left under an existing finalized temporary release, including paper acknowledgement or electronic signing. Awaiting parts/approval does not itself create an exit. |
| Delivered | Final delivery; not temporary customer custody. |
| Cancelled / Review | Existing cancellation and conflict handling remains intact. |

The arrival action remains available for both first arrival and return from a temporary release. The supervisor app uses the same new read contract and exposes Awaiting arrival. Prepared forms display their form date, not a claimed physical-arrival date, and the supervisor does not start an arrival-age clock from a preparation date. Actual approval timing is preserved separately.

## Database and scope safety

Migration `20261110051157_vehicle_center_awaiting_arrival_tab.sql` creates only a new **read-only, security-invoker** `vehicle_visit_center_page_v3`. It retains the existing bounded, set-based evidence bridge, active-profile/tenant/role checks, source-table RLS, filters, duplicate checks, totals, scope tokens and paging. It normalizes the new display contract before counting and paging. No new privileged bridge or per-row query is introduced.

The v1/v2 functions and their ACLs remain unchanged for old clients. Previously fixed rejected/cancelled claim-only projection is retained independently of the old presentation-version setting. Anonymous execution is denied; authenticated reads still require the existing role/tenant authorization.

The migration was rehearsed and rolled back on Development before being applied through the official CLI in an isolated, exact mirror of its applied ledger, with exactly one new migration. No blanket `db push`, manual ledger repair, source data backfill, financial change, renumbering or Production connection was part of this implementation. No Storage asset is generated/uploaded or duplicated by card printing.

The browser fixtures are an explicitly tagged synthetic Development customer with 13 workshop visits, one prepared inspection and one paper-finalized temporary release. No Production customer or vehicle was copied. The isolated test account is restored to its prior state after verification, and browser sessions are revoked.

## Selective source files

- `src/lib/i18n/vehicleEntryLabels.ts`
- `src/lib/vehicleEntryLabelSheet.ts`
- `src/hooks/useVehicleLabelSelection.ts`
- `src/components/vehicle-entry/VehicleEntryLabelActions.tsx`
- `src/lib/vehicleVisitLifecycle.ts`
- `src/pages/vehicle-entry/VehicleEntryList.tsx`
- `src/pages/apps/SupervisorApp.tsx`
- `src/components/supervisor/SupervisorVehicleCard.tsx`
- `src/lib/supervisorVisitTiming.ts`
- `src/test/vehicle-center-paging.test.ts`
- `src/test/vehicle-entry-list-tabs.test.tsx`
- `src/test/vehicle-visit-workspace.test.ts`
- `src/test/vehicle-entry-label-sheet.test.ts`
- `src/test/vehicle-label-selection.test.ts`
- `src/test/supervisor-visit-timing.test.ts`
- The migration above.

Only these sixteen files are overlaid on the last verified live-source snapshot for the Development Preview. Unrelated dirty-worktree changes are excluded. Private test credentials and proofs remain under ignored `.vercel/` and are not in the deployment.

## Verification

- Development SQL rollback rehearsal: prepared arrival separated from a real paper temporary release; no cross-tab duplication; old v2 contract retained; anonymous and wrong-tenant access denied.
- Actual applied function: security invoker, STABLE, anonymous execution denied, authenticated execute granted and official migration ledger record present. No new Security Advisor finding against this endpoint; unrelated pre-existing warnings were not altered or claimed resolved.
- Unit/regression coverage: selection across pages, all-results lazy loading/exclusions, changed-scope rejection, stale-selection reset, aborts, six-up pagination, no empty final page, HTML injection, private-data exclusion, blocked popups, duplicate print entries, unconfirmed order references, language, pending-arrival classification and approval/arrival timing separation.
- Two local UI waits exceeded their existing time limits while physical RAM was constrained; no timeout was increased and no test was skipped to hide them. Full validation of the exact frozen source is run on the existing 8 GB Development build machine instead.
- First actual browser pass verified Arabic cross-page selection, all 13 filtered vehicles in 6/6/1 pages, actual temporary-release/pending-arrival separation and responsive layouts. Its English pass stopped on a test locator that requested the Arabic Next button; the existing auto-translation correctly renders Next in English. The harness was corrected, not the application language.
- A4 Arabic PDF was rendered and inspected at the first and last pages: three A4 pages, six full cards on the first page and one card on the last, no blank page. Final exact-source full-build and both-language browser results are recorded below after completion.

## Final verification / Preview

**Development verification complete. Production remains Not Applied.**

- Preview: https://temo-work-order-preview-93jdln3tm-alwafaoman1-cells-projects.vercel.app/vehicle-entry.
- Deployment: `dpl_5jSzGuWZTKs4mWMyXNSrvZisYzqi` (Development-only project; no Production target).
- Exact source digest: `5a74e50ffc8d76f4abb7bec2460e6e133f26067031dce2d829c8297f496ad89b`.
- Full typecheck, lint and Production-format build: **PASS** on the existing 8 GB Development builder.
- Full tests: **1,797 total; 1,791 passed; 0 failed; 6 existing skips; 622 suites**. No timeout was increased or test skipped to mask the earlier local resource-constrained waits.
- Real authenticated browser flow passed in **Arabic/RTL and English/LTR**: select two cars across two list pages; clear selection; select all 13 filtered matches without eagerly fetching all; print all 13, including the initially unloaded page; verify all 13 confirmed order references; separate the prepared form from the actual paper temporary release; check Desktop/tablet/mobile widths 1366/834/390 without horizontal root overflow.
- Operational writes, blocked application reads, HTTP failures, console errors and page errors during the browser tests: **0**. Vercel's optional Preview feedback toolbar was excluded, not an application request.
- Both native-print PDFs reopened and verified as three A4 pages containing **6 / 6 / 1** distinct vehicle-entry numbers. First and last-page layout was rendered with Poppler and visually inspected; no clipped cards or blank trailing page. Arabic sample: 184,708 bytes; English sample: 183,204 bytes. These are clearly watermarked synthetic examples, not actual customer documents.
- Exact selected-source file hashes were verified against the frozen build. The synthetic test account was restored and the browser session revoked. No commit, push, main merge, Production migration, historical record repair or Production deployment was performed.

Private proof: `.vercel/vehicle-labels-completion-proof.json`, `.vercel/vehicle-labels-browser-proof.json`, `.vercel/vehicle-labels-build-proof.json`, `.vercel/vehicle-labels-dev-check.json` and `.vercel/vehicle-labels-migration-development.json`. Sample artifacts are under `output/vehicle-labels/` and are not uploaded to Supabase Storage or included in the deployed source.

Next step, only after explicit release approval: recheck the then-current live-source baseline and fresh backup, apply this one read migration selectively, publish only the approved files, and run a read-only live smoke. Do not use a blanket `db push` or include unrelated dirty-worktree changes.

Physical printer dispatch and physical iPhone/iPad certification are not part of this test; browser viewport checks are not claimed as physical-device testing. Existing unrelated project security warnings and the six skipped tests are not certified resolved by this feature.

## Later Production release

After the owner's explicit release approval, this same scoped feature was published and verified on Production. See `docs/vehicle-labels-six-up-production-2026-11-10.md` for the backup, exact source identity, selective migration and staged/live verification evidence. The Not Applied statements above record the earlier Development handoff, not the later release state.
