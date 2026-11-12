# Vehicle intake receipt — Development implementation, 2026-11-12

Scope: Development project `rrhyglrnlveygyiandhs` only. No Production connection, commit, push or deployment. Current checkout is `claim-entry-hotfix-production/alwafa-auto-pro-main`, branch `codex/finance-security-development`. Its other uncommitted work is preserved.

## Implemented behavior

- Existing entries at cutover are marked legacy. Every later INSERT is receipt-required; the database ignores attempts to downgrade this flag or choose a revision number.
- A delivered-by signature atomically freezes the intake revision and issues one custody receipt. Staff and public-link signing are both revision-bound. Concurrent retries return one signature/receipt. A signature from an old revision is never copied into a new one.
- Signed revisions include the entry snapshots, damage marks, image references, technical declaration, available claim/order numbers, receiving employee, original signature and company print settings. Existing evidence remains untouched. Legacy electronic signatures remain visible on their original revision and are not converted into new receipts.
- Material intake changes advance the revision and replace its active receipt. Operational bay/location, repair/accounting updates and arrival-confirmation metadata are separate. The canonical save RPC compares damage contents before rewriting them, so an unchanged damage map does not invalidate a signed form.
- Before a pre-cutover signed form is first edited (including its damage/technical/photo children), its current original model and old signatures are frozen as an explicitly labelled legacy baseline. An unknown old signing time stays null. This does not reconstruct past edits or create a retrospective receipt. The preserved form can be opened from audit history with Print permission; its new revision needs fresh ink.
- Receipts are separate from accounting receipts, insurance invoices, cash invoices and `VH` exit handovers. Number format is `VIR-<entry number>-R<revision>`; printing/downloading/retrieving never allocates another number.
- Verification accepts a receipt number or QR URL and validates tenant, visit, vehicle, revision and issued state. QR verification requires authenticated staff access and creates no new public tracking page.
- The same canonical handover finalization transaction locks and consumes the receipt, records the actual recipient, staff user and delivery time, and appends its use audit. Any later failure rolls back consumption. Retry is idempotent; a used/cancelled/replaced receipt cannot authorize another delivery.
- Alternative direct exit projections on work orders, claims and entries cannot bypass the finalizer. A legacy exception is allowed only for a pre-cutover entry, a separately authorized user and a clear reason. It records the reason, actor, time, actual recipient and handover without fabricating a signature or intake receipt.
- Separate cloud-backed permission keys cover Issue, Print, Verify, Deliver, Cancel, History and Legacy exception. Backend checks active/enabled staff and tenant, independently of UI controls. Existing work-order role restrictions also continue to apply.
- Cancelled/finalized signatures, signed intake snapshots and audit events cannot be edited or deleted through application roles. Finalized handover protections remain in force.
- Receipt preview/download/print uses the canonical PDF dialog. The standalone receipt is one A4 page. The existing complete intake form needs a full sheet, so its combined export is one PDF of two pages, preserving legible text and the same intake signature on both documents. Configured company logo/stamp are supported; unconfigured assets are not invented.
- Public signing defaults to the actual delivered-by name, never an unrelated customer's name. Phone/identity/relationship are omitted from the receipt when they cannot be attributed to its actual signer. Public signing retains its existing temporary-preview policy.

## Files

Database:

- `supabase/migrations/20261112094812_vehicle_intake_custody_receipts.sql`
- `supabase/migrations/20261112100850_vehicle_intake_receipt_evidence_hardening.sql`
- `supabase/migrations/20261112102925_preserve_legacy_signed_intake_before_edit.sql`
- `supabase/migrations/20261112104710_enforce_intake_evidence_tenant_boundaries.sql`

All four files were initially created with `supabase migration new`. Their local version prefixes were aligned to the actual Development ledger versions returned by the targeted migration tool, avoiding duplicate pending migrations.

Application:

- `src/lib/vehicleIntakeReceipt.ts`, `src/lib/vehicleIntakeReceiptErrors.ts`: receipt RPCs, reference parsing, shared localized errors and frozen PDF generation.
- `src/lib/vehicleEntryService.ts`, `src/hooks/useVehicleEntryEditor.ts`: revision-aware staff signing, dirty-form guard, current-revision signatures and actual signing time in print output.
- `src/lib/vehicleEntryOneTimePreview.ts`, `src/pages/public/VehicleEntrySignPage.tsx`: actual public signer default and signing time in temporary preview.
- `src/components/vehicle-entry/VehicleIntakeReceiptPanel.tsx`: receipt list, preview/print/download, cancellation and history.
- `src/components/vehicle-entry/VehicleIntakeReceiptCheck.tsx`, `VehicleIntakeReceiptForOrder.tsx`: number/QR verification, holder/vehicle display and legacy-reason control.
- `src/components/vehicle-entry/VehicleEntryReviewStep.tsx`: preserve and show current signatures; save edits before signing.
- `src/lib/vehicleDeliveryReceipt.ts`, `src/components/workorders/VehicleDeliveryReceiptDialog.tsx`: persist receipt/exception reference in the handover draft and use the canonical finalizer.
- `src/pages/vehicle-entry/VehicleEntryDetail.tsx`, `VehicleIntakeReceiptVerifyPage.tsx`, `src/App.tsx`: receipt actions and authenticated QR verification route.
- `src/lib/rbac.ts`, `src/i18n/autoDictionary.ts`: independent permission rows and English action coverage.
- `src/components/PdfPreviewDialog.tsx`, `src/components/AutoBreadcrumb.tsx`: English fit label and the verification breadcrumb without a nonexistent intermediate link.

Tests: `vehicle-intake-receipt.test.ts`, `vehicle-intake-receipt-check.test.tsx`, `vehicle-intake-signature-revision.test.ts`; existing intake PDF/sign-preview/contract/draft-loading tests updated for the new behavior.

## Backups and preservation

Private Development-only tooling and encrypted checkpoints are under ignored `.vercel/`; credentials are obtained privately and never printed. There is no Production mode.

- Before the base migration: encrypted checkpoint, 12 related tables, typed restore into temporary tables verified.
- Before evidence hardening: checkpoint also includes the three new receipt/evidence tables; 15-table typed restore verified. Private backup: `.vercel/intake-receipt-before-hardening.dpapi`.
- Preservation check compared original business records in the pre-apply checkpoint against current rows. PASS for 33 entries, 14 handovers, 33 workflows, 116 transitions, 60 work orders, 32 claims, 85 entry audit records and 7 profiles. All existing configuration values and original audit events in the 10 tenant-setting rows remain preserved; the authorized test closing review appended one event to this Development tenant's cloud audit log (2 → 3), advancing that log row's version/time. The other tenants' audit arrays are unchanged. There were no intake signatures/signature links/damage marks in the original Development checkpoint. This does not claim a full physical database restore.

## Verification evidence

- SQL migration rehearsals executed in transactions and rolled back before targeted Development application.
- Actual applied database tests cover automatic issue, staff/public retries, frozen snapshot preservation, stale revision/link rejection, signature update/delete rejection, wrong visit, used receipt, new-visit exception denial, documented legacy use, direct exit bypass, anonymous/direct-table/private-helper denial, disabled/missing accounts, separate staff permissions and late-failure rollback.
- Parallel signing returns the same signature. Parallel finalization of the same draft returns the same finalized result with exactly one use audit. The existing one-draft-per-order constraint also prevents parallel independent drafts; subsequent new-draft receipt reuse is rejected.
- Full suite: **303 files passed, 3 files skipped; 1883 tests passed, 6 tests skipped, zero failures**, exit 0, 223.24 seconds. Existing skipped cases require opt-in OCR/private/SQL-parity runtime environments; they are not counted as passed.
- After the final breadcrumb/English-label polish: **41 targeted tests in 9 files passed**, zero failures. Full TypeScript build-mode typecheck, scoped lint of affected files, and a fresh Development-targeted Vite build passed. Existing chunk-size warnings are not represented as failures or release readiness.
- Applied-database rollback regression passed after the evidence/legacy migrations, including cancelled receipt non-reissue and legacy signed-model preservation before parent/child edits. The final tenant-boundary migration was rehearsed against the full regression and separately verified after application: cross-tenant damage/technical links are rejected before privileged archive access, while same-tenant signing and automatic issue still work. The signature boundary also explicitly verifies vehicle tenant ownership. All test writes were rolled back; original business rows were preserved.
- Ledger proof confirms exactly the four intended Development migrations were added and each applied SQL payload matches its local migration file. Production was not queried or changed.
- Logs/proofs: `.vercel/intake-receipt-*-proof.json`, `intake-receipt-full-suite-final.log`, `intake-receipt-final-targeted.log`, `intake-receipt-typecheck.log`, `intake-receipt-lint-final.log`, `intake-receipt-build.log`.

## Security advisor review

The Development advisor reports three additional INFO notices for RLS tables without direct policies and ten additional WARN notices for authenticated SECURITY DEFINER RPCs. These are intentional RPC-only tables/functions: table privileges and private helper execution are revoked, each public RPC checks active staff/tenant/action, and anonymous access is denied. These notices are not represented as a clean advisor result. Existing unrelated notices remain outside this change. Reference: https://supabase.com/docs/guides/database/database-linter

## Boundaries

- No real customer communication, invoice, payment, vehicle repair or physical delivery is performed. Test identities and signatures are explicitly fictional.
- Follow-up verification now covers actual QR image decoding, invalid-image rejection, server verification and the complete receipt-to-delivery cycle on a new fictional visit. The real camera request remained pending in the in-app browser; its timeout/fallback is verified, while physical capture/live optical scanning remains unverified.
- Follow-up diagnosis confirmed that the photo function is deployed (Development version 5), with a CORS origin mismatch and missing intake-revision binding. The corrected shared handler runs locally against Development and successfully displayed a real Storage image in the public signing page. The hosted function was not deployed or modified. See [the follow-up report](signature-media-qr-development-verification-2026-11-12.md) for exact boundaries and evidence.
- Combined output deliberately uses two A4 pages because the existing complete intake form fills one page. Extreme user-entered content may need further pages rather than clipping or shrinking signed evidence.
- This is Development verification, not Production release approval.

## Persisted live cycle and exported documents

Fictional test visit: `TEST-8c40957446`, entry `fb651219-2470-4920-beeb-853af259a5b6`; insurance work order `WO-I-26-0006`; claim `TEST-RECEIPT-9ef84f2`.

The real local UI was used to sign the intake through its customer link, approve the claim for one test OMR, enter work in progress, complete the work order and finalize delivery. A first attempt without an intake receipt left a cloud handover draft and the visit ready; the receipt stayed issued. After verification, that same draft finalized as `VH-2026-00004`, the receipt `VIR-TEST-8c40957446-R1` became used once, and the visit reached delivered/revision 4 without review. The actual recipient differs from the intake signer and both identities are retained. Insurance and cash invoice counts are zero; claim remains approved and financially open.

Proof: `.vercel/intake-receipt-live-proof.json`. It also compares every pre-hardening signed revision/signature/handover against current rows and confirms preservation. Fictional test/race records are retained for review; no existing business record was reused for delivery testing.

Actual app-generated PDFs were downloaded, inspected with `pdfinfo`, rendered with Poppler and visually reviewed:

- `output/pdf/intake-receipt-ar-development.pdf`: one A4 page.
- `output/pdf/intake-form-and-receipt-ar-development.pdf`: two A4 pages.
- `output/pdf/intake-receipt-en-development.pdf`: one A4 page.
- `output/pdf/intake-form-and-receipt-en-development.pdf`: two A4 pages.

The English document body contains no Arabic. In the combined preview, both signature image sources are identical. The PDF page count matches its preview, with no blank page or cropped signature in these fixtures. Native printer hardware/output is not claimed tested.

The authenticated QR route was opened with this receipt's real verification credential after delivery and displayed the rejection for an already used receipt. Screenshot: `output/vehicle-intake-qr-used-denied.png`. Final Arabic review page (receipt used, visit delivered): `output/vehicle-intake-receipt-development-final.png`. The local review tab is left open at `http://127.0.0.1:5194/vehicle-entry/fb651219-2470-4920-beeb-853af259a5b6`.
