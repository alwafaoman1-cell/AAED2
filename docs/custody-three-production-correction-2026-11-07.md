# Three owner-confirmed workshop locations — actual Production correction

Result: **APPLIED AND READ-BACK VERIFIED** on Supabase Production `ifnfwssdtjuzdtshnrht`, 2026-11-07. No frontend deployment was needed for this data-only correction.

The owner explicitly confirmed all three vehicles are inside the workshop. This attestation resolves physical custody only; the previously identified Tesla/Lexus/Fortuner identity conflicts remain untouched and still block claiming the complete historical repair/release finished.

| Entry | Vehicle | Entry location after correction | Claim presence | Bay retained |
| --- | --- | --- | --- | --- |
| ENT-2026-0053 | Toyota Camry RW 2525 | داخل الورشة | in_workshop | 21 |
| ENT-2026-0054 | Nissan Micra TH 369 | داخل الورشة | in_workshop | 10 |
| ENT-2026-0058 | Hyundai Venue TB 4556 | داخل الورشة | in_workshop | 1 |

## Exact change

- Used the existing guarded `reconcile_vehicle_visit_custody` procedure for the three linked claims, under the ordinary existing administrator's authenticated tenant/role context.
- Normalized only the third entry's free-text `ساحة الورشة الخارجية` label to canonical `داخل الورشة`; its complete old/new record values and the owner's reason are retained in an audit event. The original bay and all saved snapshots remain unchanged.
- Four audit events: three custody corrections and one yard-label normalization. No audit event was deleted or rewritten.
- The three pending claims remain **pending**, and their center milestone is **arrived**. No approval, work order, payment, exit, new arrival, signature or final delivery was manufactured.

## Safety and validation

- Completed physical database backup `2187497120`, `2026-11-06T21:56:59.078Z`, verified before writing; age 18.3 hours at the gate.
- Fresh local DPAPI-encrypted before-image, current function/policy/catalogue/migration history and table fingerprints; decryption verified. A separate encrypted after-image supports conditional field-only reversal. These targeted artifacts are not claimed as a full Storage-content backup or an exercised physical database restore.
- Actual Development rehearsal used synthetic equivalents only, in a transaction rolled back completely. Production rows were not copied to Development. The relevant guarded procedure and conflicting-entry helper definitions match Production.
- Development tested: all three corrections, yard/bay preservation, stage/custody projection, required reason, stale-record rejection, wrong-tenant rejection, conditional reversal, and unchanged database state after rollback.
- Targeted regression: **39 passed, 0 failed, 0 skipped** across three files; lint of the added regression file passed. No app component/dependency was changed, so a new full frontend build/suite was not run for this data-only operation.
- Actual Production correction used one atomic transaction, exact locked IDs and before-image/version checks, existing RLS/business guards and a closed list of three entries. No guard, trigger or policy was disabled.
- Before/after checks inside that transaction proved every unrelated public/private business row, financial row/report, vehicle/customer/owner, Storage object, numbering sequence and schema/migration-ledger definition unchanged. The targeted entry/claim records were separately compared field by field: only current presence/location and their modification timestamps changed.
- A fresh connection independently read the exact persisted after-image. The center RPC under authenticated administrator RLS returns all three in **in_workshop**, stage **arrived**, no review reason. Each has one correction audit and no duplicate-entry conflict.
- A browser verification attempt reached the site's login screen; no credentials were entered. This report distinguishes the verified live database/RLS/center response from a visually verified logged-in browser session.

## Files and retained evidence

- Reviewed repair SQL (not a migration): `supabase/production/vehicle-visits/20261107_confirm_three_inside_workshop.sql`.
- Regression: `src/test/owner-confirmed-custody-repair-contract.test.ts`.
- Ignored bounded runner: `.vercel/custody-three-repair.py`.
- Private evidence: `.vercel/custody-three-checkpoint.json`, `.vercel/custody-three-development.json`, `.vercel/custody-three-applied.json`, `.vercel/custody-three-verified.json`, `.vercel/custody-three-regression.json`, and encrypted before/after `.dpapi` files. No credentials or private snapshots enter a deployment bundle.
- Executed SQL SHA256: `8def6504d16a6bd51bc7bad8a73d9b5733999e121aafd73ade936eab58dd90ad`.
- No migration, broad push, backfill, vehicle merge, historical date edit, archive change, financial posting, Git commit/push or frontend deployment.

The four unrelated existing-link candidates, closed/historical unsigned handovers, and three unresolved vehicle-identity choices were not silently repaired with this confirmation.
