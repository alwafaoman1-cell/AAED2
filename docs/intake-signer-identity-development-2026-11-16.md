# Actual intake deliverer identity — Development, 2026-11-16

The customer signing link now requires the actual vehicle deliverer's full name and ID card number. The intake signer is separate from the vehicle owner and the final delivery recipient. This change is implemented and tested in Development only; no commit, push or Production deployment was performed.

## Behavior and persistence

- Intake-only required name/ID fields use the canonical `vehicle_entries.delivered_by.full_name` and `id_number`, rather than defaulting to the customer owner's name. IDs remain strings, preserve leading zeros and letters, and normalize Arabic/Persian digits. No country-specific number format is imposed.
- Editing either identity field clears the pending ink and consent. Locking the portal, changing its URL or moving to another material revision discards the in-memory draft. No identity draft is persisted in browser storage.
- One session-authorized RPC locks the expected unsigned intake and finalizes the identity before creating its signing link. Normal material-change triggers may advance the revision once. Signature insertion then freezes that exact version and issues its receipt in the same transaction. Any failure rolls the whole operation back.
- UI success requires a fresh read matching the returned revision, signature ID, receipt ID/number, frozen-document flag, signer identity and frozen canonical deliverer identity. A successful toast alone cannot confirm the save.
- Exact retries are bound to the original requested revision and immutable portal audit, returning the same signature/receipt. Changed identity or ink cannot rewrite an already-signed form. The old seven-argument endpoint fails closed without the required ID.
- If the actual person differs, another person's phone/relationship are cleared from the new version instead of being attributed to the new signer. Matching confirmed identity retains contact details. Arrival mode/towing details, owner records, financial records and final handovers retain their existing behavior.
- Both the intake form and receipt already render canonical frozen identity; their existing protections against mismatched historical identity remain. Staff detail now shows the ID, and staff/supervisor printing share the frozen source. Receipt/history refreshes follow intake/signature events without overwriting dirty staff drafts.

## Changed files

- `src/pages/public/UnifiedVehicleCustomerPortal.tsx`, `src/lib/unifiedVehiclePortal.ts`, `src/lib/intakeSignerIdentity.ts`: required fields, normalized identity, exact signature/receipt readback and bilingual messages.
- `src/pages/vehicle-entry/VehicleEntryDetail.tsx`, `src/pages/apps/SupervisorEntryWorkspace.tsx`, `src/lib/vehicleEntryPrintSource.ts`, `src/hooks/useRealtimeSync.ts`: staff display, frozen printing and refresh dependencies.
- `supabase/migrations/20261116065641_vehicle_portal_actual_deliverer_identity.sql`: required-ID RPC, private normalization helpers, frozen identity projection and safe retry/audit handling; no data backfill or trigger bypass.
- Portal API/UI, normalization, frozen-print, PDF-source and realtime contract/behavior tests cover the corresponding changes.

## Verified results

- Fresh exact-lockfile suite: **2,095 passed, zero failed, six optional skips**. Typecheck, lint and fresh build passed. Final source snapshot: `459df4b023ba86332b107d85038491efa5fcdafa0a0f7f05c07e523716177047`.
- **32 WebKit checks passed** across Arabic/English and 390/834px: plate gate, actual canvas, required identity, consent reset, mismatched readback, privacy, responsive layout and real preview/download controls.
- Two actual downloaded combined PDFs, each two nonblank A4 pages, show the same actual deliverer name, zero-preserving ID and signature on both documents. All four pages were rendered and visually inspected. English body output contains no Arabic.
- Development backup: 192 tables / 2,971 rows, encrypted, decrypted and hash verified; 154 business tables restored into typed temporary tables and checked without rewriting originals.
- Candidate and applied-schema regressions ran on Development in rollback-only transactions. Tests cover normalized identity, canonical/frozen agreement, exact retries, invalid/stale/missing inputs, preservation of old signatures and atomic rollback after a late audit failure.
- Official CLI applied only version **20261116065641** to **rrhyglrnlveygyiandhs**. No bulk database push or manual ledger edit. The ledger now has 318 entries; only three expected helper/overload functions were added and two functions replaced.
- Independent read-only comparison retained **all 2,505 original operational rows across 164 tables exactly**, including existing signatures, frozen revisions, receipts and Storage metadata. Original tables, triggers and policies are unchanged.
- Anonymous Development HTTP checks resolve the new overload and reject invalid sessions; missing ID is rejected through the old overload. No real customer signature or delivery was created for testing.

Private evidence is excluded from Git under `.vercel/intake-signer-identity-20261116/` (backup, schema, persistence and HTTP checks) and `.vercel/intake-signer-identity-development-20261116/` (locked validation, browser and PDF evidence). Initial obsolete-contract and narrow-screen failures remain recorded; the final checks passed after their bounded fixes.

## Boundaries

Browser transport used synthetic Supabase responses; separate Development SQL/HTTP checks verify the database path. Tests emulate WebKit phones/tablets, not physical devices. Historical signed documents are not retrofitted with new identities. Production still uses the previously published version; publishing this feature requires the application and its reviewed migration together in a separately authorized release.
