# Vehicle center: compact mobile layout

Scope: presentation only. No commit, push, Preview deployment or Production deployment is authorized for this task. No schema, financial logic, lifecycle command or business-data source was changed.

## Changes in this task

- `src/pages/vehicle-entry/VehicleEntryList.tsx`: move the existing location tabs above the stage filters; use compact stage cards; keep search visible while disclosing advanced mobile filters; consolidate mobile print/export/card tools into one menu; reveal bulk card tools on selection. All existing actions and counts retain their handlers and sources. Desktop controls remain available. The mobile action menu is excluded from print media.
- `src/components/NavHistoryButtons.tsx`: use 16px arrows, neutral styling and 36px touch targets with localized accessible names; preserve history navigation and RTL/LTR semantics.
- `src/components/LanguageSwitcher.tsx`: optional compact mobile header rendering, one shared menu/handler, current language retained in its accessible name.
- `src/components/ThemeToggle.tsx`: explicit Arabic/English appearance labels. Browser review exposed an older automatic English translation of the Light option; the header now uses deliberate translations while keeping the existing theme controller.
- `src/components/AppLayout.tsx`: opt into that compact language control and prevent the history control from flex-shrinking into its neighbor. Older unrelated changes in this dirty file are not part of this task.
- `src/components/AutoBreadcrumb.tsx`: translate the vehicle-entry breadcrumb instead of displaying the route slug.
- `src/index.css`: limit the Arabic default direction to HTML without an explicit `dir`. The previous unconditional rule overrode the English document direction even though i18next had set `dir="ltr"`.
- `src/lib/i18n/vehicleCenterMobile.ts`: Arabic/English labels for the new presentation controls.
- `src/test/mobile-navigation.test.tsx`, `src/test/vehicle-entry-list-tabs.test.tsx`, `src/test/mobile-safe-area.test.ts`: regression checks for compact controls, direction, retained actions and filter/selection behavior. Existing tests and prior local changes are preserved.

This worktree contains older unrelated changes. Do not release whole files from this worktree without comparing to the deployed source and isolating this task's UI hunks.

## Verification method and limits

Local production-mode build with Supabase Development configuration only. Chrome browser QA uses an existing Development user session and intercepted, synthetic center responses (26 illustrative visits). No fixture vehicle, customer, claim or work order is inserted. The browser blocks business writes and closes its test session afterward. Screenshots show illustrative counts, not current Production counts.

Widths: 320, 390, 430, 834 and 1366 pixels in both Arabic and English. The narrowest width uses three stage rows to avoid splitting English words; 390/430 use two rows (162px). Desktop uses a single stage row. Testing covers the location tabs, stage filter, filter disclosure, mobile action menu, new-entry dialog, print invocation, selection and the inherited status-bar safe-area rules. Physical iPhone/Safari and actual paper output are not certified by viewport emulation.

Evidence:

- Screenshots: `output/vehicle-center-mobile-2026-11-11/`.
- Private local browser proof: `.vercel/center-mobile-browser-proof.json`.
- Private local build log: `.vercel/center-mobile-build.log`.
- Private local full regression log: `.vercel/center-mobile-full-tests.log`.

## Final check results

- Full project typecheck: exit 0.
- Full project ESLint: exit 0.
- Full regression run: 297 files passed, 3 files skipped; 1,837 tests passed, 6 skipped, zero failed (382.17s). This run preceded the final appearance-label test additions; the final focused run below covers those additions and the mobile print-menu exclusion.
- Final targeted regression: 4 files, 32 tests passed, zero failed.
- Fresh production-mode Vite build: passed. Existing large-chunk warning remains; it was not suppressed or addressed outside this UI scope.
- Browser: Arabic/English, five viewport widths, dark mode plus 390px light mode. No root horizontal overflow, overlapping toolbar buttons, console errors, page exceptions or HTTP errors. Mobile print invokes the original action once and its menu is hidden in print media. Filter disclosure makes no extra center read. Business writes: zero. Test session revoked afterward.
- Existing installed React Router future-flag notices remain visible in the local test logs; no library versions were changed.
- Physical iPhone/Safari and physical printing remain untested. This is UI validation with intercepted visits, not new certification of backend transitions, accounting or RLS.
- No commit/push/deploy, database migration, data repair or Production data access was performed. Production remains **Not Applied**.
