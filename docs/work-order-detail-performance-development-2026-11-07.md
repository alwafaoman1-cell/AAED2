# Work-order detail performance — Development verification

Date: 2026-11-07. Scope: loading the existing Work Order Detail page, preserving its actions and data. Production: **Not Applied**.

## Root causes and corrections

1. Opening a single order subscribed to the whole workshop store, which bootstrapped a full `job_orders` archive alongside a separate partial detail reader. The page now uses `useWorkOrderDetailRecord`: one tenant-scoped canonical reader, the existing complete mapper, and listener-only store observation. Existing UUID/number/alias and deleted-order restoration behavior remains. Late route/tenant results cannot publish stale editable data. Failures offer an explicit retry.
2. Detail initialization hydrated the complete expense archive even though a selected-order cloud query already existed. Observation no longer implies archive hydration; default list consumers retain their prior behavior. Expense readiness comes from the confirmed selected-order query, keyed by tenant. Both canonical and legacy selected-order expense references remain supported. The edit form receives those confirmed vouchers directly.
3. Closed expense/communication dialogs and eagerly imported form/PDF modules loaded data and code before any action. Heavy actions are now dynamically imported and conditionally mounted when requested. PDF generators load inside explicit print actions. No action, permission check, URL, financial calculation, photo source, numbering rule, or button was removed.
4. The former partial reader could omit saved reception/parts/photo fields. The canonical full record preserves them. The previous unified operational source is still read, in parallel with related metadata, so status, presence, receipt time and required parts do not silently fall back to older mirrored data.
5. Editing a historical order without a receipt timestamp could fabricate today's arrival, or clear a known unified timestamp. Missing dates are now preserved on edit; new-order timestamp behavior remains. No historical backfill was performed.
6. Actual action testing exposed a pre-existing missing accessible title in Customer QR. The existing heading is now a `DialogTitle`, and its close icon has an accessible label. Layout and QR/print controls remain intact.

No schema, RLS, RPC definition, migration, Storage object or Production data was changed for this repair. No timeout was increased and no error was hidden to achieve the result.

## Actual browser comparison

Both versions used the same existing isolated synthetic Development tenant, ordinary manager authentication, the same remote Chromium environment and the same insurance/cash orders. Before: frozen previously tested source. After: the final Development Preview below. Service workers and WebSockets were disabled consistently in this controlled comparison. Backend bytes are actual response-body sizes, not guessed bundle sizes.

| Metric | Insurance before → after | Cash before → after |
| --- | --- | --- |
| Heading visible | 3.800 → 2.656 s | 2.081 → 1.593 s |
| All recorded backend requests settled | 9.052 → 5.295 s | 6.327 → 4.434 s |
| Backend requests during initial load | 60 → 42 | 54 → 40 |
| Backend response bytes | 67,858 → 10,287 | 92,300 → 34,795 |
| Response-byte reduction | 84.8% | 62.3% |
| JavaScript modules initially requested | 132 → 74 | 132 → 74 |
| Existing visible action inventory | Unchanged | Unchanged |

These are measured Development runs, not a Production latency guarantee. Global shell requests remain included; small request-count variations from notifications occurred on repeat runs. No full work-order or expense archive query remained in initial detail loading. Existing inspection summaries use their lightweight projection rather than `details`.

## Runtime verification

- Insurance and cash detail routes: passed, fully settled, no pending requests.
- Open/close the existing Edit, Change status, Photos, Add expense, WhatsApp, Customer QR, Email, Edit labor charges, Delete confirmation, and Print/PDF actions: passed. The deletion was not confirmed and no real message/email was sent.
- Print preview retained its content/styles: 3 style blocks, 0 scripts, 0 active event/JavaScript attributes.
- Desktop 1366×1000, tablet 1180×820, mobile 390×844: heading visible and no document-level horizontal overflow. Arabic RTL reload passed. These are browser viewport tests, not physical-device camera tests.
- Actual manager save: changed labor charge on the synthetic insurance order to OMR 0.120, reloaded, independently read it back, checked the existing database-generated subtotal/VAT/final-total formulas, then restored the original amount through the same UI. Every other saved field was unchanged; the final row matched its original values except the expected modification timestamp.
- Browsing/opening actions: **0 business-write attempts**, **0 HTTP errors**, **0 console errors**, **0 page errors**. The two explicit approved test PATCHes were scoped to `labor_cost`/`updated_at` on the one synthetic order only.
- Synthetic browser sessions were locally logged out. Non-fixture Development rows, other Auth users, public sequence values and the migration ledger were fingerprint-checked unchanged. The temporarily activated synthetic manager is returned to its previous disabled state after verification.

The runtime test does not claim that destructive operations, real provider delivery, invoice issuance, every full-form edit combination, physical-device uploads or live WebSocket delivery were exercised. Relevant existing automated regression coverage remains green.

## Automated checks

Final source ran on a 4-core/8-GB Development build machine, avoiding local memory pressure:

- Full project typecheck: passed.
- Full lint: passed.
- Full locked-version test suite: **1,674 total; 1,668 passed; 0 failed; 6 existing skipped**. No new skips were added. Thirty new tests cover scoped loading/observation, stale responses, tenant changes, complete data, deleted records, operational-state preservation, lazy action boundaries and the QR dialog.
- Production-mode Vite build: passed.
- Targeted local regression: 45 passed across 6 files; targeted lint and diff whitespace checks passed.

Earlier validation failures were corrected before this final result: new fixture TypeScript typing, a stale source-contract expectation requiring global expense hydration, and test-driver selectors/read-only RPC allowlisting. The verified plate-lookup RPC is SQL `STABLE`, SELECT-only and tenant-scoped; application/database permissions were not broadened.

## Exact release scope

Six runtime files:

- `src/hooks/useWorkOrderDetailRecord.ts`
- `src/pages/WorkOrderDetail.tsx`
- `src/lib/workOrdersStore.ts`
- `src/lib/expensesStore.ts`
- `src/components/workorders/WorkOrderForm.tsx`
- `src/components/workorders/QrLabel.tsx`

Six regression files:

- `src/test/work-order-detail-record.test.tsx`
- `src/test/scoped-store-observers.test.ts`
- `src/test/work-order-detail-loading-contract.test.ts`
- `src/test/work-order-qr-dialog.test.tsx`
- `src/test/work-order-deleted-restore-contract.test.ts`
- `src/test/work-order-expense-persistence-contract.test.ts`

The hashes of these 12 files match the final QA source manifest. Comparing against the frozen prior release found exactly these 12 source/test differences. All Supabase source/migrations stayed byte-identical. Unrelated local WhatsApp changes were excluded and retained locally. This document is additional release documentation, not application code.

## Preview and source evidence

- Preview: https://temo-work-order-preview-b12o8cyig-alwafaoman1-cells-projects.vercel.app
- Deployment: `dpl_CHHn6ZEadBt69BHhvCiakD32hGqv` — Preview only, linked to `rrhyglrnlveygyiandhs`.
- Base Git source: `bcc4b64469651614bef484df76c0a74845ac64b9`, plus the verified uncommitted overlay above. No commit or push was made.
- Private local evidence: `.vercel/detail-final-evidence-20261107.json`, the before/final-actions/final-save reports, Development checkpoint, and `.vercel/detail-release-scope-20261107.json`. They are not deployed as application assets.

## Separate existing limitation — not changed here

Development `job_orders.labor_cost`, `parts_cost`, `subtotal`, `vat` and `final_total` use two decimal places while the labor input permits a third decimal. A test with 0.125 encountered database rounding; it was restored, and normal save verification used a representable 0.120. Subtotal/VAT/final-total are generated columns with the existing formulas. Changing monetary precision requires a separate accounting/schema decision; this performance repair does not alter it. Shared application bundle-size and dependency deprecation warnings also remain outside this targeted repair and were not suppressed.

**Result: work-order detail performance repair verified on Development; ready for review/selective release approval. Production remains unchanged.**
