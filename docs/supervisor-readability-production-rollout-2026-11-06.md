# Supervisor readability and visit timing — Production rollout

Date: 2026-11-06. User explicitly requested publication after the validated
Development Preview. This is an interface/read-projection release only.

## Exact scope

- Application commit: `2050858cb7efc3f109ba039be96df6f29a43727b`.
- Branch: `codex/finance-security-development`. No main push or merge.
- Eighteen committed files: the 17 Supervisor source/test files listed in
  `supervisor-readability-and-timing-2026-11-06.md` plus that Development report.
- Unrelated local WhatsApp source, test and report files were not staged,
  committed or included in the clean Git-archive release bundle. No Edge
  function was deployed by this release.
- No migration, SQL write, backfill, renumbering, classification, posting,
  historical repair, test-data transfer or customer message.

## Build and release controls

- Production project: `prj_3K1bgob3pr0yrjzElfKrnvjW79UL` (`aaed-2`).
- Supabase: `ifnfwssdtjuzdtshnrht`; build guard checks the actual Production
  environment, project URL and public client key presence before building.
- Clean source archive from the exact commit; Windows text line endings are
  exported as LF. No business logic or tests were weakened for the export.
- Private build-only overrides include the environment guard, full typecheck,
  lint and tests. The unit-test child process has dummy backend settings and
  does not inherit Production credentials or feature flags. Integration checks
  use a separate authenticated browser with a pre-navigation write guard.
- The original security/cache headers and SPA rewrites are retained. Only
  Vite's `dist` is published, not test results, SQL sources or private helpers.
- An early package omitted the guard because of the existing deploy whitelist;
  another attempt exposed CRLF-sensitive source contracts and an OCR test's
  dependence on inherited live flags. Activation stayed blocked. The package
  and isolated test process were corrected, then the entire suite rerun.
- A source-based daemon rebuild started resolving transitive dependencies. It
  was cancelled without promotion. This UI release instead uses a build-only
  `Containerfile` containing only `FROM` the exact running Production image.
  The final build confirmed the identical image digest, not a newly resolved
  Python/OCR environment:
  `sha256:82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`.
- Its region, memory, instances, command and shutdown grace remain unchanged.
  The original application Dockerfile remains unchanged in Git. Broader OCR
  dependency-lock maintenance is outside this UI release.

## Final staged build evidence

- Production-target deployment: `dpl_9BJfA3b5ynQpPKEuKLMtcQJrtuMn`, READY.
- URL: https://aaed-2-4eqq05axe-alwafaoman1-cells-projects.vercel.app
- Staged with `--prod --skip-domain`; the Development Preview was not promoted.
- Full project typecheck PASS; lint PASS, no lint warnings/errors.
- 255 test files accounted for: 252 passed, three existing optional skips.
- 1,432 tests accounted for: 1,426 passed, zero failed, six optional skips.
- Production frontend build PASS in 24.71 seconds. Existing dependency,
  test-fixture accessibility/PDF and bundle-size warnings are not claimed fixed.
- Actual staged asset inspection PASS: Production backend only, public key
  only, no Development project reference; new Supervisor module
  `/assets/SupervisorApp-DNzpLolI.js`, main `/assets/index-DAuMPjvZ.js`.
- Previous live deployment retained for rollback:
  `dpl_k4SFxCbJu7XwrDEaFnif9df7cAk9`.

## Runtime and data verification

**Status: PUBLISHED AND LIVE READ-ONLY SMOKE PASSED.**

- Live URL: https://aaed-2.vercel.app/supervisor
- The live alias resolves to the same staged Production deployment
  `dpl_9BJfA3b5ynQpPKEuKLMtcQJrtuMn`. Live and staged main/Supervisor asset
  hashes match. No rebuild or Development Preview promotion was used.
- The protected staged-browser attempt reached Vercel login, not the app: its
  existing Trusted Sources rules do not accept that caller/environment pair.
  Its temporary test Auth session was revoked. Protection was not disabled,
  broadened or bypassed with a new share link. Staged assets were inspected via
  the existing authenticated CLI; the same build was subsequently exercised on
  the normal live alias, with the old deployment retained for rollback.
- Actual live-browser smoke PASS: eleven checks and eight surrounding routes,
  all eight returning HTTP 200 with visible page headings. It verified real
  existing-admin login, scoped palette, both clocks, stage panel without site
  navigation, expense history, both themes, Arabic RTL, internal entry wizard,
  actual insurance inspection prefill and the existing admin read-only Edge
  action. No entry, transition, expense, message or financial record was saved.
- Viewports: 1440×1000, 1180×820, 820×1180 and 390×844. First-card height was
  389 px in each; buttons were 44 px high. No horizontal document overflow.
- Console errors 0, page errors 0, backend HTTP errors 0, unexpected/blocked
  reads or writes 0. The mutation guard preceded navigation. WebSocket Realtime
  is deliberately not exercised by this read-only Production smoke.
- The temporary live test Auth session was revoked with local scope only;
  other users' sessions were not logged out. No email/password/user creation.
- OCR daemon after promotion: READY, desired/ready/alive 1/1/1, `syd1`, 2 GiB,
  the exact unchanged image digest above, existing `python worker.py` command.

Read-only baseline: 96 insurance report facts, zero settlement/receivable
differences, paid total OMR 70,791.932. Migration ledger: 236 rows, latest
`20261105171642`. No new migration is part of this release.
Post-promotion read-only comparison confirmed that the ledger and all four
financial baseline values are unchanged; settlement/receivable differences
remain zero. This is a bounded financial read-model check, not an assertion
that every historical row in every table was exhaustively audited today.

Private verification evidence and temporary authentication material stay in
ignored `.vercel/`; they are not committed or served. The smoke does not save a
transition, expense, entry, message or financial record. It is not certification
of every historical record, physical iPad/Safari behavior, real WhatsApp delivery
or the accuracy of OCR on new documents.

**Decision: Supervisor readability/timing release verified on Production.**
Unrelated WhatsApp/Meta access and other prior broad-audit items remain outside
this release. This is not an all-platform, zero-warning or 100%-readiness claim.
