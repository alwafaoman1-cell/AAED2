# Production speed and responsiveness audit — 7 November 2026

## Decision

**Functional read-only checks passed. Performance still needs improvement.** No application code, Production deployment, migration, financial data, historical records or permissions were changed during this audit. A protected test-only browser helper was deployed to the existing Preview diagnostics project; it is not the ERP release.

Verified live application deployment: `dpl_5HhxzsVCQEaonkqamKokWaWL2KTq`. The Production alias still points to that deployment. Git HEAD remained `bcc4b64469651614bef484df76c0a74845ac64b9`; existing dirty application changes were not staged or published.

## Measured scope and method

- 11 unique authenticated application pages, 20 page-load/navigation measurements and 10 actual filter/tab/search interactions.
- Desktop 1440×1000, mobile-sized 390×844 and tablet-sized 1024×1366 remote Chromium. These are viewport tests, not physical device or Oman mobile-network measurements.
- Fresh ordinary existing administrator sessions, isolated browser profiles, no new users, no real emails, no test operational records. Verification sessions were revoked with local-session scope.
- Outbound business writes were blocked and recorded. Read-only RPCs and Storage signed reads were allowlisted. Every browser run recorded **zero attempted business writes**, blocked reads, HTTP errors, Console errors or page exceptions.
- Sidebar company headings were not used as evidence that application data had loaded. Measurements wait for the page heading/content, work-order rows where applicable and settlement of database/auth requests. `dataReadyMs` is the last completed core request relative to navigation. The separate settlement duration includes approximately 0.9–1.0 seconds of deliberate observation quiet time; it is not all user-visible waiting.
- Request routing disables HTTP cache; these hard-load measurements are conservative and must not be called warm-cache measurements. Service Worker and realtime were disabled to bound the read-only test. Actual long-lived realtime behavior and an installed PWA cache were not exercised here. See [Playwright routing documentation](https://playwright.dev/docs/api/class-browsercontext#browser-context-route).
- Observed long tasks/layout-shift sums are diagnostics, not a production Core Web Vitals/INP certification. Resource encoded transfer sizes were unavailable in the intercepted remote session and returned zero; zero is **not** evidence that JavaScript assets cost no bytes. Backend body sizes below are decoded response sizes, not compressed wire traffic.

## Actual page results

| Page | Desktop core data completion | Other measurements | Main observation |
| --- | ---: | --- | --- |
| Vehicle lifecycle center | 4.91 s | mobile-sized 3.17 s; tablet-sized 2.67 s | 29–30 backend requests; 134 KB center response |
| Work-order list | 3.90 s | mobile-sized 2.29 s; client navigation 2.35 s | 27 backend requests; actual bounded list response 26.7 KB |
| Existing insurance work-order detail | 3.50 s | client navigation 2.80 s; mobile-sized 12.27 s once; repeat 5.32 s and 4.24 s | 44–47 backend requests; intermittent latency, not a resolved spike |
| Supervisor | 2.44 s | mobile-sized 3.61 s | 16–20 backend requests; 124 KB center response |
| Insurance hub `/insurance` | 3.37 s | — | 1.69 MB decoded backend data, including a 1.407 MB full claims read |
| Actual claims list `/insurance/claims` | — | mobile-sized 9.69 s | paginated claims RPC took 5.21 s over HTTP in that run; not the same page as the Insurance Hub |
| Expense management | 4.19 s | — | 242 KB; two category projections totaling about 131 KB |
| Cash invoices | 3.20 s | — | 119 KB; no full sales-document table load observed on this route |
| Receipts | 3.23 s | — | 167 KB; paginated receipts RPC used |
| Accounting home | 2.61 s | — | 1.11 MB decoded data; full expense read 825,894 bytes |
| Monthly vehicle profitability | 2.41 s | current selected month | selected-month browser results must not be generalized to all historical periods; July RPCs were measured separately below |

Cash/insurance filter results appeared in approximately **0.46–0.52 seconds**; existing-order search results in **0.70 seconds**. Further indicators/background reads took some interactions to about 1.05–1.26 seconds. Center tab selected-state changes appeared in about 0.10 seconds; actual uncached customer-tab data completed in 0.69–1.15 seconds. No horizontal overflow was found at tested viewports.

The 12.27-second detail load included multiple small configuration/feature/version/compliance requests taking roughly 4.9–6.25 seconds each. The actual browser's longest main-thread task in that measurement was 117 ms. This supports a data/startup waiting problem rather than a continuous 12-second JavaScript freeze. Retesting improved but did not establish that intermittent latency has gone away.

Four direct requests from the workshop computer to the HTML shell returned HTTP 200 / CDN HIT: header latency **318, 189, 89 and 103 ms**. This isolates fast static delivery from the slower authenticated data startup; it is not a measurement of the whole application.

## Read-only database execution measurements

`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` ran in an explicitly read-only transaction under the existing authenticated active administrator's tenant context. Three sequential samples per RPC; no permissions were widened. These are samples, not p95/p99 statistics. Function-level EXPLAIN does not expose every nested query plan, so it is not justification for speculative index or RLS changes.

| RPC | Execution samples, ms | Median, ms |
| --- | --- | ---: |
| Vehicle center | 2279.718 / 548.988 / 1434.808 | 1434.808 |
| Work-order list summary | 914.878 / 50.962 / 46.782 | 50.962 |
| Expense page | 1176.279 / 126.017 / 21.694 | 126.017 |
| July profitability, cash | 619.567 / 469.027 / 491.669 | 491.669 |
| July profitability, insurance | 321.608 / 307.911 / 295.657 | 307.911 |
| Actual claims list | 113.075 / 54.659 / 53.791 | 54.659 |

The actual claims list's 5.21-second HTTP observation was not reproduced as five seconds of SQL execution (SQL median 54.7 ms). Do not diagnose it as a missing index from the HTTP duration alone: startup, API/network/concurrency and transient load must be separated. In contrast the center itself still shows material database execution cost and needs nested-plan analysis before optimization.

The first SQL diagnostic used an unsupported `all` business type for monthly profitability. The database correctly rejected that diagnostic input. The test was corrected to the actual cash/insurance contract and rerun; it was not an application HTTP failure and no database change was made to hide it.

## Confirmed remaining causes and prioritized next work

1. **Accounting home calculates expenses after downloading full vouchers.** The deployed `src/pages/Accounting.tsx:86` calls `expensesStore.refresh()`; the deployed store hydrates with `expenses.select('*')` without pagination, and the dashboard sums that local set. The observed full expense payload is 826 KB. Replace this dashboard dependency with tenant/eligibility-preserving server summaries, leaving voucher details and historical records unchanged.
2. **Insurance hub downloads all detailed claims, invoices and payments just to derive counters/charts.** Deployed `src/pages/insurance/InsuranceHub.tsx:23–25` mounts three broad readers. `useInsuranceClaims()` selects `*` plus joins without page bounds. This accounts for the observed 1.407 MB claims response. Use a bounded summary projection/RPC, preserving separate cash/insurance rules and existing cancellation/settlement eligibility. The actual paginated claims-list page already uses its own RPC and must not be confused with the hub.
3. **Detail startup still fans out to 44–47 reads; fresh hard navigation repeats several identity/configuration reads.** Observed exact duplicate requests: generally 2–3 per hard load. Some authority checks are intentional; consolidate shared tenant-scoped in-flight readers only after tracing them, not by removing security verification. Defer noncritical modules/indicators until the core work-order data is visible, preserving all buttons and financial freshness.
4. **Category reads use two distinct readers.** Expense management calls canonical `listExpenseCategories()` with `select('*')`, while the legacy compatibility store independently reads a second projection. Both read the same table, but the combined observed payload was about 131 KB. Share the canonical tenant-scoped category cache/projection with invalidation instead of deleting categories or silently removing compatibility behavior.
5. **Center SQL and tablet layout stability deserve focused work.** Center execution median 1.43 seconds in this sample set; retain a real role-specific nested-query plan and exact results before any selective Development optimization. The tablet center showed a raw layout-shift sum of 0.289, so reserve loading-card/table space and keep dimensions stable. That number is not a standardized field CLS result.

Workshop computer snapshot: 7.40 GB visible RAM, 1.07 GB available, 85.5% in use. This can worsen local browsing responsiveness, but it cannot explain away the slow requests seen on the independent remote browser. No processes were killed or caches cleared.

## Safety and logs

- Last-hour Vercel CDN 5xx request query: **0 records**, complete pagination.
- Last-hour Production runtime error/fatal query: **0 records**, complete pagination.
- Browser HTTP/Console/page errors: **0**, across all four runs. This is bounded test/log evidence, not a guarantee that every route/user/device is error-free.
- Fresh business/Storage/sequences/financial projection preservation verification passed after the primary checks. No historical repair, backfill, auto-posting, renumbering, reclassification or migration occurred.
- No full application test suite was rerun: no application implementation was changed. The work was live read-only diagnosis plus test-helper/report files.

Evidence retained locally under ignored `.vercel/`: `speed-audit-core-20261107.json`, `speed-audit-finance-20261107.json`, `speed-audit-mobile-20261107.json`, `speed-audit-detail-check-20261107.json`, `speed-audit-database-20261107.json`, `speed-audit-database-claims-20261107.json`, `speed-audit-cdn-errors.jsonl` and `speed-audit-runtime-errors.jsonl`. No authentication tokens are included in the report.
