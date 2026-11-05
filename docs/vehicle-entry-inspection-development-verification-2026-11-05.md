# Vehicle center inspection — Development verification

Production: **Not Applied**. No commit or push. Base commit remains
`87facc590fc4458a51736397732e97962e60b5b2`, branch `codex/finance-security-development`.

## Implemented scope

- An existing, recorded insurance vehicle entry inside the workshop has a **Vehicle inspection / فحص المركبة** action in the desktop list, responsive cards, Kanban and the entry's operational control panel.
- The existing damage-inspection form is reused. The entry UUID resolves its current cloud claim/vehicle/order; a plate search or cached order never establishes this link. No claim, vehicle or work order is created by this action.
- Identity is prefilled and locked in the entry flow. The database independently canonicalizes claim/entry/vehicle identity.
- One transaction saves the inspection through the existing DR allocator, stores the canonical visit/claim context and writes the inspection's database UUID into `insurance_claims.inspection_id`. A profile UUID—not an Auth UUID—is used for the inspector FK.
- Reopening retrieves the same inspection. Same-request retries recover the confirmed server version; another creation request is rejected instead of overwriting an intervening report. The UI does not automatically rewrite a recovered entry report after a lost response.
- The linked report is hydrated on claim reload through its exact UUID. PDF generation uses its saved report payload rather than depending on the global synchronous cache.
- First linking is restricted to the validated database writer, not browser-editable timestamps/JSON. A common trigger protects canonical identity through legacy writers as well.
- Existing role UI permissions are preserved. The existing report writer's missing `insurance` role was aligned with the existing Insurance Inspection permission; no accounting permissions changed. Anonymous and inactive accounts are rejected.
- Claim-only cards, drafts, customer-held vehicles, cash entries without claims and cancelled entries do not start this insurance-specific flow. Temporary release and technical declaration remain separate, unchanged functions.
- Historical conflicting links are reported for review; there is no adoption, backfill or automatic repair. No invoice, payment, claim-status or accounting logic changed.
- The new entry page reserves bottom space so its save controls can be scrolled clear of the mobile floating quick-actions button.

## Development-only migrations

Applied selectively to `rrhyglrnlveygyiandhs`, with the actual ledger timestamps matched by the local filenames:

1. `20261105094638_vehicle_entry_claim_inspection_link.sql`
2. `20261105094929_guard_entry_inspection_first_link.sql`
3. `20261105095546_restrict_entry_inspection_link_creation.sql`

No blanket database push. No Production SQL or migration. The new unique index is valid and the guard trigger is enabled.

## Verification

Final protected Development application Preview:

https://temo-work-order-preview-fmo8vekhr-alwafaoman1-cells-projects.vercel.app/vehicle-entry

Deployment: `dpl_CmktDRG9xUZbGvUivNYfy3QdgpVe`, READY, Preview only. The build explicitly checks the Development Supabase project and URL. It is not the Production website.

- Full typecheck: PASS.
- Lint: PASS, zero errors/warnings.
- Full tests: 1,278 total; 1,272 passed; zero failures/failed suites; six existing optional skips. Skips are not counted as executed proofs.
- Production-mode frontend build: PASS. Existing package deprecation/install-script and large-bundle/PWA warnings remain visible; this is not a claim that the whole project is warning-free.
- Database rollback proof: 14 checks passed, including canonical identity, atomic claim UUID link, valid inspector profile FK, same-request retry, another-tab rejection, explicit edit, legacy-writer identity protection, timestamp/request-token forgery rejection, direct first-link insert denial, disabled-account denial and anonymous privilege denial. All 143 pre-existing public tables remained unchanged after rollback.
- Actual authenticated browser flow on Development: PASS. Center action visible at Desktop 1366×1000, Tablet 820×1180 and Mobile 390×844; correct prefilled/locked claim and plate; mobile save with double click; report visible in claim; claim reload retains link; reopening from center retains saved remarks. No page errors, console errors, failed backend requests or unexpected blocked requests in the successful run.
- Viewports are browser simulations, not a claim of testing physical phones/tablets.
- The real browser fixture is an explicitly labelled, isolated synthetic Development tenant. No Production records were copied. Database proof verifies one linked inspection, one claim and no work order. The synthetic account is disabled after verification; evidence is retained.
- All 64 files in the earlier finance/security manifest remained byte-for-byte unchanged. Those pending changes were neither staged nor mixed into a new commit.

Private proof artifacts are retained in ignored `.vercel/entry-inspection-*`; no credentials or test fixture payloads belong in a release.

## Security advisor interpretation

The new narrow authenticated-only transactional writer is deliberately SECURITY DEFINER because it reuses the protected DR allocator and atomically updates the claim link. The advisor therefore reports one additional authenticated-definer notice (94 versus 93 previously). Its active-profile/role/tenant checks, anonymous revocation and identity guard were reviewed and tested; this is not suppressed to manufacture zero warnings. Existing 13 anonymous-definer notices and seven internal-RLS informational items are outside this feature. No new performance WARN was introduced.

## Files in this feature

- `src/components/vehicle-entry/VehicleEntryInspectionAction.tsx`
- `src/components/inspection/InsuranceInspectionDialog.tsx`
- `src/i18n/vehicleEntryInspection.ts`
- `src/integrations/supabase/types.ts`
- `src/lib/vehicleEntryInspection.ts`
- `src/lib/insuranceDamageReportService.ts`
- `src/pages/InsuranceInspectionPage.tsx`
- `src/pages/insurance/InsuranceClaimDetail.tsx`
- `src/pages/vehicle-entry/VehicleEntryList.tsx`
- `src/pages/vehicle-entry/VehicleVisitControlPanel.tsx`
- `src/test/vehicle-entry-inspection.test.ts`
- `src/test/vehicle-entry-inspection-action.test.tsx`
- `src/test/vehicle-entry-inspection-contract.test.ts`
- `src/test/vehicle-entry-order-link-panel.test.tsx` — preserve existing assertions and partially mock only the intended confirmation service.
- The three migrations listed above and this report.

## Remaining boundary

The feature is verified on Development/Preview only. Production rollout is a separate authorized step requiring the reviewed selective migration chain and frontend release; it has not happened in this task. This does not clear or supersede the previous finance/security release gates or declare the complete ERP Production-ready.
