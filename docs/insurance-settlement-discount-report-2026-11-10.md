# Claim invoice settlement discount report

## Scope

Additive, internal, read-only report at `/insurance/settlement-discounts`, reachable from Claims Accounting using **Settlement discounts / خصومات التسوية**. No commit, push, deployment, migration, historical repair, posting, invoice renumbering or Production data access is included in this task.

The report separates invoice discounts from cash collected. It does not reduce issued invoice totals or VAT. One row represents one active insurance invoice; cancelled/deleted/void/draft/ineligible invoices and cancelled/deleted claims are excluded. Insurance and cash sources remain separate.

## Behavior

- Invoice/claim number, insurer, plate, make/model, original gross total, stored current collected amount, registered invoice discount, payment-verified discount, difference, current outstanding, percentage, settlement payment dates, receipt numbers, reasons, approver IDs and reconciliation status.
- Current remaining = max(invoice total - stored collected - registered invoice discount, 0). This is explicitly a current invoice balance, not a historical period-end balance or an accounting repair.
- Verified discount includes only cleared positive discount payments with manager approval and a non-empty reason. Pending/bounced cheques do not qualify.
- Explicit payment/invoice associations require matching tenant and claim. Unlinked legacy payments are attributed only where exactly one active invoice exists for the claim, matching the official reporting association. Multiple active invoices, missing claims, missing approval and aggregate differences remain visible for review; nothing is linked or repaired automatically.
- Search, company filter, inclusive date range with invoice/payment date basis, review-only filter, reset and refresh. Date filters select invoices; they do not prorate an invoice's lifetime totals. Payment dates are entered business dates, never record creation timestamps.
- Selectable columns; Excel and PDF/print use all matching results, not the current 25-row screen page. OMR amounts remain numeric in Excel with three decimals. Percentages are not summed.
- Arabic/RTL and English/LTR labels/exports. User-entered business text remains unchanged.
- Native print/PDF uses the existing `.page` margin contract, repeated headers, landscape A4 and one final totals row. Text fields are escaped and final HTML is sanitized. The existing preview/download component is reused without an archive callback or external sharing source.
- Allowed UI roles: admin, manager, insurance and accountant; database reads remain ordinary authenticated, explicitly tenant-scoped and subject to existing RLS. No new public endpoint or elevated browser credential.
- Slim selects only from `insurance_invoices`, `claim_payments`, and affected `insurance_claims`; no general invoice items/PDF bodies or cash stores. Deterministic bounded pages require exact counts and reject incomplete/changed reads. Query caches are scoped by tenant and user. Errors/refetches withhold stale summaries and exports; a refresh never publishes a fabricated zero balance.

## Source files

New:

- `src/pages/insurance/InsuranceSettlementReport.tsx`
- `src/lib/insuranceSettlementReport.ts`
- `src/lib/insuranceSettlementService.ts`
- `src/lib/insuranceSettlementExport.ts`
- `src/lib/i18n/insuranceSettlements.ts`
- `src/test/insurance-settlement-report.test.ts`
- `src/test/insurance-settlement-service.test.ts`
- `src/test/insurance-settlement-export.test.ts`
- `src/test/insurance-settlement-page.test.tsx`

Small integration edits only in `src/App.tsx`, `src/components/insurance/InsuranceLayout.tsx`, and `src/pages/insurance/InsuranceAccounting.tsx`. Older unrelated dirty-worktree changes remain outside this feature's scope.

## Verification boundaries

Development schema columns were read-only verified against `rrhyglrnlveygyiandhs`. A real authenticated active manager session successfully loaded the empty report in Arabic and English; that Development tenant has no discounted invoices. The populated browser checks intercepted API responses with 27 synthetic invoices, never inserted them. They confirmed the actual browser service/model/UI/export path, 25 visible vs 27 exported invoices, numeric OMR totals of 270.000, A4 landscape print preview, 1366/834/390 viewport containment, no business write attempts, no HTTP/page errors, and revoked test sessions. Native PDFs were rendered for visual review. Physical printers/devices and live Production report data were not certified.

Private, ignored evidence: `.vercel/insurance-settlement-browser-proof.json`, `.vercel/insurance-settlement-qa/`, `.vercel/insurance-settlement-vite.log`, and test result JSON files. Initial harness attempts were retained: cold development-server loading, missing CORS-exposed count headers on intercepted responses, and Node SheetJS ESM filesystem configuration were test-harness issues; no application timeout or security control was weakened to pass them. The final browser run uses the production-mode build with Development-only environment values and ordinary auth.

The first native PDF review exposed missing margins because the shared PDF pipeline applies configured margins to `.page` elements and zeroes native page margins. The report was corrected to use that existing contract rather than changing global PDF settings. A regression test covers repeated page headers and a single totals row.

Production: **Not Applied**. No migration is required. Release requires a separate explicit request, a selective source bundle based on the then-current live source, and read-only verification against actual insurance settlements after deployment.

## Final checks

- Full project typecheck: PASS; full lint: PASS.
- Production-mode build with Development-only backend: PASS.
- Fresh full suite: **1,832 total; 1,826 passed; 0 failed; 6 existing skips; 633 suites**. Includes all 32 new report tests. Final proof: `.vercel/insurance-settlement-final-tests.json`.
- Final browser smoke: PASS, Arabic and English; operational writes 0, HTTP errors 0, page errors 0, console errors 0; test session revoked.
- Final native print PDFs: two A4 landscape pages each, 27 invoice rows plus one totals row, no blank trailing page. Arabic first page and English final page were rendered and visually inspected after the margin-contract correction. Files: 164,495 / 86,548 bytes respectively.
- Earlier concurrent duplicate validation runs were stopped when local memory pressure was observed; the final complete suite ran with one worker. No test or assertion was removed or skipped to obtain the final result.
- Git HEAD unchanged at `bcc4b64469651614bef484df76c0a74845ac64b9`; staging index empty. No commit, push, Preview deployment, Production deployment or remote migration was performed.

## Later authorized Production release

The owner subsequently requested a selective Production rollout. It was completed and verified, including a report-local measured-pagination correction discovered with real longer settlement content. See `docs/insurance-settlement-discount-production-2026-11-10.md` for the exact source/deployment, 33 focused tests, final full regression, data-preservation proofs and live browser results. The earlier Not Applied statements above describe the original Development handoff, not the later release state.
