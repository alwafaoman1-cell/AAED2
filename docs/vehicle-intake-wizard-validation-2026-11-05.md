# Vehicle intake and cycle-center release validation — 2026-11-05

## Scope

Selective integration on `codex/vehicle-intake-wizard-release`, based on
`684e180a42def54c291c660fe2b4176dfb992c24`. The previous claim/customer and
manager-confirmed existing-order link hotfixes remain intact. No main merge.

- Four existing intake stages: channel/purpose; visitor/vehicle; canonical
  technical inspection; photos/documents/review and optional signatures.
- Active visitor lookup by phone/customer code, excluding deleted customers.
  Changing a new visitor's phone clears the old selected identity. Equivalent
  phone formatting does not update a master record. Existing receipt phone
  corrections retain the optimistic concurrency baseline.
- Archived non-deleted vehicles are reused without transferring ownership.
  Reactivation occurs only after a valid new operation inserts successfully.
- One invoker transaction commits identity resolution, entry, damage marks and
  the canonical technical declaration. No multi-request partial-save fallback.
- Deleted-only customer matches require explicit restoration/review. Stale
  selected IDs, conflicting identities, wrong tenants and duplicate open visits
  fail closed with actionable messages. No silent restoration or merging.
- Center reads are paged on the server; terminal details load only when their
  tab opens. With-customer contains documented temporary exits, not deliveries.
- Canonical declaration changes invalidate the existing entry through Realtime;
  pristine forms refresh, while dirty forms retain their unsaved work.
- Entry outputs read the saved technical declaration. Technical preview, print
  and download use one A4 template. The complete author name uses its available
  column. Self-contained Arabic font CSS is restored in the rasterizer clone;
  checked answers use SVG paths instead of device-dependent glyphs.
- Floating shortcuts reserve the measured action-bar position, including wizard
  step/container size changes, rather than covering Previous/Next.

## Verification

Remote, Development-only compiled preview on a standard 4-core/8-GB builder:

- Full `npm run typecheck`: passed.
- Full `npm run lint`: 0 errors, one pre-existing Fast Refresh warning in
  `src/pages/accounting/setup/AccountingSetupPages.tsx:74`, outside this bundle.
- Full Vitest: 1,115 passed, 0 failed, 6 pre-existing opt-in skips (1,121 total).
- Production-mode `npm run build`: passed; existing large-bundle notices remain.
- Browser save/read-back: existing visitor plus archived vehicle, then a new
  visitor after changing the selected phone. No owner/master reassignment.
- Database verification: one entry/vehicle per visit, one canonical declaration,
  correct visitor, no automatically created claim/order/invoice. Duplicate RPC
  retry rejected atomically. 28 financial-table fingerprints unchanged.
- Compiled browser regression: desktop 1366x1000, tablet 820x1180 and mobile
  390x844; no horizontal overflow or action-button overlap; Arabic RTL center;
  terminal-tab requests; real canonical Realtime refresh; preview and PDF export.
- Actual downloaded PDF rendered and visually inspected, including Arabic garage
  name, complete report-author name and checked answers. Single A4 page.
- Browser checks recorded no page exceptions, console errors or failed API
  responses on the successful runs. Deliberate duplicate controls are separate.

Temporary fixtures use generated `AUDIT-ARCHIVE-*` identities in Development only.
Cleanup targets their exact tenant/entry/vehicle/customer IDs; never existing
operational rows. Private evidence remains under ignored `.vercel/`.

## Database rollout gate

Selective, timestamp-ordered migration chain only:

1. `20261104142019_vehicle_center_bounded_read_projection.sql`
2. `20261104142413_atomic_vehicle_intake_with_technical_declaration.sql`
3. `20261104144219_vehicle_technical_declaration_realtime.sql`
4. `20261104152916_reactivate_vehicle_after_new_active_operation.sql`
5. `20261104152919_atomic_intake_archive_on_confirmed_insert.sql`
6. `20261104153316_vehicle_entry_signatures_realtime.sql`
7. `20261105052618_vehicle_intake_active_visitor_resolution.sql`

The hosted migration API assigns its own Production versions. Record each actual
version/name/source mapping; do not fabricate ledger rows or use broad `db push`.
The middle replacement is retained as part of the validated migration history.

- Completed physical backup: `2167630934`, 2026-11-04 21:56:56.570 UTC.
- Fresh targeted schema/ACL/trigger/ledger checkpoint encrypted with Windows
  DPAPI and decrypted/compared successfully. No Production row export.
- Twelve relevant table schemas compared; 36 policies reviewed. Four job-order
  policy differences are equivalent `auth.uid()` init-plan optimizations; no
  permissions/policies are widened by this release.
- Cold install of the exact chain plus authenticated rollback suite succeeded on
  Development. Five authorized roles, denied/foreign/disabled actors, stale
  writes, rollback of related rows and archive reactivation were exercised.
- A separate full footprint proof preserved 143 public tables, functions/ACLs,
  migration ledger, Auth users and sequences after rollback.
- Full physical backup restore was not exercised. Frontend promotion is a
  separate gate after backend verification, not evidence from a Ready preview.

## Preserved boundaries

No historical backfill, automatic linking of the 32 historical candidates,
reclassification, invoice renumbering, financial posting, financial data repair,
test-data transfer or Production test record creation is included. The number
28 above counts financial tables checked, not the older 28-invoice reconciliation
backlog. This release is not a whole-ERP accounting/security readiness claim.

Unrelated dirty changes in the original checkout remain outside this bundle.
The OCR worker, invoice numbering, posting engine and existing claim/order
financial quarantine are unchanged. Existing global Supabase advisor findings
are not hidden or reported as resolved by this intake release.

Embedded font: Amiri Arabic Bold from `@fontsource/amiri@5.0.0`, WOFF SHA-256
`473d1b4b2d0252085b3fc54a2015a7c7752f71963533562268476c40f445f100`.
Its original SIL Open Font License is shipped in `public/licenses/amiri-OFL.txt`.
