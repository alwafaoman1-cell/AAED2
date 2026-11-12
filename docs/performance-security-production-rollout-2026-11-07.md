# Selective performance/security Production release — 2026-11-07

## Outcome

Published only the verified performance/security changes to https://aaed-2.vercel.app.

- Deployment: `dpl_E4HoLVpUdKvLhWgUrrRjSzdGVEaq` — READY, promoted and live alias independently verified.
- Immutable URL: https://aaed-2-kk40a6w4q-alwafaoman1-cells-projects.vercel.app
- Rollback deployment retained: `dpl_9BJfA3b5ynQpPKEuKLMtcQJrtuMn`.
- Production source base: `2050858cb7efc3f109ba039be96df6f29a43727b`.
- Tested workspace HEAD: `bcc4b64469651614bef484df76c0a74845ac64b9`; its committed difference from the Production base is documentation only.
- Approved overlay: 48 application, test and build-config files.
- Overlay digest: `c0d6753251efcdaf42775ca1182f7495035f084aada2bf9aa3b6c48222ee1f41`.
- 1,496 non-documentation inputs were checked byte-for-byte against the verified Development Preview snapshot. Archive-only line endings were normalized to the tested bytes, without semantic source changes.
- Direct selective deployment artifact, not a new Git commit or push. Original checkout/staging and unrelated dirty files were preserved. A future Git-based release must retain this approved overlay; HEAD alone does not contain these currently uncommitted fixes.

## Included fixes and files

Only these files are in the functional overlay; the complete SHA-256 manifest is the ignored local evidence file `.vercel/performance-production-release-20261107.json`.

```text
src/components/AppLayout.tsx
src/components/NotificationsBell.tsx
src/components/PdfPreviewDialog.tsx
src/components/insurance/InsuranceOverdueBell.tsx
src/components/sales/SalesDocDetailPage.tsx
src/contexts/AuthProvider.tsx
src/hooks/useOverdueInsuranceAlerts.ts
src/hooks/useRealtimeSync.ts
src/i18n/locales/ar.json
src/i18n/locales/en.json
src/lib/accountingBridge.ts
src/lib/cloudSettings.ts
src/lib/htmlToPdf.ts
src/lib/inspectionsStore.ts
src/lib/pdfGenerator.ts
src/lib/vehicleRearThumbnails.ts
src/lib/vehiclesStore.ts
src/lib/overdueInsuranceSummary.ts
src/lib/pdfTemplateSettings.ts
src/lib/safeHtml.ts
src/lib/vehicleThumbnailUrls.ts
src/pages/Inspection.tsx
src/pages/InspectionReportPage.tsx
src/pages/WorkOrderDetail.tsx
src/pages/WorkOrders.tsx
src/pages/insurance/InsuranceClaimDetail.tsx
src/pages/insurance/InsurancePayments.tsx
src/test/accounting-bridge-hydration.test.ts
src/test/claim-rear-thumbnails.test.ts
src/test/cloud-settings-session-race.test.ts
src/test/legacy-expense-journal-regression.test.ts
src/test/phase4-performance-contract.test.ts
src/test/realtime-visibility-reconciliation.test.tsx
src/test/claim-inspection-attachment-contract.test.ts
src/test/cloud-settings-per-key-read.test.ts
src/test/inspection-report-loading.test.tsx
src/test/inspections-loading-dataflow.test.ts
src/test/legacy-html-security.test.ts
src/test/legacy-html-sinks-security.test.ts
src/test/overdue-insurance-alerts-hook.test.tsx
src/test/overdue-insurance-bells-state.test.tsx
src/test/overdue-insurance-summary.test.ts
src/test/pdf-preview-explicit-archive.test.tsx
src/test/pdf-template-settings-boundary.test.ts
src/test/pwa-core-shell-performance.test.ts
src/test/vehicle-thumbnail-urls.test.ts
src/test/work-orders-lazy-form-contract.test.ts
vite.config.ts
```

The changes stop navigation-triggered archive/journal writes, separate lightweight inspection summaries/counts from explicit details, scope cloud-settings reads by key with cache/invalidation, centralize safe legacy HTML preview handling, use private image transformations for list thumbnails, reduce redundant notifications/realtime work, and defer heavy forms/PDF engines and non-core service-worker precaching.

Explicit accounting/posting actions and financial eligibility rules remain in place. No historical repair, reclassification, backfill or renumbering was performed.

## Excluded

- Local `unified-message-send` Edge Function changes, its untracked handler/tests, and the modified WhatsApp contract test.
- Unrelated local documentation and private QA fixtures, screenshots, credentials and data.
- No Supabase Edge Function deployment, database migration, ledger repair or `db push`.
- No Development users or records copied into Production.

## Build and release gates

The same isolated application inputs passed the remote Production-environment build:

- Full project typecheck: PASS.
- ESLint: PASS, no source errors/warnings reported.
- Full Vitest: 1,644 total; 1,638 passed; 0 failed; 6 existing optional skipped tests.
- Vite Production build: PASS.
- PWA: 13 core precache entries, rather than preloading every lazy route/dependency.
- Existing npm deprecation/install-policy notices and a large-chunk build advisory remain; this release does not claim zero ecosystem warnings.

Early packaging checks correctly stopped publication: the release guard initially assumed a legacy JWT instead of the existing modern publishable key; three source-contract checks then exposed archive line-ending differences. The guard was corrected and release inputs matched exactly to the tested snapshot. Tests were not removed or weakened. A browser helper also needed to await the server-filter response before opening a row menu; one intermediate helper call timed out. The final independently completed staged/live runs below are the release evidence, not those failed infrastructure attempts.

## Backend/worker preservation

The application was staged with Production environment variables and `--skip-domain`, then tested before promotion; the Development Preview itself was not promoted.

The deployment-only Dockerfile inherits the exact already-running OCR image. Its source, installed dependencies, models, command, permissions, region, memory and termination grace period were not upgraded in this release.

```text
Worker: temo-document-ocr
State: ready
Ready / desired replicas: 1 / 1
Region: syd1
Memory: 2048 MiB
Graceful termination: 180 seconds
Unchanged image digest:
sha256:82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f
```

The final daemon inspection confirms it is attached to the new live Production deployment and healthy. A new OCR extraction job was not submitted as part of this frontend-only rollout.

## Actual Production browser verification

An existing active admin was used through a normal authenticated browser session. No new user was created or invited. A mutation guard was installed before the first navigation: business writes, uploads, provider sends and non-allowlisted RPC calls could not reach the backend. Normal Auth verification/local logout and authenticated object signing were treated separately from business writes.

These ten actual live routes returned HTTP 200 with visible headings and completed list-page requests:

```text
/work-orders
/inspection
/vehicle-entry
/accounting/expenses
/accounting/receipts
/accounting
/sales/invoices
/supervisor
/reports-center
/accounting/reports/monthly-vehicle-profitability
```

Both staged and post-promotion tests recorded:

- Business write attempts from browsing: 0.
- API HTTP errors, including HTTP 500: 0.
- Console errors, page errors, asset errors and denied read attempts: 0.
- Inspection list/count reads used projected columns, not `details`, `ai_analysis` or `*`.
- Observed tenant-settings reads were key-scoped, not tenant-wide collection reads.
- Existing work-order inspection count matched the database; linked summary and lazy edit form opened without saving.
- Actual existing inspection and cash-invoice preview iframes loaded, retained styles, had no scripts/active attributes, and blocked an isolated client-side script probe.
- Successful final test sessions were logged out locally without logging out the user's other sessions.

Live list-page heading visibility was approximately 1.1–4.1 seconds; network settlement approximately 3.0–9.0 seconds in the remote browser. These are observations, not a universal device/network guarantee. The work-order detail observation was bounded at 18 seconds with additional reads still pending; its linked inspection and subsequent preview checks passed, but this does not assert that every detail-page request had settled or that all remaining page weight is eliminated.

Long-running Realtime/load behavior was not re-tested in this deterministic browser measurement (WebSockets and service workers were blocked). Its targeted unit/regression coverage passed. Physical printing and financial/business mutations were deliberately not tested on Production. Previous Development PDF download/render verification remains separate evidence.

## Data integrity / backup

- A completed physical Supabase backup, inserted `2026-11-06T21:56:59.078Z`, was verified before deployment (backup ID `2187497120`, less than 24 hours old). No restore-over-Production or paid recovery project was used. This check does not claim a new full restore rehearsal.
- A fresh read-only checkpoint was encrypted locally with Windows DPAPI and its decryption was verified.
- Final schema catalogue and migration ledger matched the pre-release checkpoint.
- Across 17 existing business/financial tables: missing old records 0; changed old records 0.
- Existing Storage objects missing 0; existing object metadata changed 0.
- Invoice financial read-model discrepancies: 0 before and after deployment.
- Concurrent activity added one vehicle, one entry and four Storage objects during the observation window. These were not created by the guarded tests and were left untouched; they are not treated as historical repair or reverted.

Private checkpoint/evidence files remain ignored and were not uploaded with the application. No amounts, VAT, invoice numbers/sequences, historical payments, existing claim/work-order links or images were changed by this release.

## Evidence pointers

```text
.vercel/performance-production-release-20261107.json
.vercel/performance-production-input-proof-20261107.json
.vercel/performance-production-before-20261107.json
.vercel/performance-production-platform-final-20261107.json
.vercel/performance-production-smoke-staged-routes-v2-20261107.json
.vercel/performance-production-smoke-staged-previews-settled-20261107.json
.vercel/performance-production-smoke-live-routes-20261107.json
.vercel/performance-production-smoke-live-previews-20261107.json
.vercel/performance-production-final-20261107.json
```

**Decision: approved selective release published and verified within the stated read-only runtime scope. Not a claim that every unrelated historical issue, security advisory, device or full-load scenario is resolved.**

After saving any open work, refresh the application to load the new version; do not clear operational data or forcibly reload an unsaved form.
