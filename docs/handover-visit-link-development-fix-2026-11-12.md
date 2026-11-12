# Handover/visit binding: Development repair — 2026-11-12

Subsequent full-suite and fresh persisted approval-to-delivery verification: see [the comprehensive verification report](vehicle-cycle-full-verification-2026-11-12.md). It also documents the additional local delivery-time fix discovered by that live test.

Status: **applied and verified in Development only** (`rrhyglrnlveygyiandhs`). This resolves the association failure reproduced in `vehicle-center-interactive-development-test-2026-11-12.md`. No Production project was read or modified; no commit, push, remote change, web deployment or bulk historical repair was performed.

## Result

The original finalized `VH-2026-00001` (`9b33fa4d-5f75-414f-b243-6946048bf705`) now names visit `TEST-VISIT-20261102` (`bfe7ae3e-757c-475f-a5bc-1cdf0b8176a9`). Its order and claim backlinks name the same visit. The workflow is `delivered`, revision **4**, review reason null; physical custody is with the customer. The receipt remains finalized and read-only. There is still exactly one handover, plus exactly one audited correction and one appended visit transition. This is an association correction, not a new physical delivery.

The signed row was compared before/after excluding only `vehicle_entry_id`, `updated_at`, and `updated_by`: every other field was equal, including receipt number, signature image, declaration, snapshot, delivery date, finalization date and finalizing user. Signature SHA-256: `80f499a92f132ddcb5ba3064c70776229daa35d59338af67c60f919c91e63693`. Original finalized timestamp: `2026-11-12T07:39:33.838978+00:00`. Approval remains approved / 1 OMR, not paid. Arrival facts and financial records were not changed.

## Root-cause prevention

Migration `supabase/migrations/20261112080726_bind_handover_visit_before_finalization.sql` adds a trigger at the database write boundary, protecting all application clients:

- Resolve only explicit order/visit references: a supplied visit ID, an order backlink, or the visit's direct/converted order ID. Do not infer from plate, customer or claim history alone.
- Lock and verify the unique same-tenant visit against the order, vehicle, customer and insurance claim/channel. Reject contradictory, ambiguous, missing explicit, cancelled or temporally incompatible references.
- Fill only missing order/claim backlinks; persist the verified visit ID on the draft and append an audit when binding is necessary. Check again when the draft becomes finalized. Existing finalization triggers can then update custody and workflow from real linked evidence.
- Preserve standalone legacy orders that have no visit references. Do not manufacture an entry or mix cash and insurance.
- Require an active, enabled staff profile in the same tenant. The helper is security-definer with an empty search path, explicit authorization, and no executable grant to public/anon/authenticated; only its table trigger uses it.

The existing finalized-record metadata maintenance guard remains postgres-only, signed-payload-preserving, tenant-scoped, evidence-checked and audit-required. Its audit-actor role list now also accepts an active manager, matching the existing fictional fixture's manager. This does not promote that account, add a public repair RPC, grant table access, or let an authenticated client override the guard. A definition fingerprint precondition prevents applying the change over an unreviewed guard. Ownership and ACL were retained.

The migration was created with the official CLI and applied through the Supabase migration tool to Development only. The local filename was aligned to the tool's recorded ledger version `20261112080726`; no applied ledger was manually rewritten and no blanket `db push` was used. No finalized data repair is embedded in the migration.

## Scoped correction and checkpoint

The repair script under `.vercel/handover-link-dev.py` has a hard Development-project assertion and no Production mode. It requires a fresh checkpoint and successful rollback rehearsal, locks the exact test rows, rejects stale before-images or inconsistent identity, and uses the existing audited `link_legacy_entry` path. It sets only the missing backlinks and custody facts, then calls the canonical source synchronizer to append the delivered transition. It never cancels/reissues the handover, resets a signature, changes arrival dates, marks the claim paid, or disables triggers.

Before applying anything, the target rows, audit/history, original relevant function/trigger definitions, ledger and unrelated-row fingerprints were captured in a **24,806-byte DPAPI-encrypted checkpoint**. Encryption/decryption round-trip passed. Each saved row was restored into a temporary table with the original typed structure and compared exactly; the temporary restoration transaction was rolled back. This is a verified scoped recovery checkpoint, not a claimed full-database physical restore. Checkpoint creation: `2026-11-12T07:57:40.358626+00:00`; raw SHA-256: `34b0cfdf863918eab276e55b88260ab3e0ec062d4c786f497ed5df1fe49bb18e`.

Committed repair checks covered immutable signed payload, exact allowed field changes, unchanged historical timeline rows, one appended transition, stable financial/identity/unrelated public rows and profiles, and an idempotent repair retry. Independent Supabase readback confirmed receipt, links, delivered revision, custody, single receipt and single correction count.

## Client changes

- `src/lib/vehicleDeliveryReceipt.ts`: surface new visit-link rejections as localized errors; preserve real failure behavior instead of reporting success or falling back to metadata on a rejected link.
- `src/lib/i18n/vehicleHandoverLinks.ts`: clear Arabic/English explanations for conflicting, ambiguous or missing visit links.
- `src/test/vehicle-handover-link-errors.test.ts`: test localized rejected saves, absence of a metadata fallback, and a link rejected during finalization.

No TSX component changes were needed in this follow-up. The earlier local `shrink-0` signature-pad fix remains present.

## Verification

- Scoped encrypted backup and typed temporary restore: PASS.
- Before-apply Development transaction rehearsal, including the original repair: PASS; all changes rolled back and original state rechecked.
- After-apply real Development SQL/RLS regressions: PASS for insurance and cash. Reproduce missing backlinks, bind draft, retry draft without duplicate binding audit, reject changed vehicle/ambiguous visit, finalize, synchronize delivered workflow/custody, reject signed edits, deny client metadata-maintenance override, and retry finalization without another receipt. Standalone legacy compatibility and missing-profile denial also passed. Synthetic writes were rolled back.
- Cross-tenant and anonymous writes denied; binding helper not executable by authenticated or anon: PASS, all test writes rolled back.
- Local runtime tests: **4 files / 23 tests passed**, zero failures (12.12s).
- Full-project TypeScript and ESLint for changed files: PASS, exit 0.
- Fresh local Vite/PWA build: PASS, exit 0. Existing chunk-size warning remains. Served on localhost against Development, not deployed.
- Authenticated browser reload: delivered row no longer has the missing-handover warning and now offers View file; detail shows Delivered / With customer without review. Opening delivery retrieves the **original final receipt** with disabled recipient/declaration/signature editing, disabled Save draft and no new-finalize action. Active workshop count remains zero; delivered count one. The original final form was left open for review.

The entire project test suite was not rerun in this follow-up; the earlier full-suite result is separate. These checks do not certify physical delivery, real customer signatures/messages, invoice/payment flows, physical printing or Production readiness.

Private local evidence: `.vercel/handover-link-checkpoint-proof.json`, `.vercel/handover-link-rehearsal-proof.json`, `.vercel/handover-link-repair-proof.json`, `.vercel/handover-link-post-apply-proof.json`, `.vercel/handover-link-security-proof.json`, `.vercel/handover-link-target.log`, `.vercel/handover-link-typecheck.log`, `.vercel/handover-link-lint.log`, `.vercel/handover-link-build.log`. Database connection credentials and the encrypted before-image were not added to tracked files.
