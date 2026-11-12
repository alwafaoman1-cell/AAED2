# Vehicle intake custody receipt: audit and implementation design

Implementation follow-up: [Development implementation and verification](vehicle-intake-receipt-development-implementation-2026-11-12.md). The paragraph below records the earlier audit stage, before the user authorized implementation.

Date: 2026-11-12. Scope: the user's intake receipt specification. This is an audit/design, **not an implemented feature**. Source inspection and read-only Development queries only; no business-data write, schema migration, Production access, commit, push or deployment was performed. Earlier approved local fixes remain intact.

## Business meaning and separation

The intake form and its actual submitter's electronic signature establish the source evidence. The new **Vehicle Intake Receipt / وصل استلام مركبة** is a distinct custody document tied to that visit and that signed form revision. It is neither an accounting receipt, cash/insurance invoice, claim approval, nor the final vehicle handover receipt (`VH-*`). The final handover keeps recording its own actual recipient and signature; the intake receipt is validated and consumed in the same finalization transaction.

Do not reuse accounting receipt tables/sequences, the customer tracking token, or the expiring one-time intake signature link as a permanent receipt-verification credential.

## Current source and Development findings

| Boundary | Existing implementation | Required change |
|---|---|---|
| Intake route | `/vehicle-entry/:id`, edit route and form editor | Add revision-aware receipt access without duplicating the entry page. |
| Staff signing | `useVehicleEntryEditor.saveSignature` → `saveVehicleEntrySignature` → direct insert into `vehicle_entry_signatures` | Bind signatures to an immutable revision and make retry idempotent; issue the receipt transactionally from the saved delivered-by signature. |
| Customer signing | `/vehicle-entry/sign/:token` → public signature RPCs | Restrict the link to the exact revision, capture the actual signer's identity, reject stale revision links, and atomically save signature + receipt. Preserve the existing one-time signed preview behavior. |
| Signer name | The public page currently defaults from `result.customer.name` | Default from the delivered-by person and use the actual submitted signer as receipt holder, not automatically the vehicle owner/customer. Phone/ID/relationship must belong to that actual signer, not be guessed from another person's customer record. |
| Signed identity | `vehicle_entry_signatures` has role/name/phone/title/image/time and declaration snapshots | Add revision binding and immutable evidence. Do not migrate an old signature image into a new revision. |
| Constraints | Development signature table has primary key, FKs and role/source checks; no per-revision identity and no immutable-signature trigger | Add version-aware uniqueness and database write guards, including protection from direct table updates/deletes. |
| Existing policy | Signature and signature-link RLS uses a broad staff-role `ALL` policy | Independent receipt actions need real backend authorization and append-only audit. UI hiding alone is insufficient. |
| Intake versions | No revision/version field on the inspected entry model and no dedicated signed-entry revision table | Introduce immutable snapshots and an explicit current draft/revision relation; retain earlier signed snapshots. |
| Current PDF | `VehicleEntryDetail` refreshes live entry/settings, then calls `buildVehicleEntryHtml` for preview/print/download | A signed receipt/export must read its frozen revision rather than mutable current entry or vehicle/settings data. Reuse the canonical renderer, not an alternative download layout. |
| Signature time in form | The current signature footer prints arrival date/time below the signature | New revision-aware output must show actual signature time separately from actual arrival time. Existing archived documents are not rewritten. |
| Intake issuance | Existing `issueVehicleEntry` can issue an intake document without an electronic signature for paper workflows | This is not issuance of the proposed electronically signed custody receipt; keep those actions distinct. |
| Delivery | Existing `finalize_vehicle_handover` has signed finalization and visit binding, but no intake receipt validation/consumption | Extend the canonical finalizer atomically; cover work-order, claim, quick-action, supervisor and direct RPC callers. |
| Permissions | Current RBAC has broad Work Orders / Status & delivery; no six independent intake-receipt actions | Add Issue, Print/download, Verify, Deliver, Cancel, History with cloud-backed authorization. |

Source locations: `src/App.tsx`, `src/pages/public/VehicleEntrySignPage.tsx`, `src/hooks/useVehicleEntryEditor.ts`, `src/pages/vehicle-entry/VehicleEntryDetail.tsx`, `src/lib/vehicleEntryService.ts`, `src/lib/vehicleDeliveryReceipt.ts`, `src/components/workorders/VehicleDeliveryReceiptDialog.tsx`, `src/lib/rbac.ts`, `src/components/PdfPreviewDialog.tsx` and the existing signature/hand-over migrations. Live schema findings were independently checked in Development `rrhyglrnlveygyiandhs`; historical migration files were not treated as proof of current schema.

## Proposed cloud model

These are design names, not applied database objects:

1. `vehicle_entry_revisions`: entry/tenant, monotonically increasing revision, immutable signed snapshot, material-data fingerprint, version-specific delivered-by and receiver signature references, created/signed actors and times. Mutable draft preparation is separate from signed evidence. A routine repair-stage/custody update must not manufacture an intake edit or invalidate its receipt.
2. `vehicle_entry_custody_receipts`: tenant/entry/vehicle/revision/signature, unique immutable receipt number, state (`draft`, `issued`, `used`, `cancelled`, `replaced`), verification-token reference, issuance snapshot and issued/cancelled/replaced/used facts. Unique receipt per signed revision/signature and tenant-scoped number. Issue retry returns the same row/number; print/download allocate nothing.
3. Receipt audit events: append-only actor, action, time, receipt/revision/signature, reason and associated final handover. Cover issuance, staff verification, cancellation/replacement, use, denied attempts and permission changes. Do not let a staff `ALL` policy rewrite audit history.
4. Independent permission storage or an authoritative server-side resolver aligned with the existing cloud RBAC settings. Do not store these permissions in accounting tables or LocalStorage; do not infer authorization from user-editable metadata. Role grants must be deliberate and enforced by server functions and RLS.

No backfill should mint receipts from an unsigned record, repair a signature by copying pixels, silently attribute identity, or rewrite a finalized handover.

## Issuance and edits

- Signature submission locks the entry/revision, validates freshness and consent, saves the actual signer's evidence and creates/returns the receipt in one database transaction. A receipt for an issued document cannot outlive a failed signature write.
- The receipt's person is the delivered-by signer, even when that person differs from the customer or owner. Preserve the actual signer and their supplied optional phone/ID/relationship in the immutable snapshot.
- Preserve form contents and linked references as known at issuance. Later operational links must not silently change what an earlier person signed.
- Signed entry edits create a new draft revision. Display old signed revisions as read-only and require a new signature for the new revision. Old signature links are bound to the old revision and cannot sign the new one.
- Material identity/date corrections invalidate the older active receipt with a recorded reason. Routine stage, custody, accounting status or access timestamps do not count as an edited intake document.
- Material fields need an explicit business policy: vehicle identity/plate/country/VIN, delivered-by identity, visit/arrival facts and signed declaration are clear candidates. Changes to operational links or optional notes should not accidentally block an otherwise valid workshop workflow.
- The old snapshot, signature, PDF and cancellation/replacement history remain accessible with history permission. `used` is never reset to `issued`; cancelling a final handover does not make the consumed intake receipt reusable.

## Verification, QR and atomic use

- Provide manual receipt-number input plus camera QR scanning in the existing delivery dialog. Use the existing scanner/device permission patterns; number entry remains available without camera access.
- QR identifies this receipt using an unpredictable verification credential. Do not encode phone, ID or VIN directly in the QR, and do not create another public vehicle-tracking page.
- Public document verification, if included, returns minimal authenticity/status information. Full signer/vehicle/identity details and final use require staff authentication and their independent permissions. Possession of a QR alone cannot authorize delivery.
- Verification checks tenant, vehicle, visit, signed revision and receipt state; show the holder separately from the actual handover recipient. Do not invent a rule requiring the actual recipient to be the original holder: the user's specification requires recording the actual recipient.
- Verification is not consumption. The canonical finalizer locks receipt, visit and handover, rechecks all facts, verifies the normal handover signature/recipient, finalizes the existing handover, records actual time and staff user, and marks the receipt used **in one transaction**. A failed handover leaves the receipt unconsumed.
- Concurrent use attempts must have one winner. A retry for the same already finalized handover returns that same result; a second handover/visit cannot consume the receipt. Cancellation/replacement between verification and confirmation must be detected.

## PDF and print design

- Three explicit export choices: receipt alone; intake form alone; combined intake + receipt in one PDF.
- Print both documents from the same immutable revision and original saved signature. Include tenant branding/logo/stamp, signer facts, entry facts, actual signature time, unique receipt/entry references and verification QR.
- Preview, print and downloaded PDF use the same prepared HTML/pages and language selection. English labels/statuses/templates must be English-only; Arabic supports RTL. Never translate or invent a person's identity.
- Measure content before choosing the combined layout. Use one A4 page only when the contents, photos, QR and signature remain readable without cropping or aggressive shrinking. Otherwise retain the full form and receipt as two pages in one file. No blank trailing page, truncated notes or omitted signature to force the page count.
- Preserve the originally issued PDF and its signature; current ledger status is verified through the QR instead of rewriting signed source data. Reprint/download does not create another receipt number.

## Delivery of the implementation

1. Cloud foundations and immutable revision/signature/receipt/audit constraints; independent permission checks; synthetic transaction tests before enabling issuance.
2. Revision-aware staff/public signing and automatic idempotent issuance; receipt/detail/history controls and localized errors.
3. Frozen receipt and combined A4 renderer; real preview/download/page-count/RTL/English QA.
4. Receipt lookup/scanning in canonical delivery; atomic consume and concurrency/permission tests; all entry points checked.
5. Full Development cycle with independent readback, archived-evidence hashes, no accounting side effects, full local regression, typecheck/lint/build. No Production activation without an explicit separate release instruction.

Any Development schema application must follow a fresh verified checkpoint and targeted migration/ledger check. Existing signed rows and finalized test receipts remain untouched unless an explicit, narrowly audited migration is required and authorized.

## Acceptance matrix

- Staff signature and public-link signature each issue exactly one receipt for the correct signer/revision. Rapid retry and parallel issue cannot allocate another number.
- Preview/print/download do not create or consume a receipt. Receipt alone and short/long combined exports retain logo/stamp/QR/signature and match preview.
- Both languages; real PDF page rendering, font/RTL checks and actual exported-page count, including long names/notes and no blank page.
- Signed edit keeps old evidence byte-identical, rejects stale link/save, requires a new signature, and invalidates/supersedes only according to material-change policy.
- Reject wrong tenant, vehicle, visit, inactive/cancelled/replaced/used receipt and missing permission, including direct RPC/table-write attempts.
- Verification without delivery never consumes. Failed finalization rolls back consumption. Concurrent consumption has one winner; finalizer retry adds no receipt/handover/use event.
- Actual recipient, staff deliverer and timestamps saved; used receipt cannot be reused or silently revived. Finalized evidence and audit are protected.
- Original claims/invoices/cash/accounting remain separated; all prior finalized receipts/signatures remain unchanged.

## Approved business decision: old visits

The user approved the following policy on 2026-11-12:

- Require the receipt for new visits. A visit already present at activation can use a separate, permission-controlled legacy exception with a clear reason, employee and time in the audit log.

Do not manufacture old signatures or backdated receipts. Implementation and testing are authorized in Development only; commit, push, Production changes and deployment remain prohibited.
