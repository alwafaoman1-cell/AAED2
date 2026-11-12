# Work Orders list performance — Development verification

Date: 2026-11-07. Scope: `/work-orders` and its existing action/save flow.

Status: verified on Development. **Production: Not Applied. No commit or push.**

Preview: https://temo-work-order-preview-4qwrzhsqt-alwafaoman1-cells-projects.vercel.app/work-orders

Deployment: `dpl_6Hr9naMmSNRfoYSrjNsUTXuJoRJB` (Preview, Development environment guard).

## Root causes and corrections

1. The existing paged RPC materialized `job_orders.*`, carrying photos, reception signatures, work items and metadata through filtering and JSON serialization. Added `work_orders_summary_page_rpc`: explicit display projection, the same authorization, filters, numeric sorting, pagination, summaries and expense calculation. The original full RPC is unchanged. Missing-new-RPC compatibility calls the old bounded page, not a full archive.
2. Closed action dialogs were mounted; the expense dialog subscribed to the full expense archive and settings. Dialogs and PDF generation now load only after an explicit action. Initial list load makes no job-order detail, expense archive or expense-category request.
3. Photos and mutations need a complete canonical record, not a display projection. All relevant row actions now resolve the selected full record first. Summary records cannot enter the mutable work-order cache or the save path. Tenant changes, deleted/missing records and failed reads stop the action visibly.
4. Pagination could reset to page 1 while the next page was still pending, because a missing response was treated as one total page. Bounds are now applied only after a verified list response; previous-filter rows are still not displayed as new results.
5. Cross-page bulk selections must not be reduced to visible rows. Selected records are resolved explicitly with concurrency bounded at four. CSV uses the existing scoped actual-cost reader, not the detail reader's default zero. Cost formulas were not changed.
6. The actual editor save test exposed a registry-wide refresh which copied vehicle reads into legacy settings. Two controlled saves attempted 52 unrelated setting writes; the verifier blocked them. WorkOrderForm now invalidates canonical vehicle queries after confirmed identity instead of hydrating/mirroring the registry. Final save tests observed only the two intended synthetic job-order updates, zero setting/vehicle writes and zero blocked attempts.

No timeout was increased. No financial posting, invoice, tax, numbering, expense-classification, claim or vehicle-ownership rule was changed.

## Browser performance

Median of three fresh Chromium contexts before and three on the final Preview. Same isolated Development tenant, 26 synthetic orders, 13 cash and 13 insurance, 20 rows per initial page. These are Development measurements, not a Production latency guarantee. Service workers and WebSockets were blocked equally in both comparisons.

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Heading visible | 3,620 ms | 2,071 ms | 42.8% |
| Rows visible | 4,548 ms | 2,530 ms | 44.4% |
| Backend settled | 6,731 ms | 4,506 ms | 33.1% |
| Initial backend requests | 30 | 28 | 6.7% |
| Initial backend response bytes | 59,938 | 35,066 | 41.5% |
| JavaScript modules fetched | 117 | 59 | 49.6% |
| DOM nodes | 2,462 | 2,404 | 2.4% |

The first page's RPC response fell from 51,312 to 26,444 bytes. Button inventory and summary counts remained identical. Normal browser runs recorded zero HTTP errors (including zero HTTP 500), console errors, page errors, asset errors, denied requests or unsolicited write attempts.

## Actual Development checks

- Search by work-order number; no-result search; cash/insurance separation; date range; saved-filter reload/reset; column visibility; next-page navigation.
- Two selections across different pages: CSV includes both rows, selected print includes both orders.
- Filtered all-orders print includes all 26 orders, not only the current page. Parts request print includes all nine relevant vehicles.
- Edit, photos, status, expense, QR, delete-confirmation and print/PDF dialogs open. Delete was cancelled; no destructive operation or real customer message was executed.
- Preview HTML renders with styles and no script/event-handler content.
- Desktop 1440×1000, tablet 1024×1366 and mobile 390×844: heading visible, no document overflow. Arabic RTL mobile checked after reloading.
- Manager editor: change synthetic diagnosis, save, reload, read back from Supabase, then restore. Order/customer/vehicle/claim identity, status/date, required parts, work items, photos, reception data and financial columns were retained.
- A deliberately injected HTTP 403 full-record read failure displays an error and does not open a guessed editor; retry succeeds without creating any record. This single injected response is reported separately, not hidden as a normal successful request.

## Database and integrity

Development only: `rrhyglrnlveygyiandhs`.

Applied selectively through the migration API:

`20261107104530_work_orders_light_summary_page.sql`

The local version matches the actual migration ledger. No broad `db push` or old ledger repair was performed. This migration only adds a read-only function and its execute grants; it contains no data update, backfill, deletion or reclassification.

- Existing and new SQL bodies compare identical after replacing the projection alone.
- Eighteen filter/search/pagination combinations return identical IDs, projected values, summaries and counts.
- `EXPLAIN ANALYZE BUFFERS` executed as the real synthetic authenticated manager, not an administrator bypassing RLS: estimated base-row width 1305 → 607; five-run median execution 15.498 → 11.590 ms. Shared-hit blocks remained 486; no speculative index or policy change was made.
- New function is `STABLE`, `SECURITY INVOKER`; wrong-tenant result is empty; anonymous HTTP execution returns 401.
- Before/after fingerprints confirm all pre-existing data in 144 public tables, other Auth users and public sequences unchanged. Existing migration-ledger rows are unchanged; only the approved new function migration was added.
- Fixture remains exactly 26 uniquely numbered orders, 26 vehicles, 13 claims and one customer, with original identities, archival flags and vehicle ownership. No invoices, expenses or claim payments were created. No duplicates.
- Test sessions were revoked after each run. The isolated synthetic test profile was disabled afterwards; records were retained, not deleted.
- Security/performance advisor counts are unchanged. Existing definer-function and unrelated index/RLS advisories were not suppressed or changed in this task.

## Tests and build

The final frozen source was validated on an 8 GB cloud build machine to avoid exhausting the local computer:

- Full project typecheck: passed.
- Full source lint: passed.
- Full suite: 1689 total; 1683 passed, 0 failed, 6 pre-existing skips. Fifteen regression tests added.
- Production-mode Vite build with Development environment: passed.
- Targeted regression: 53 passed across 11 files.
- Existing large-chunk warning remains visible; its limit was not raised to hide it.

## Exact implementation delta from the previously verified detail-page release

- `src/pages/WorkOrders.tsx`
- `src/components/workorders/WorkOrderForm.tsx`
- `src/lib/workOrdersStore.ts`
- `src/lib/workOrderListActions.ts` (new)
- `src/integrations/supabase/types.ts`
- `src/test/work-order-list-actions.test.ts` (new)
- `src/test/work-orders-light-list.test.ts` (new)
- `src/test/work-order-detail-responsive-contract.test.ts` (asserts the confirmed full-record action boundary instead of a direct partial-row setter)
- `supabase/migrations/20261107104530_work_orders_light_summary_page.sql` (new)

The frozen Preview source hashes match these files. Everything else matches the prior verified snapshot; unrelated local WhatsApp changes and other working files were excluded. No accounting implementation file was changed.

Machine-readable evidence and fixture controls are retained under ignored `.vercel/`; they are not part of the application release.

## Release boundary

Ready for review and a selective release, not already active on Production. Production requires its own approved preflight/backup check, selective addition of this read-only function, the exact verified frontend delta and post-deployment read-only smoke. Preserve the old RPC for compatibility/rollback. Do not run a broad migration push, copy test records, renumber, backfill or modify historical financial data.
