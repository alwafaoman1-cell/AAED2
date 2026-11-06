# Supervisor readability, tablet density and visit timing

Date: 2026-11-06. Scope: the existing Supervisor workspace, not a replacement
application or a new operational data source. Production remains NOT APPLIED.
No Git commit, push, migration, backfill, accounting change or historical repair
is part of this task. Earlier WhatsApp hotfix files remain a separate change set.

## Changes

- Lower-saturation screen tokens for Supervisor only, including portalled
  dialogs. Leaving Supervisor restores the existing site's branding unchanged.
  Tenant preferences place brand colors inline on `html`; the screen palette is
  deliberately scoped on its `body` descendant so inherited branding cannot
  silently override it. No `!important`, saved-brand edit or theme duplication.
- The light/dark button uses the project's actual ThemeContext, not an unprovided
  third-party context. Its operational behavior has a regression test.
- Smaller cards and tighter spacing: two columns on portrait tablet, three on
  landscape tablet, four on wide desktop. Buttons retain 44-pixel touch targets.
  References stay on one line, rear photos use the existing canonical source,
  and there are no new photo uploads or stores.
- Stage and expense are the primary actions; photos, parts and communication
  remain directly available. The overflow menu keeps Visit and Customer QR.
  Custody has a direct per-vehicle action rather than requiring a site page.
- Stage controls use a compact panel with a clear progress strip. Linked-record
  details, earlier-stage/cancellation actions and history are expandable.
  Optional transition notes/requirements are expandable; date, responsible user,
  cash approval, cancellation/reversal reason and backend prerequisites remain.
- Insurance approval uses the existing guarded claim approval component inside
  Supervisor instead of sending the user to the insurance administration page.
  No Supervisor approval escalation was introduced.
- Existing entry, technical declaration and temporary-release pages keep their
  `/supervisor/entry/...` shell. Final handover and order status reuse existing
  components and confirmed cloud readback. A claim-only arrival link now also
  stays under Supervisor. Customer QR/PDF/external communication retain their
  intended explicit destinations.
- Added a clear-filter control. Queries remain bounded, server-filtered and
  active-tab-only; archived/terminal lists are not loaded in full on startup.

## Day-count rules

Both counters are read-only projections; no dates are rewritten:

1. **Since arrival / inspection** uses the actual saved entry arrival date, not
   creation/update timestamps. Claim-only registrations and legacy orders without
   a confirmed visit do not fabricate an arrival duration.
2. **Since repair approval** uses the recorded insurer approval date, falling
   back to its recorded approval timestamp. Cash uses the actual Arrived-to-
   Approved visit event. Order creation, work start, workflow `changed_at` and
   restoration from cancellation are never substituted for approval.
3. Counts are elapsed calendar days in Asia/Muscat, not browser timezone or
   complete 24-hour blocks. Same-day arrival displays Today.
4. Days 0–15 are green; 16–25 are red; over 25 has stronger red emphasis and an
   explicit priority-review label/icon. Color is not the only signal.
5. Delivered/cancelled counts stop at recorded terminal evidence. Unknown,
   invalid, future or unconfirmed dates remain visibly unknown/review-required,
   never a green zero. Customer custody does not silently reset either clock.

One tenant-scoped projection reads only approval/delivery/cancellation events
for the visible page (at most 20 unique entries). It fails closed on query
errors, foreign rows or history truncation. No N+1/full-history startup scan or
new database column/RPC was added. One minute/focus clock serves the whole page.

## Verification evidence

- The actual existing Production Supervisor was inspected read-only before
  editing. No transition or other operational write was performed there.
- Local targeted checks passed. Full local typechecking exceeded the deliberately
  bounded 640 MB heap; this is an environment limitation, not a passing result.
  Full verification was therefore moved to the existing 8 GB Preview builder.
- Automated contrast calculation of the new foreground/card, muted/card,
  primary/button and green/red pairs passed the 4.5:1 normal-text threshold in
  both themes. Observed ratios ranged from 6.49:1 to 14.35:1 for these pairs.
- Initial Preview assembly dropped existing security headers from an old QA
  template. The security regression test correctly failed. The private staging
  helper now carries the project's existing headers; the test was not weakened.
- An intermediate full run passed 1,425 tests with zero failures and six existing
  optional skips. Final source verification and browser evidence are recorded
  below when complete; the intermediate run is not final-source certification.
- Real Development browser measurements showed 389-pixel-high cards at desktop,
  tablet landscape/portrait and mobile, with no document horizontal overflow and
  44-pixel button heights. Landscape tablet cards were approximately 375 pixels
  wide, portrait tablet approximately 388 pixels.
- Browser verification detected the branding override and incorrect theme-hook
  integration, both repaired at their sources. A separate test-harness fontconfig
  initialization error was repaired; it was not an OCR/application failure.
- Existing retained Development fixtures have already reached In Progress.
  The next transition is correctly blocked until work-order completion. Their
  dates/history are not rewritten just to make a screenshot or test pass.

## Final verification

- Final Development Preview:
  https://temo-work-order-preview-qhjoycekt-alwafaoman1-cells-projects.vercel.app/supervisor
- Deployment: `dpl_Dj3aiVPwXhwykjFV3bgBK6wHciSi`, READY, Preview target;
  Development-only environment guard passed. No OCR daemon or migration job ran.
- Full typecheck PASS, lint PASS with zero lint warnings/errors, all **1,432**
  tests accounted for: **1,426 passed, zero failed, six existing optional skips**.
  Production-mode Vite build PASS in 33.25 seconds. Existing dependency
  deprecation/install warnings and the main bundle size are not claimed fixed.
- All 17 changed/new Supervisor source/test files match the uploaded snapshot
  byte-for-byte. Snapshot checking also included the separate, already-tested
  WhatsApp contract test, for 18 files total; no Edge function was redeployed.
  Digest: `6003e567683ba7f15625f148fafb120a09ec6468f2b9d72f19b1b82a97dba06d`.
- Actual browser regression on the final Preview: PASS, ten checks, zero console
  errors, zero page errors, zero HTTP errors and zero blocked/unexpected writes.
  It exercised real Development login, canonical center/history reads, the saved
  branding override, responsive sizes, completion prerequisite and its in-app
  editor, temporary-release route, saved visit/technical actions, theme switching,
  Arabic RTL and English LTR. It did not save new operational records or send.
- The compact confirmation form, existing revision/responsible-user/date payload,
  approval permission and confirmed readback are additionally covered by actual
  component tests. The retained browser fixtures were not reversed or rewritten
  to force an otherwise blocked forward transition.
- Responsive viewports: 1440×1000 desktop, 1180×820 and 820×1180 tablets,
  390×844 mobile. Screenshot evidence is retained in ignored
  `.vercel/supervisor-compact-*.png`; test evidence is in
  `.vercel/supervisor-compact-e2e.json` and `supervisor-compact-integrity.json`.
- Both isolated Development test profiles are disabled again, with zero remaining
  Auth sessions. Two existing entries, two orders, one claim and one expense were
  retained; no duplicate or financial document/posting was created. Provider
  logs remain zero. A previous sender test's retained **dry_run** log from
  2026-11-05 remains untouched (no provider message ID); it is not a real send.
- The older fixture verifier failed because it equated any message-log row with
  a real send. A separate current read-only check verified the dry-run evidence,
  zero financial/provider writes and sealed sessions, rather than deleting the
  old log to make that baseline green. The older aggregate Auth fingerprint
  discrepancy in the three-preexisting-user baseline remains outside this UI task; no account
  repair or claim that the broader old audit is cleared was made.

**Decision: verified Development Preview ready for review. Production not
published; no commit or push.** Physical iPad/Safari validation remains a review
step. The previously reported Meta sender verification/access gate is unchanged.

## Files in this change set

- `src/components/supervisor/SupervisorActionPanel.tsx`
- `src/components/supervisor/SupervisorStagesPanel.tsx`
- `src/components/supervisor/SupervisorVehicleCard.tsx`
- `src/components/supervisor/SupervisorVisitClocks.tsx`
- `src/hooks/useSupervisorTheme.ts`
- `src/lib/i18n/supervisorWorkspace.ts`
- `src/lib/supervisorVisitTiming.ts`
- `src/lib/supervisorWorkspace.ts`
- `src/pages/apps/SupervisorApp.tsx`
- `src/pages/apps/SupervisorEntryWorkspace.tsx`
- `src/pages/vehicle-entry/VehicleVisitControlPanel.tsx`
- `src/pages/vehicle-entry/VehicleVisitQuickActionDialog.tsx`
- `src/styles/supervisorWorkspace.css`
- `src/test/supervisor-compact-ui.test.tsx`
- `src/test/supervisor-stage-ui.test.tsx`
- `src/test/supervisor-visit-timing.test.ts`
- `src/test/supervisor-workspace.test.tsx`

Private QA scripts, synthetic fixture credentials and screenshots remain ignored
under `.vercel/`. They are not deployment source inputs or public account data.
Physical iPad/Safari/touch/camera testing is not equivalent to Chromium viewport
testing and is not claimed. This is not certification of unrelated preexisting
financial, OCR, security-advisor, translation or live-provider workflows.
