# Vehicle visit reconciliation — 9 November 2026

Status: applied and verified on https://aaed-2.vercel.app.

## Authorized correction

Only WO-I-26-0045 / ENT-2026-0061 was reconciled. The owner confirmed that the November entry date was incorrect, that this was the original visit rather than a return, and that the correct arrival date was 21 June 2026 with no known arrival time.

The existing signed, finalized VH-2026-00034 establishes delivery on 24 September 2026. Its missing entry association and missing work-order/claim entry backlinks prevented the visit center from accepting it as delivery evidence. The entry creation had also reset custody and order status to received/in-workshop despite the historical delivery dates.

The correction was atomic: confirmed arrival date, date-only precision, canonical entry links, delivered operational status and customer custody, one appended correction event and one before/after audit record. The event records when the correction was made and explicitly states the historical arrival and delivery dates; it is not a new physical delivery. Existing timeline records remain untouched. The original creation timestamp and old stored clock are retained; the latter is not presented as an observed arrival time. Incorrect receipt timestamps were cleared as unknown, with their previous values retained in the audit and encrypted checkpoint.

The signed handover's contents, signature, snapshot, receipt number and historical delivery/finalization timestamps were not changed. No new handover was issued. Claim financial status remains approved, not paid. Invoice, expense, journal, vehicle/owner, signature and sequence fingerprints were unchanged. Unrelated entry/order/claim/handover rows were unchanged. No bulk historical candidates were linked or repaired.

## Selective release files

- `src/lib/vehicleEntryArrival.ts`: localized date-only time display.
- `src/lib/vehicleEntryService.ts`: the same arrival precision in preview/print/PDF templates.
- `src/pages/vehicle-entry/VehicleEntryList.tsx`: center list, cards and Excel use the shared formatter.
- `src/pages/vehicle-entry/VehicleEntryDetail.tsx`: no fabricated arrival clock.
- `src/pages/apps/SupervisorEntryWorkspace.tsx`: same display in the supervisor workspace.
- `src/components/vehicle-entry/VehicleEntryIdentityStep.tsx`: unknown time is not prefilled as observed; entering a known time explicitly changes precision.
- `src/test/vehicle-entry-arrival-precision.test.ts`: three regression tests.
- `supabase/migrations/20261109045840_legacy_handover_entry_metadata_guard.sql`: an audited, postgres-only legacy NULL-to-entry association. All signed fields remain immutable. Existing function ownership, ACL and trigger bindings are preserved; no public repair RPC was added.

The previously published stage-filter, paper/electronic temporary release and Ready-to-handover controls were retained, not rebuilt. Both signature choices and the required paper attestation remain accessible.

## Verification

- Development synthetic SQL rehearsal and transaction rollback passed; stale retry produced no duplicate audit or records. Authenticated browser-role metadata writes were denied. Signed-content, unrelated-data and financial invariants passed.
- The migration was recorded by the official CLI on Development and Production using isolated mirrors of their respective applied ledgers. Exactly one pending migration was applied. No blanket `db push` or manual ledger rewrite.
- Development and staged Production full typecheck, lint, tests and production build passed: **1772 total, 1766 passed, 0 failed, 6 existing skips**.
- Real Development browser checks: delivered tab, date-only arrival, detail readback, printable preview and actual PDF download (584,644 bytes, valid PDF header). Desktop/tablet/mobile widths 1366/834/390 had no horizontal overflow.
- Read-only authenticated browser checks passed on both the staged Production deployment and the live primary URL. Corrected visit appears in Delivered, not In workshop or temporary With customer. WO-I-26-0103 still opens the existing final handover from Ready; temporary paper/electronic release still opens with attestation required. **Operational browser writes 0; HTTP errors 0; console errors 0; page errors 0.** Sessions were revoked after verification. Vercel's optional Preview feedback toolbar was excluded from application testing; no application request was suppressed.
- Paper/electronic temporary exit, return, tenant isolation, stale/future-time rejection and retry tests were rerun for synthetic cash and insurance visits on Development.
- Fresh completed physical backup: **2207033078**, created **2026-11-08T21:56:51.699Z**, age 7.31 hours at checkpoint. Target before-images, original guard and history were encrypted locally with DPAPI and decryption-verified. A full physical restore was not performed. No Storage files were copied or deleted.

Browser tests use WebKit on Windows; they are not a physical iPhone/iPad certification. No real customer delivery, signature or financial save was performed during Production browser testing.

## Release identity

- Production deployment: `dpl_J8BYy1AearPVT4796UpKt8RTf4sJ`.
- Staged URL: https://aaed-2-51sad7tlq-alwafaoman1-cells-projects.vercel.app.
- Production source digest: `bc7299840a162ddb0ffcfccb2d247a121baa92b901f0db980b8b67fef095eb0b`.
- Previous deployment: `dpl_71Z5CXHwkKbwQ8kfVrSE9GASnyZp`.
- Source base: `bcc4b64469651614bef484df76c0a74845ac64b9`. No new Git commit, push or main merge was made. Only the eight listed files were overlaid on the frozen live source; unrelated local changes were excluded.
- OCR Worker remains ready with one replica and the unchanged pinned image digest `82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`.

Private evidence is retained under `.vercel/legacy-visit-*` and `.vercel/legacy-migration-*`; it is excluded from Git and public release artifacts. No pending issue was found within this correction's verified scope. This report does not certify unrelated project work or the six skipped tests.
