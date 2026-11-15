# Claim workspace and mobile PDF repair

This work addresses the mobile repair-estimate PDF error and the requested claim-page redesign in the existing active checkout. It is local Development work based on `a41227d`; no commit, push, deployment, schema migration or Production business-data change is part of this task.

## Audit findings

The active routes `/insurance/claims/:id` and `/insurance/:id` both use `InsuranceClaimDetail.tsx`. The separate older redesigned page is not routed and was not activated.

- Identity and status appeared in both the page header and management center. A large wrapping toolbar mixed Save, arrival, approval, delivery, estimate settings, PDF actions, work orders, communication and expenses.
- Save and work-order actions were repeated. The linked vehicle had several navigation controls. The delivery section had three buttons invoking the same handover flow.
- Six fixed-width tabs squeezed into a phone row. Some small buttons were 28–36px high, photo removal depended on hover, and payment tables clipped instead of scrolling.
- The complete LPO/invoice editor appeared before every workflow stage. Important amounts were harder to find than secondary metadata.
- Generic dirty tracking omitted estimation type, UPL rows and required parts even though Save persists those fields. Invoice generation continued after a failed Save because the prior click handler did not inspect a verified save result.

## Implemented layout

- One claim identity and status card, preserving vehicle image, plate, VIN, customer code, work-order reference, arrival date and visit state. Copy reference still copies the same complete value without repeating the entire vehicle description visibly.
- One Save surface with dirty/discard controls, one communication action and an overflow menu for archive, related expenses, vehicle center and permitted cancel/reopen/delete operations.
- A read-only amount summary uses the existing estimate, approval, LPO, insurance-invoice and cleared-payment sources. Amounts and supporting monetary details retain the amount-privacy marker. It introduces no new query or financial source of truth.
- One controlled six-stage navigation component: inspection/photos, estimate, approval, work order, delivery, and amounts/billing. It uses three columns through phone/tablet and six at wide desktop widths, wrapping labels and targets at least 56px high. The parent Tabs direction follows the active language for keyboard navigation.
- Customer, insurer/contact and vehicle fields remain in the original parent controller inside a compact details disclosure. Existing claims keep LPO/invoice fields in amounts/billing. New claims retain access to the same single LPO form in details before their first Save; delivery/billing stage restrictions remain intact.
- Estimate preview, download, badge setting and terms are grouped in the estimate stage. Approval invokes the existing approval dialog from its own stage. Work-order create/open/inline view remain in their stage. The invoice template picker is next to invoice actions.
- The ordinary notes editor hides internal LPO markers. The existing serializer still reattaches all four unchanged LPO fields on Save; Arabic and English placeholders/navigation labels are explicit.
- Delivery keeps one canonical handover launch and a separate draft-save action. Receiver and photo state stay in the same component; responsive layout and language changes do not create a replacement instance.
- UPL rows use labelled responsive fieldsets, multiline descriptions, readable line totals and 44px removal controls. Existing calculations, defaults, suggested-price assignment, bulk parsing and duplicate prevention are preserved.
- Claim history is collapsed by default; payment tables scroll within their own region. Photo removal and work-order/payment controls are usable by touch.

## Persistence and business boundaries

`InsuranceClaimDetail` remains the only controller for the claim draft, existing queries, authorization conditions and dialogs. There is no new claim page or duplicate form state. Generic Save still excludes custody dates and workflow status/rejection commands. Dirty tracking was extended only for the three additional fields that generic Save actually persists.

Save now reports success only after its existing verified update/readback and audit. The invoice action proceeds only on that success. Validation, update, LPO readback and audit failures block invoice creation. Both observers of the existing active-invoice query now request the same subtotal/VAT fields as well as totals/payments.

Approval, duplicate-work-order checks, confirmed physical arrival, cancellation/reopening, permissions, insurance-only invoices and canonical delivery routes retain their existing handlers. No new approval/delivery/invoice policy was invented. Payments tabs are not force-mounted: the existing paid-status effect still runs only when that section is visited. Its behavior was not moved into the read-only summary.

## Mobile PDF root cause and fix

The actual pre-change `generatePdfFromHtml(getClaimEstimateHtml(...))` pipeline reproduced the screenshot's `InvalidModificationError` in mobile WebKit. The stack points to `document.fonts.add(face)` in `pdfCaptureSurface.ts`: transferring a CSS-connected font face from the source iframe is rejected by WebKit. The behavior is specified by the [CSS Font Loading specification](https://drafts.csswg.org/css-font-loading/#font-face-source).

The renderer now handles that specific capability difference and verifies a matching native CSS face before accepting WebKit's rejection. Chromium's existing supported transfer is retained and cleaned up. Other errors propagate; a missing replacement does not silently generate a PDF with a fallback font.

The source iframe's load listener is installed before writing its document. Copied stylesheet/import loads are awaited before reading the capture document's font readiness; the earlier already-fulfilled font-ready promise could miss delayed CSS. Existing bounded timeouts, sanitized source HTML, scriptless source sandbox, isolated capture DOM, pagination and mobile download-link lifetime are preserved.

## Validation evidence

Private synthetic evidence is under `.vercel/mobile-pdf-invalid-modification-20261115/` and `.vercel/claim-workspace-responsive-20261115/`; it is excluded from Git.

- The original actual WebKit failure was reproduced with its matching message and stack, not inferred from the screenshot alone.
- Current renderer checks cover WebKit/Chromium, Arabic/English fixtures, UPL/Lump Sum, delayed imported/linked font CSS, matching Noto Sans Arabic/Inter metrics and actual canvas font use. Eight clean template PDFs are each one nonblank A4 page; their Poppler renders were inspected. Instrumented font probes are separate from clean layout fixtures.
- An actual mobile WebKit download event produced a PDF whose bytes match the returned blob. This is a browser-engine test, not confirmation on a physical iPhone or printer.
- Claim-page browser checks use the actual page and child components with synthetic Supabase/auth, blocked external requests and the desktop sidebar width. They cover both languages and widths 390, 430, 834, 1024 and 1280, unique actions, permissions/status gates, keyboard navigation, dirty/reset behavior, failed-save invoice blocking, LPO retention and delivery-draft navigation.
- Focused controller tests execute the actual save, invoice and rejection handlers against isolated mocks. They preserve dedicated rejection confirmation and validate Save's custody-date exclusion and failure ordering.
- Final locked-dependency typecheck, lint, full test-suite and build results are recorded in the private check receipts. The exact source snapshot is retained; original shared workspace dependencies were not replaced.

Completed check results: **2,021 tests passed / zero failed / six optional skips** in the full suite. After the notes-display refinement, **137 focused tests** passed; the presentation-only placeholder change passed **29 controller/translation/UI tests**. These targeted counts overlap the full suite and are not added as unique tests. Typecheck and lint passed. The final working source matches the exact snapshot in `completion-proof.json`; the last localized-placeholder and isolated toggle-direction changes are verified separately against the functionally tested snapshot, with browser checks and a fresh final build.

The actual-page browser evidence passed **444 checks across 98 layout snapshots** in Chrome and WebKit, including the focused toggle-placement check, with no page/console errors or external requests. The final Arabic light-theme phone/iPad images are under `label-delta/`; they use fresh synthetic fixtures and hide only the QA shell header. The private `completion-proof.json` records the matching source, runtime PDF checks, checksums, unchanged Git HEAD and absence of Supabase/dependency edits.

## Changed source areas

- `src/pages/insurance/InsuranceClaimDetail.tsx`: single controller, reorganized layout and action locations, draft detection, verified-save invoice sequencing, notes display and payment-table layout.
- `src/components/insurance/ClaimWorkspaceNavigation.tsx`, `ClaimAmountSummary.tsx`, and `src/lib/i18n/claimWorkspace.ts`: controlled presentation and bilingual labels.
- `src/components/insurance/UplItemsEditor.tsx` and `ClaimDeliverySection.tsx`: responsive editing and a single canonical handover action.
- `src/components/vehicles/VehicleVisitBadge.tsx`: optional noninteractive status display while retaining its default linked behavior elsewhere.
- `src/lib/htmlToPdf.ts` and `pdfCaptureSurface.ts`: document/stylesheet/font readiness and WebKit font compatibility.
- `src/i18n/autoDictionary.ts`: fallback coverage for new action labels and the correct estimate-navigation wording.
- Six regression/contract test files cover the corresponding controllers, responsive components, delivery state and PDF readiness/failure boundaries.

## Limits

No real customer signature, delivery, invoice, payment, message or Production record was created or changed. No physical iPhone/iPad, WhatsApp provider or printer was exercised. Existing template content/translation rules were not redesigned by the font repair. Chromium's manually transferred font faces are removed after capture; WebKit may retain browser-owned CSS font-cache entries after the capture DOM is removed, and does not allow deleting those CSS-connected entries through `FontFaceSet.delete`. The implementation does not claim the browser's native font-cache count is always zero.

The new workspace action targets meet the documented 44px minimum; older shared form/inspection controls retain their existing 36–40px dimensions. The browser harness uses the actual page and child components with matching shell dimensions rather than a complete authenticated cloud session. Cloud-save success and physical-device behavior remain outside these synthetic checks.

The changes are not published. Production phone verification remains a release-stage check after explicit publication authorization.
