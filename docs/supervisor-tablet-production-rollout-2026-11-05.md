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
- Production publish and live smoke results will be appended after they are observed; backend installation alone is not deployment completion.
