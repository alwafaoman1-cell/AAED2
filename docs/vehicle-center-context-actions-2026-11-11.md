# Vehicle center: approved concept implementation

## Scope

Implemented the approved mobile concept in the existing vehicle center. Local implementation only: no commit, push, deployment, migration, backfill or Production data access. The unrelated dirty worktree changes are retained and must not be bundled automatically.

## Presentation

- Three location tabs: In workshop, With customer, Awaiting arrival.
- Delivered/Cancelled remain accessible through Records, with counts from the same bounded center RPC. Opening the menu does not fetch closed history; choosing a category fetches its page. Review is a separate visible counted action, not buried in archived records.
- Four compact work-stage filters inside In workshop only. Other categories have no redundant stage-filter grid. Switching category clears the stage filter; a hidden stage filter never filters a non-workshop category.
- One contextual primary action per vehicle plus a More menu. The existing location/stage controller, full file, inspection permission guard, selection, printing, Excel export, pagination and list/board options are retained.
- Compact mobile/board cards use the existing rear thumbnail URL, model, plate, customer and reference. Prior visit fields remain available through Visit details. The 64px card image option does not fetch or store a second image.
- Existing dark/light themes and Arabic/English direction are preserved; no generated-image logo, synthetic data or bitmap UI was embedded in the application.

## Canonical action flow

`vehicleCenterPresentation.ts` produces read-only list affordances using the existing next-stage blocker. It is not an authorization or persistence layer. Clicking a contextual action opens the existing quick-action controller, forces a fresh lightweight read, checks stage/review state and permissions, then opens the original approval, transition, arrival or handover UI. A stale or forbidden shortcut does not submit anything. Arrival still needs physical confirmation. Delivery still uses the existing handover procedure. All mutations, revision checks, paper/electronic signature logic and confirmed readback are unchanged.

Changes to existing controller files only add optional UI-intent/ref entry points. Other callers, including supervisor mode, retain their default behavior.

## Files for this task

- `src/lib/vehicleCenterPresentation.ts` (new read-only presentation helper).
- `src/lib/i18n/vehicleCenterMobile.ts` (AR/EN labels).
- `src/components/vehicle-entry/VehicleCenterNavigation.tsx` (new).
- `src/components/vehicle-entry/VehicleCenterCard.tsx` (new).
- `src/components/vehicle-entry/VehicleCenterRowActions.tsx` (new).
- `src/components/vehicles/VehicleRearThumbnail.tsx` (optional card size).
- `src/pages/vehicle-entry/VehicleEntryList.tsx`.
- `src/pages/vehicle-entry/VehicleVisitQuickActionDialog.tsx`.
- `src/pages/vehicle-entry/VehicleVisitControlPanel.tsx`.
- `src/components/vehicle-entry/VehicleVisitInlineActions.tsx`.
- `src/components/vehicle-entry/VehicleVisitLocationPanel.tsx`.
- `src/test/vehicle-center-presentation.test.ts` (new).
- `src/test/vehicle-entry-list-tabs.test.tsx`.
- `src/test/vehicle-visit-quick-action.test.tsx`.

Several existing files contain older changes too. A future release must isolate these UI hunks against the deployed source, not publish the worktree wholesale.

## Validation

Continuation verification completed on 2026-11-11. No application code was changed during this continuation; the existing implementation was reviewed and this report updated.

- Fresh full-project TypeScript check: passed (exit 0).
- Fresh full-project ESLint: passed (exit 0).
- Fresh targeted Vitest run: 5 files, 64 tests passed (exit 0), covering presentation, list tabs, quick actions, transition controller and technical declaration. Log: `.vercel/center-structure-resumed-target.log`.
- Fresh Vite production-mode local build including PWA generation: passed (exit 0). The existing chunk-size warning remains. Output: `.vercel/center-structure-resumed-dist`; log: `.vercel/center-structure-resumed-build.log`.
- The broad regression run was interrupted after memory pressure and two 5-second test timeouts. Both affected files passed in the subsequent isolated targeted run, without test or application changes. The full suite is **not certified complete** by this continuation. Partial log: `.vercel/center-structure-resumed-tests.log`.
- Existing browser evidence was inspected, not rerun: `.vercel/center-structure-browser-proof.json` records Arabic/English at five widths, no business writes, no console/page/HTTP errors and a revoked test session. The Arabic 390px screenshot was visually reviewed during continuation. Screenshots: `output/vehicle-center-structure-2026-11-11/`.
- React Router future-flag notices and a ref warning from a mocked location panel remain in test output; the targeted tests pass. No backend, role-wide RLS, physical-device or physical-print certification is implied.

The 2026-11-11 browser validation used a real Development authenticated session, production-mode local build and intercepted illustrative visits. It did not insert test business records or certify live Production data, backend RLS for every role, physical iPhone/Safari behavior or physical printing. Production: **Not Applied**.

## Comprehensive verification — 2026-11-12

Scope: finish comprehensive local verification of the approved structure and canonical actions. No application code, database, real account, business record, Git commit, remote, push or deployment was changed by this continuation.

### Findings and test changes

The first complete run had 1,854 passing tests and two failures (plus six skips). Both failures were obsolete source-text assertions: one required the superseded stage heading, and one counted three inline inspection components before the list/card action extraction. Neither failure demonstrated an application regression.

Changed test files:

- `src/test/vehicle-center-stage-actions.test.ts`: retain localization checks without requiring an obsolete heading or implementation string.
- `src/test/vehicle-entry-inspection-contract.test.ts`: retain operational-file permission and persistence contracts; replace the obsolete inline-component-count requirement with runtime coverage below.
- `src/test/vehicle-entry-list-tabs.test.tsx`: eight additional runtime cases. Arabic/English cases verify that clicking a selected stage twice retains it, All stages clears it, and leaving the workshop clears and hides the stage filter. Six cases exercise the actual inspection menu in desktop list, mobile cards and board view, permitting an eligible insurance visit for a manager and withholding it for a technician or a cash visit. The actual permission component is used, with an explicit test profile role.

### Results

- Complete second Vitest run: **298 files passed, 3 files skipped; 1,864 tests passed, 6 skipped, zero failures**, exit 0, 379.22 seconds. Log: `.vercel/center-structure-full-tests-final-2026-11-12.log`.
- Initial targeted verification of changed contracts: 3 files / 36 tests passed. Log: `.vercel/center-structure-target-2026-11-12.log`.
- Final targeted rerun after the type-only query-option cleanup: **3 files / 36 tests passed**, exit 0, 21.94 seconds. Log: `.vercel/center-structure-target-final-2026-11-12.log`.
- Full-project ESLint: passed, exit 0. Log: `.vercel/center-structure-lint-final-2026-11-12.log`. Scoped `git diff --check` passed; Git only reported its existing LF-to-CRLF normalization notice.
- Full-project TypeScript: passed, exit 0. Typecheck exposed three unsupported Testing Library query options in the new tests; removing those redundant `exact` options preserves the default exact string matching. Log: `.vercel/center-structure-typecheck-final-2026-11-12.log`. The complete run preceded this type-only query-option cleanup; the final focused rerun covers the changed files.
- Fresh Vite production-mode local build and PWA generation: passed, exit 0. Built with deliberately fictitious fixture Supabase configuration, not live credentials. Log: `.vercel/center-structure-build-2026-11-12.log`; output: `.vercel/center-structure-offline-dist-2026-11-12/`. Existing chunk-size warning remains.
- Fresh browser verification: **PASS**, Arabic/English, widths 320/390/430/834/1366, dark/light mobile views, no horizontal overflow or header-button overlap. Three location tabs, four workshop-only stages, Records/Review, next-stage confirmation, physical-arrival confirmation, detail-menu Escape handling, filter disclosure, print invocation, new-entry dialog and navigation were exercised. No console/page/HTTP errors and zero business writes. Proof: `.vercel/center-structure-offline-browser-proof-2026-11-12.json`; screenshots: `output/vehicle-center-structure-2026-11-12/`. English 390px and Arabic light customer-tab screenshots were visually reviewed.
- Browser requests were fully intercepted with local fixtures, including identity and tenant/role reads. No real session was created, and isolated browser contexts and the local preview server were closed. The first browser attempt pressed Escape during menu-to-dialog focus transfer; the harness now waits for the menu to close and focuses the actual dialog before testing Escape. Retained first-attempt proof: `.vercel/center-structure-offline-browser-first-attempt-2026-11-12.json`. No application change was necessary.

Existing quick-action and controller runtime tests also cover approval, original handover UI, fresh-read gating, changed-stage/role rejection, revision-aware save/readback, and physical-return prerequisites. These are local contract/UI tests, not live backend transition certification.

### Boundaries

The six default skips require real OCR opt-ins/private samples or externally supplied Development SQL-parity results. They were not silently enabled or represented as passing. React Router notices and the existing mocked-component ref warning remain non-failing test warnings. Live Production data/RLS, real save transactions, physical iPhone/Safari and physical paper output remain outside this local verification. **Production: Not Applied. No commit, push or deployment.**
