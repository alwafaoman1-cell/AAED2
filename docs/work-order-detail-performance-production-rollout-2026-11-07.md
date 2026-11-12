# Work-order detail performance — selective Production rollout

Date: 2026-11-07. Result: **Published and verified** at https://aaed-2.vercel.app.

## Exact release

- Deployment: `dpl_8451mXwva8icWsvQe26C36kq5N1Q` — READY and independently confirmed behind the live alias.
- Immutable URL: https://aaed-2-c7dymzspj-alwafaoman1-cells-projects.vercel.app
- Retained rollback: `dpl_E4HoLVpUdKvLhWgUrrRjSzdGVEaq`.
- Selective overlay digest: `b278def7b3508ec1f59f0613a85e7597884f780d8c404ea0f3398816653b1bb4`.
- Exactly 12 source/test differences from the prior live release: the six Work Order Detail runtime files and six regression files documented in `work-order-detail-performance-development-2026-11-07.md`. All 1,501 non-documentation application/test inputs matched the verified Development snapshot byte-for-byte.
- No new accounting calculation, financial precision, permissions, database, Storage, migration or environment-variable changes. The existing financial limitations were not silently repaired. No backfill, reclassification, renumbering, historical modification or real-provider send occurred.
- Unrelated local WhatsApp changes and private QA/authentication files were excluded. Original local modifications were retained.
- Direct isolated deployment, **no new Git commit or push**. Git HEAD remains `bcc4b64469651614bef484df76c0a74845ac64b9`. This SHA is the base, not the complete uncommitted overlay. Future Git-based releases must retain both the prior approved live overlay and this selective overlay.

Production environment variables were checked by the build guard. The Production build was staged without assigning domains, tested, and only then promoted; the Development Preview was not promoted.

## Validation

The final Production-environment build passed full typecheck, lint, all tests and Vite build: **1,674 total; 1,668 passed; 0 failed; 6 existing skipped**. The existing shared-bundle/dependency advisories were not hidden or upgraded away.

Actual existing cash and insurance orders were opened before release, on the staged Production build, and again through the live domain using an ordinary authenticated session of the existing active admin. No new user or test business record was created in Production. Business mutations, uploads, non-allowlisted RPCs and provider sends were blocked before navigation. Normal Auth verification/local logout and Storage signing were handled separately from business writes.

| Live measured metric | Insurance before → after | Cash before → after |
| --- | --- | --- |
| Heading visible | 7.481 → 4.150 s | 4.262 → 2.539 s |
| Recorded backend requests settled | 10.920 → 6.788 s | 6.905 → 4.172 s |
| Backend requests | 70 → 49 | 62 → 40 |
| Backend response bytes | 2,710,040 → 113,442 | 2,705,942 → 109,497 |
| Response-byte reduction | 95.81% | 95.95% |

These are controlled remote-browser observations, including global shell reads, not a universal latency guarantee or total asset/image transfer measurement. Initial detail reads no longer fetched the work-order or expense archives. Inspection reads remained projected summaries rather than heavy `details`.

Existing visible action inventories were preserved. Edit, Change status, Photos, Add expense, WhatsApp, Customer QR, Email, Edit labor charges, Delete confirmation, and Print/PDF all opened and closed on the live build. Destructive confirmations, financial saves and real sends were deliberately not executed. The print iframe retained three style blocks with zero scripts/active attributes. Desktop/tablet/mobile viewports had no document-level overflow; Arabic RTL reload passed.

Ten additional live routes passed HTTP 200, visible content, and completed backend requests: Work Orders, Inspections, Vehicle Entry, Expenses, Receipts, Accounting, Cash Invoices, Supervisor, Reports Center, and Monthly Vehicle Profitability. Settings reads remained key-scoped. Across the completed staged/live checks: **business-write attempts 0; HTTP errors 0; asset errors 0; console errors 0; page errors 0**. Successful test sessions were logged out locally without revoking the user's other sessions.

One early staged authentication probe reused the baseline's consumed one-time link before fresh preparation finished; it was rejected. The completed staged/live runs used fresh normal sessions and passed. No application control, RLS or permission was disabled to bypass that rejection.

## Data and worker safety

- Verified completed physical Supabase backup `2187497120`, dated `2026-11-06T21:56:59.078Z`, age 10.79 hours at the gate. This is backup verification, not a claim of a new full restore rehearsal.
- Fresh read-only checkpoint encrypted locally with Windows DPAPI; decryption verified.
- Post-staging and final comparisons: schema/ledger unchanged; **16 business/financial tables had 0 missing or changed existing records**. No new business rows were added during this release window.
- All **609 existing Storage objects** remained; missing objects and changed existing metadata were both 0.
- Insurance financial read-model discrepancies: 0 before and after.
- Existing OCR worker remained ready, **1/1 replicas**, attached to the new live deployment with its identical image digest `sha256:82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`, region, memory and grace period. No OCR job was submitted for this frontend-only release.

## Scope limits and evidence

This does not claim a site-wide performance repair, physical-device/printing verification, live WebSocket behavior, real-provider delivery, or all financial mutations. Service workers/WebSockets were disabled consistently for deterministic browser comparison. In particular, the unchanged Work Orders list still loaded approximately 3.63 MB of backend responses in its own smoke test; its wider legacy archive hydration was not bundled into this narrowly authorized detail-page release.

Private ignored evidence: `.vercel/detail-production-release-20261107.json`, `detail-production-before-20261107.json` and its encrypted checkpoint, the baseline/staged/live detail smoke reports, `performance-production-smoke-detail-live-routes-20261107.json`, `detail-production-platform-final-20261107.json`, `detail-production-final-20261107.json`, and `detail-production-final-evidence-20261107.json`. No private evidence or credentials were uploaded as application assets.

After saving any open work, refresh the application to load the new version. Do not clear operational data or forcibly reload an unsaved form.
