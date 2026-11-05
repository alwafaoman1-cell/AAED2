# Supervisor tablet Production rollout

User authorization: publish the validated Supervisor update to the live site, 2026-11-05. Release branch only; no main merge.

## Source and verification

- Based on `b592fbbcc13f77a9e12d3a838e3be3d0b07e8755`, preserving the previously deployed intake, finance/security and entry-inspection features.
- The 62 application/test/Development migration files have exactly the validated Preview content digest `758271bd9440a6804387c685f33885c2b69435c37edbda7d4e9207939b9d6f02`.
- Preview validation: typecheck PASS; lint zero errors/warnings; 1,400 tests total, 1,394 passed, zero failed, six existing optional skips; Production-mode build PASS. Real Development intake, expense, approval, release/return and dirty-exit flows passed. Two-window realtime propagation passed in 3,461 ms.
- This release adds the targeted Production bundle and this report. Ignored credentials, browser sessions, test harnesses, encrypted checkpoints and synthetic fixture rows are not release inputs. No Development data is transferred.

## Backend and backup

- Project: `ifnfwssdtjuzdtshnrht`.
- Completed physical backup `2167630934` was 19.28 hours old at final rehearsal. A fresh scoped, DPAPI-encrypted catalogue/state checkpoint and reverse-definition checkpoint were round-trip verified. No paid restore project or Storage key was created; a full physical restore is not claimed.
- The exact combined SQL was rehearsed against current Production in rollback, including wrong-tenant/anonymous denial, all five tabs' channel/count/stage parity and unchanged financial results. The reverse definitions were actually exercised on Development inside rollback.
- Applied only `20261105171642_supervisor_tablet_production_cutover.sql`, containing the reviewed channel filter, completed temporary-release read-only capability and media Realtime publication dependency. The local filename matches the actual returned remote ledger version; no ledger row was manually edited.
- Production already has the supplier-document duplicate dependency. The Development-only expense dependency migration was NOT applied, and Production's existing expense read scope, trigger, RLS and accounting behavior were preserved.
- Immediate pre/post cutover verification: all 145 operational table fingerprints, Auth fingerprints and public/private sequences unchanged; corrected financial projection still has zero discrepancies. No historical data repair, backfill, reclassification, renumbering, posting or synthetic invoice/payment was performed.

## Deployment boundary

Build with the existing Production environment and existing independent OCR daemon configuration; never promote the Development-backed Preview. Stage without domain assignment, check its actual backend/assets and live read-only browser behavior, then promote that same build. Preserve the previous live deployment `dpl_4schu5osFqb1viTsLE2kuyQGRcfC` for UI rollback.

Live browser verification must block business writes before navigation. Do not create or edit operational records or send real customer messages to obtain a green smoke test. Revoke only the test browser's own session, never the administrator's other sessions.

## Remaining acceptance limits

- Provider delivery/Meta templates and physical iPad/camera/printer acceptance are not certified by viewport/browser tests. Messages require explicit review; existing legacy approval notifications prevent a duplicate send.
- The earlier unexplained fingerprint difference on one preexisting Development Auth account remains disclosed in the Development report; no account was repaired or copied. Production's immediate cutover Auth fingerprint was independently unchanged.
- Existing intentional Supabase security-definer/internal-table notices and build dependency/bundle warnings are not mass-suppressed.
- Backend installation alone is not deployment completion. Observed publication results follow.

## Completed publication and observed live verification

- Application commit: `9b88002acb95ea49115dc673b7dd6bbfd25f67e3`, pushed only to `origin/codex/finance-security-development`. `main` remains `643a386d419224d6a2d9562811017264372f4434` and was not merged or pushed.
- Live Supervisor: https://aaed-2.vercel.app/supervisor
- Production deployment: `dpl_k4SFxCbJu7XwrDEaFnif9df7cAk9`, READY, built with Production variables and promoted from the staged Production URL https://aaed-2-1hc8phygq-alwafaoman1-cells-projects.vercel.app. Both `gitCommitSha` and `releaseCommit` match the application commit.
- Staged and actual live assets independently confirmed the Production backend, a public/publishable client key only, no Development client reference, the canonical Supervisor reader and internal entry path. Live assets: `index-CknJu9q3.js`, `SupervisorApp-JnBzhPaF.js`. Translation resources may be shared chunks; a literal title need not occur in the page chunk itself.
- Existing independent OCR daemon is ready on this deployment: desired/ready/alive 1/1/1, `syd1`, 2,048 MiB. This is process-readiness evidence, not a fresh customer OCR document test.
- Final signed-in Production browser smoke PASS: actual canonical visits on tablet/mobile viewports; cash/insurance filter interaction; stage panel staying within Supervisor; expense-history reading; internal entry wizard without saving; and the existing protected entry-linked inspection prefill. Eight surrounding routes returned 200 and showed their page headings: vehicle center, orders, claims, cash invoices, reports center, monthly profitability, expenses and settings. The existing paired administrator Edge read also passed.
- The successful final run recorded zero console errors, page errors, HTTP failures and unexpected blocked requests. Its current test session was revoked with local-session scope, not global administrator logout. No user was created, password changed or email sent.
- Production business mutations were denied before the first navigation. Only reviewed read RPCs, the exact email-provider `status` read and bounded signing of existing Storage objects were allowed, besides ordinary authentication. No voucher, visit, invoice, payment, transition, signature or customer message was created during live verification.
- Immediate migration proof covered all 145 operational tables. A separate post-live, relevant-source check covered 17 operational/financial/message tables: every fingerprint unchanged, source financial totals unchanged, sequence values unchanged and invoice projection discrepancies zero. Auth metadata differs after normal explicitly authorized login/session verification, not an account repair.
- The first unpinned staged build and the automatic duplicate Git Preview were cancelled and never promoted. The final staged Production build above is the one actually serving the site.

### Failures retained rather than hidden

- Browser access to the protected staged Production hostname was denied by the existing Trusted Sources environment boundary. Protection was not weakened. Staged HTTP/assets were verified through the authenticated Vercel client; full browser acceptance was then exercised on the actual live domain.
- One mixed-route attempt timed out waiting for the existing entry-inspection fields; a fresh focused read passed. A later attempt recorded HTTP 500 on `tenant_settings`; server logs for that window confirm SQLSTATE `57014` query cancellations, including settings reads. The root of that intermittent database latency is not established by this rollout. A full-table post-live fingerprint query also reached its own 70-second limit; it was stopped, not declared successful. Subsequent relevant-source verification used bounded individual table reads instead.
- The settings probe initially blocked a read-only Edge endpoint because its name contains `save`. Its implementation was inspected: only exact `{action: "status"}` was permitted afterwards; configuration writes and test emails remain denied. This does not explain away the separate real settings HTTP 500 above.
- A complete subsequent sequential browser run, with no broad fingerprint scan running alongside it, passed every check with zero backend/console errors. This successful retry does not erase the earlier intermittent timeout or constitute a claim that all performance concerns, physical-device flows or live message-provider delivery are resolved.

Private ignored evidence includes `supervisor-production-preflight.json`, `supervisor-cutover-after.json`, `supervisor-cutover-live.json`, both `supervisor-assets-*.json`, timestamped browser attempts and the final `production-browser-smoke.json`. No secrets or operational row payloads are included in this report.
