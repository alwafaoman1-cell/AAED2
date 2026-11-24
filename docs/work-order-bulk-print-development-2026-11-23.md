# Work-order printing: local repair, 2026-11-23

Selecting several work orders and choosing Print could fail with `PORTAL_VEHICLE_REQUIRED`, preventing the entire preview from opening.

## Cause

The selected-order, print-all and individual-list handlers called `ensureCustomerPortalToken` before rendering every order. That operation requires an existing vehicle/customer visit and may create a public portal and audit record. A legacy order without the required link rejected the complete batch.

The canonical `getWorkOrderHtml` renderer does not use a tracking token or render the prepared tracking QR. Portal creation was therefore an unnecessary prerequisite for the current document. The same obsolete preparation was present in detail printing.

## Change

- Removed portal creation and unused QR preparation from all three list printing paths and detail printing.
- Kept full-record resolution, selection order, tenant checks, document fields and existing print formatting.
- Kept detail printing's read of the stored customer signature, signer name and signing date. No signature, visit, portal or document record is edited.
- Added an empty-result guard when Print All's results disappear after the displayed count was loaded.
- Kept actual customer-link creation and all database permission/identity guards unchanged.

No migration, dependency change, cloud operation, commit, push or deployment was performed. The application checkout remains on `codex/finance-security-development`, based on `26f6af6a151cd35d484a98652e0277103d2ddf37`.

## Files

- `src/pages/WorkOrders.tsx`
- `src/pages/WorkOrderDetail.tsx`
- `src/test/work-order-list-print.test.tsx`
- This verification note.

## Verification

- 33 tests passed across seven related suites. JSON receipt: `output/bulk-print-2026-11-23/vitest.json`.
- Five UI regressions use the real WorkOrders component and HTML renderer, with synthetic cloud fixtures and a mocked preview container: select two orders including an unlinked legacy order, Print All, individual Print/PDF, an empty Print All race and failed selected-record resolution. They verify complete work items/notes, no partial preview after a failed read, and no portal creation or QR generation. The portal-creation mock throws the reported error if called.
- After correcting test-only query option types, the five UI tests were rerun successfully. Receipt: `output/bulk-print-2026-11-23/ui-regression.json`.
- ESLint passed for both changed pages and the new test. `git diff --check` passed.
- The application build passed, including service-worker generation. Installed validation tools: Vite 5.4.21 and Vitest 3.2.7. The build reported existing chunk-size warnings.
- Final TypeScript recheck passed (`tsc -b --pretty false`, exit 0).
- Independent source review found no P1/P2 issues; the canonical renderer was not modified.

These are local synthetic-data checks. No Production record was inspected or changed for this repair, and no physical printer, live customer portal or deployed application was tested. The published application does not receive this fix until a separate authorized release.
