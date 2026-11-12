# Work Orders list performance — selective Production rollout

Date: 2026-11-07. Result: deployed and verified on the live site.

Production: https://aaed-2.vercel.app/work-orders

Deployment: `dpl_2q9CuJF36DgGraFfyxWvfdK5BNuQ` — READY, assigned to the live domain after staged verification.

Source digest: `275973874a9ada688681bf16d22d8b100d9ace1c495eabf3c449e6ae038843f9`.

Git source base: `bcc4b64469651614bef484df76c0a74845ac64b9`. This is a selective CLI release of the verified working-source overlay, **not** a new Git commit. No commit, push, remote change or merge was made. The existing dirty worktree was preserved.

## Exact scope

The preceding actual Production artifact was copied, then only nine Development-verified files were overlaid. All 1,505 application/test inputs matched the tested frozen source. The existing Worker image, environment configuration, deployment protections and Production build guards were preserved.

- `src/pages/WorkOrders.tsx`
- `src/components/workorders/WorkOrderForm.tsx`
- `src/lib/workOrdersStore.ts`
- `src/lib/workOrderListActions.ts`
- `src/integrations/supabase/types.ts`
- `src/test/work-order-list-actions.test.ts`
- `src/test/work-orders-light-list.test.ts`
- `src/test/work-order-detail-responsive-contract.test.ts`
- `supabase/migrations/20261107104530_work_orders_light_summary_page.sql`

Unrelated local WhatsApp/provider changes and other working files were excluded. No accounting implementation file changed in this release.

## Root causes addressed

The list previously serialized complete work-order rows, including large embedded data, and mounted closed expense/photo/status/QR/PDF dialogs. The new bounded summary projection keeps existing filtering, sorting, totals, authorization and expense formulas; complete records are fetched only for explicit actions. Summary rows cannot be saved as complete records. Cross-page bulk selections and actual-cost CSV export retain their canonical read paths.

Pagination no longer resets while its response is pending. Confirmed editor saves invalidate canonical vehicle queries instead of copying the entire vehicle registry into legacy settings. No timeout was increased.

## Migration and safety gates

Production project: `ifnfwssdtjuzdtshnrht`.

Applied only `20261107104530_work_orders_light_summary_page`. It adds one `STABLE`, `SECURITY INVOKER` read function and execute grants. Anonymous execute is denied. The old full RPC remains unchanged for compatibility and rollback.

- Completed physical backup `2187497120`, dated `2026-11-06T21:56:59.078Z`, verified before the release; age 13.44 hours at the gate.
- Fresh encrypted DPAPI checkpoint with successful decryption verification, covering 145 public/private tables, schema, migration history, sequences and Storage metadata. This checkpoint is not claimed to be a complete Storage content backup or a restore rehearsal.
- Real authenticated-admin SQL rehearsal: eleven old/new filter/page parity cases; transaction rolled back successfully.
- Actual selective migration: the same eleven cases passed; all 145 business-table snapshots remained identical within its repeatable-read transaction. Exact executed SQL and the new migration-ledger row committed atomically. Zero business-data writes.
- No broad `db push`, old-ledger rewrite, backfill, automatic link, reclassification, renumbering, historical repair or financial posting.
- Frontend staged as Production with no live domain first; promoted only after database, source, full-suite, browser and Worker checks passed.

## Actual live browser comparison

One cold authenticated Chromium sample before and one after, the same existing administrator and 20-row first page. Service workers and WebSockets were disabled equally for comparison. These are observed measurements, not a guaranteed user/network latency.

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Heading visible | 3,632 ms | 3,193 ms | 12.09% |
| Rows visible | 5,114 ms | 3,982 ms | 22.14% |
| Backend settled | 9,343 ms | 6,590 ms | 29.47% |
| Initial backend response bytes | 3,632,018 | 147,364 | 95.94% |
| Initial backend requests | 33 | 29 | 12.12% |
| JavaScript modules | 117 | 59 | 49.57% |
| DOM nodes | 2,350 | 2,304 | 1.96% |

Before/after totals and button inventories match: 198 work orders, 75 cash, 123 insurance. The new read RPC is used in the live browser. Initial list loading does not fetch complete work-order details or the expense archive.

Verified live: cash/insurance filters, search, page two and back; Edit, Photos, Status, Expense, QR, Delete confirmation (cancelled) and Print preview open. Preview retained styles with no scripts/active handlers. Arabic RTL and 1440×1000 desktop, 1024×1366 tablet and 390×844 mobile viewports passed without document overflow.

Ten live routes returned HTTP 200 with all requests settled: Work Orders, Inspections, Vehicle Entry/Operations Center, Expenses, Receipts, Accounting, Cash Invoices, Supervisor, Reports Center and Monthly Vehicle Profitability. Inspection list reads remained lightweight; settings reads remained key-scoped.

Across both live probes: zero HTTP errors, console errors, page errors, asset errors, denied reads or attempted business writes. No HTTP 500. Temporary test sessions were revoked locally without signing out other user sessions.

## Data and Worker verification after promotion

All financial records, invoice registries and numbering sequences matched the pre-release checkpoint. The checked report/invoice outstanding-balance discrepancy remained zero. Existing work-order/historical rows were unchanged. All 614 pre-existing Storage objects retained their exact metadata fingerprints; none was deleted or replaced.

The workshop was in real use during the release. Concurrent real additions were retained, including a new claim/vehicle/entry/inspection and document-extraction records, plus two new Storage objects. Two existing logical operational counters and the exact legacy audit-cache setting changed with that activity; these were reviewed explicitly rather than reverted or falsely reported as release mutations. Migration pre/post equality was independently proved inside its own database transaction.

The existing `temo-document-ocr` daemon is READY with 1/1 replica attached to the new deployment, using the unchanged pinned image `sha256:82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`. No test OCR job or customer communication was submitted by the verifier.

## Tests

- Full typecheck: passed.
- Full source lint: passed.
- Full suite on the exact staged Production source: 1,689 total, 1,683 passed, zero failed, six existing skips; 584 suites.
- Production build: passed on the cloud build machine.
- Targeted Development regression: 53 passed across eleven files.
- Development actual save/reload/read-back/restore, full-record read failure/retry, cross-page CSV/printing and protected-field retention: passed before release.
- Final source-byte, deployed-domain, Worker, database/Storage, accounting fingerprint and browser gates: passed.

## Boundaries and remaining observations

Production saves, deletions, payments and real provider sends were deliberately not exercised; those would modify operational data. Viewports were emulated, not physical-device certification. Physical printing and live Realtime were not retested in this release.

The compact list deliberately does not materialize legacy work-order photo arrays. A legacy vehicle without a canonical cover/avatar can display the placeholder in the list; full photo actions still resolve the complete record. No image was deleted and no automatic thumbnail backfill was performed.

Existing unrelated Supabase advisories are unchanged: eight no-policy informational findings, thirteen anonymous definer-function findings, ninety-nine authenticated definer-function findings, and one leaked-password-protection finding. The existing large-build-chunk warning remains visible; neither was suppressed or repaired outside this scope. This release is not a claim that the entire ERP has no remaining warnings.

Rollback target: `dpl_8451mXwva8icWsvQe26C36kq5N1Q`. The additive read function can remain harmlessly if the prior frontend is restored; no data rollback is needed.

Machine-readable evidence is retained in ignored `.vercel/list-production-final-evidence-20261107.json`, linked component reports and the encrypted checkpoint. These private verification artifacts are excluded from the application upload.
