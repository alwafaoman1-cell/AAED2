# Intake portal Production release — 16 November 2026

The intake identity, signed-document and vehicle-condition changes are published
at https://aaed-2.vercel.app. The offline completion gate passed at
**2026-11-16 16:35:38 UTC / 20:35:38 Asia/Muscat**, after Production data
preservation, live assets, browser flows and PDF inspection all passed.

| Release identity | Value |
| --- | --- |
| Application commit | `ad791faa61777938a6cdc5414b661cdea6d94f9d` |
| Branch | `codex/finance-security-development` |
| Production deployment | `dpl_FRFVduS1udwyTzqo7AU9vsekrnqy` |
| Deployment source digest | `dfd36337b87ee05eb05ded7f679d78f3927a606e36424482cdd5ca2ee34b70d0` |
| Exact-lock validation digest | `c214ad41c509a897ae866c13afaacf5eb53ecb4f1c467a3a2f43ae6df7a77625` |
| Reviewed 27-file scope digest | `9f4475149c7ba68823c1ee94d4e04598a87db3730c3d86c14faa43e6e0efdb03` |
| Previous application deployment | `dpl_GG1iiFqzA8xSCjQh59tJEnZUmbgj` |
| Production Supabase project | `ifnfwssdtjuzdtshnrht` |

Promotion and static live verification completed at 16:32:28 UTC. This report
describes the application commit above. A documentation-only follow-up commit
and its Git proof are recorded separately; they do not change the deployed app.

## Resulting behavior

The customer enters the actual intake deliverer's name and ID before signing.
The server validates and saves that identity in the same transaction that signs
the correct intake revision, freezes its document and issues its receipt. The
UI reports success only after reading back the exact revision, signature,
receipt, name and ID. Exact retries return the same saved result; a changed
identity or signature cannot rewrite an already signed form.

The identity update uses the normal material-revision trigger and can advance
the revision once before signing. It does not overwrite the vehicle owner or
final handover recipient. If the signer is a different person, unconfirmed
contact/relation details are cleared rather than attributed to that person.
Historical signatures, signed revisions and receipts are not backfilled or
copied to a new revision. Unversioned legacy ink retains its existing historical
handling without fabricating a new signed revision or receipt.

Versioned signed staff print paths now require the frozen signed entry; a failed
frozen-document fetch cannot fall back to mutable live data. Both intake and
receipt show the saved odometer, including zero, and **vehicle location at
intake**. Historical missing values remain explicitly unrecorded. Current
vehicle custody cannot fill gaps in an older signed snapshot.

The global Arabic/Persian digit guard now uses the native input/textarea setter
so the original event reaches controlled React state once. Leading zeros,
letters and selection are retained. Editing identity consequently clears the
previous ink and consent through the existing form handler. The new-damage
question is shown for linked review visits, and missing initial running status
uses neutral wording. Staff signature/receipt refreshes preserve dirty-editor
protection. Claim, approval, financial and invoice rules are unchanged.

## Backup and exact preservation

Before applying the two migrations, a fresh encrypted backup captured
**193 tables / 25,123 rows** at 19:59:27 Asia/Muscat. **155 business tables** were
restored into typed temporary tables and verified. The provider's completed
physical backup was also recorded: ID **2276871779**, timestamp
**2026-11-15T22:00:53.389Z**. A full physical Production restore was not exercised.

The Storage backup contains **674 objects / 350,016,741 bytes**. Every object,
the database export, Storage manifest and prior Edge source were decrypted and
hash-verified. The promotion guard rehashed all **677 encrypted artifacts** and
bound their ciphertext hashes to the verified plaintext hashes. Private backups,
credentials and raw business data remain outside Git and the application export.

The DDL rehearsal verified the full 193-table/25,123-row footprint and sequences
unchanged, matched the six affected function definitions/owners/effective grants/
search paths to tested Development, and rolled back schema and data exactly.

After promotion, the independent preservation check passed at **20:32:43
Asia/Muscat** against that same encrypted baseline:

- All **193 tables / 25,123 original rows** remain exact, with zero missing or
  changed original rows. The only authorized ledger append is the two versions
  listed below. No business rows were restored or overwritten.
- Protected evidence remains exact: **28 intake signatures, 4 signed revisions,
  4 custody receipts, 90 protected signed/finalized/cancelled handovers, 662 media rows, 155 damage marks,
  11 custody audit rows, 11 Storage buckets and 674 Storage object records**.
- The previous migration ledger is preserved, the catalogue matches rehearsal,
  and the six affected functions match Development. Verification created no
  Production signature, receipt, visit, handover or business fixture.

## Schema and services

Only these two migrations were applied, in order. Production's migration ledger
now contains **258 entries**; the six affected functions match the rehearsed
definitions, ownership, effective grants and search paths.

| Migration | Reviewed source SHA-256 |
| --- | --- |
| `20261116065641_vehicle_portal_actual_deliverer_identity.sql` | `3a0639a66b9ab0c9ab79a8e76b055775b3f8c465d82c49c951dccf37d8539551` |
| `20261116073742_vehicle_intake_frozen_location_projection.sql` | `9ad147ad40c0b48396abc002301eafbc61c0ebaabc659d7b0177baecd935e698` |

The fast SQL denial probe covered **only the old seven-argument signing
overload**, under `SET LOCAL ROLE anon` in an enforced read-only transaction. It
returned `PORTAL_SIGNER_ID_REQUIRED`. It did not prove the other session gates
over SQL: their portal access helper uses `SELECT FOR SHARE`.

A separate real anonymous **HTTP/PostgREST** check exercised all four invalid
requests: read, document, old seven-argument sign and new eight-argument sign.
All returned HTTP 400 / `P0001`; the old overload returned
`PORTAL_SIGNER_ID_REQUIRED`, and the other three returned
`PORTAL_ACCESS_REQUIRED`. Both overloads were recognized by the schema cache;
there was no `PGRST202`. These invalid-token checks created zero sessions or
signatures and performed no business writes.

No Edge Function was deployed. `vehicle-entry-signature-media` remains version
**7**, with its source, metadata and JWT verification configuration unchanged.
The document OCR worker remains **ready, 1/1/1 ready/total/desired**, on the same
image digest:
`82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`.

## Validation and its limits

- Exact-lock local QA and the Production cloud build each passed **2,145 tests,
  zero failed, six optional skipped**, plus typecheck, lint and build. The new
  runtime regression file adds eight controlled-React cases for Arabic/Persian
  ID and plate digits, leading zeros, caret, textarea, ASCII and duplicate-event/
  installation behavior.
- The actual compiled full application passed **38 WebKit checks locally, 38 on
  staged assets and 38 on live assets**, in Arabic/English at 390/834 pixels.
  This covers the global startup normalizer, identity edits clearing ink/consent,
  the eight-argument contract, exact read-back, lock cleanup, responsiveness,
  preview and real PDF downloads.
- All **56 live compiled assets** match the tested staged bytes. The main asset
  is `/assets/index-DsNpV86N.js`, SHA-256
  `1fd974efb0ecbb330eb7df74d89e539dfcd664d4da0889a7642a96b3cf8136eb`.
  Seven SPA routes returned the same app shell with `max-age=0, must-revalidate`.
  `/`, `/index.html` and `/sw.js` retain `no-store`; the camera policy is retained.
- Staged and live each produced **two actual combined PDFs / four nonblank A4
  pages**, all visually reviewed. Each intake and receipt shows the matching
  synthetic identity, signature, zero odometer and saved location. The English
  body is Arabic-free. Each PDF matches its own phase's actual-download hash;
  staged/live binary hashes can differ because their QR origins differ.
- Compiled browser requests used **synthetic backend responses**: zero real
  Production business requests were forwarded and no Production fixtures or
  signatures were created. Actual save/freeze/receipt/handover regression tests
  ran in **Development**. Production evidence consists of the real schema,
  HTTP-denial, preservation, asset and service checks described above; it does
  not claim a real customer's successful Production signing transaction.
- Mobile WebKit emulation was used. A physical phone or printer was not tested.

## The 27 changed files

| Group | Files |
| --- | --- |
| Canonical identity/API and digit runtime — 3 | `src/lib/intakeSignerIdentity.ts`; `src/lib/unifiedVehiclePortal.ts`; `src/lib/formatters/englishDigitsRuntime.ts` |
| Signed print source and intake/receipt presentation — 4 | `src/lib/vehicleEntryPrintSource.ts`; `src/lib/vehicleIntakePresentation.ts`; `src/lib/vehicleEntryService.ts`; `src/lib/vehicleIntakeReceipt.ts` |
| Editor and refresh — 2 | `src/hooks/useVehicleEntryEditor.ts`; `src/hooks/useRealtimeSync.ts` |
| Customer and staff consumers — 3 | `src/pages/public/UnifiedVehicleCustomerPortal.tsx`; `src/pages/vehicle-entry/VehicleEntryDetail.tsx`; `src/pages/apps/SupervisorEntryWorkspace.tsx` |
| Identity, portal and runtime tests — 4 | `src/test/intake-signer-identity.test.ts`; `src/test/unified-vehicle-portal-api.test.ts`; `src/test/unified-vehicle-portal-access.test.tsx`; `src/test/english-digits-runtime-react.test.tsx` |
| Refresh, editor and print tests — 7 | `src/test/realtime-visibility-reconciliation.test.tsx`; `src/test/vehicle-entry-contract.test.ts`; `src/test/vehicle-intake-editor.test.tsx`; `src/test/vehicle-entry-print-source.test.ts`; `src/test/vehicle-entry-pdf-download.test.ts`; `src/test/vehicle-intake-presentation.test.ts`; `src/test/vehicle-running-status-print.test.ts` |
| Migrations — 2 | `supabase/migrations/20261116065641_vehicle_portal_actual_deliverer_identity.sql`; `supabase/migrations/20261116073742_vehicle_intake_frozen_location_projection.sql` |
| Earlier Development evidence reports — 2 | `docs/intake-signer-identity-development-2026-11-16.md`; `docs/intake-condition-location-development-2026-11-16.md` |

## Client compatibility and recovery

Customers with an old cached page must **reload** before signing. The old
seven-argument RPC deliberately fails closed; the new app supplies the required
ID through the eight-argument overload. **An application-only rollback does not
restore old signing.** Recovery needs a separately reviewed forward fix or plan;
do not weaken the ID gate or transfer historical ink to a new revision.

Private evidence is retained under
`.vercel/intake-portal-production-release-20261116/`. The final
`completion-proof.json` binds the backup, source, QA, schema, HTTP, promotion,
preservation, live-browser and PDF proofs. Its `releaseComplete: true` supersedes
the earlier promotion receipt's correctly recorded pending-preservation state.
