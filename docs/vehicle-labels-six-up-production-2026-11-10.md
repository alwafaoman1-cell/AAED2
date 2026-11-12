# Production rollout — six-up internal vehicle cards and custody tabs

Status: **Published and verified** on https://aaed-2.vercel.app/vehicle-entry, 10 November 2026.

## Released scope

Only the sixteen files listed in the Development report and its frozen manifest were overlaid on the verified live-source baseline. They provide individual/page/all-filtered selection, six internal cards per A4 sheet, a separate Awaiting arrival tab, the clarified temporary With customer tab, and the corresponding supervisor display/timing consistency. Existing single-card thermal printing, accounting, invoices, receipts, financial numbering, signatures and lifecycle mutation procedures were not changed.

The frontend source under `src/` and `supabase/` was verified byte-for-byte against the tested Development snapshot. Production configuration and its existing environment guard were retained from the prior live release. The guard verified the Production Supabase project and public client key; unit tests used isolated dummy configuration rather than Production credentials.

## Release identity

- Production deployment: `dpl_AtH5p5DM5c56rfKeUr5TmFgGj8bd`.
- Source digest: `46310118f45dbd5d0c25d7a51c01e45081d415c618cd4bc5a6d5e0f519a01fd7`.
- Staged Production URL: https://aaed-2-ci1fphouu-alwafaoman1-cells-projects.vercel.app.
- Previous live deployment: `dpl_GvSLWtSXfBrYTttTkWJTRkRiyQuh`.
- Source base: `bcc4b64469651614bef484df76c0a74845ac64b9`. No new Git commit, push or main merge was created. Unrelated dirty-worktree changes were excluded.
- Frozen release manifest: ignored `.vercel/vehicle-labels-production-manifest.json`. Use this latest verified live baseline, not an older snapshot, for a subsequent selective release.

## Backup and selective database change

Completed physical backup **2216914850**, created **2026-11-09T21:57:02.400Z**, was verified as less than 24 hours old (7.82 hours at checkpoint). No physical restore was performed.

Existing function definitions/ACLs, protected business-table fingerprints and sequence state were captured locally in a DPAPI-encrypted checkpoint. Decryption was verified; plaintext SHA-256 is `36970a7d656bc1a82e3e1de0c804f479f65fda1a2f0e52a4d4754e9892fcb347`. No Storage object was copied, altered or deleted, and no new S3 credentials were created.

Exactly one migration was applied: **20261110051157_vehicle_center_awaiting_arrival_tab.sql**, SHA-256 `fb2c0046fb1a21a6f4469fb643f03ca09481535b9d8fc44aaebc8cfc30a398f2`. The official CLI used a separate exact mirror of the 245 already-applied Production ledger records and exactly one pending migration. There was no blanket `db push`, manual ledger edit or unrelated migration.

The migration adds only the read-only security-invoker `vehicle_visit_center_page_v3`; v1/v2 definitions and ACLs remain identical. The existing bounded/set-based evidence bridge, source-table RLS, active-role/tenant guards, duplicate checks and paging remain intact. Anonymous execution is denied; wrong-tenant authenticated execution returns `42501`. Security Advisor reported no finding against the new endpoint. Existing unrelated warnings were not modified or claimed resolved.

Across the migration window, fingerprints of **40 business tables** and PostgreSQL sequence values were identical before and after. This includes financial documents, payments, receipts, invoice registries, journals, expenses, vehicles, customers, claims, work orders, entries, workflow history, media and signed documents. No business-data DML, historical repair/backfill, reclassification, renumbering or test-data insertion was performed in Production.

## Verification results

- Full typecheck: PASS.
- Full lint: PASS.
- Production build: PASS.
- Full regression: **1,797 total; 1,791 passed; 0 failed; 6 existing skips; 622 suites**.
- Authenticated read-only browser smoke: PASS on both the staged Production deployment and the live primary URL, in **Arabic/RTL and English/LTR**.
- Selected seven real vehicles across two list pages; verified native-print PDFs contain exactly **6 + 1** cards on two A4 pages, without a blank trailing page. First/last pages were rendered and visually inspected. Live Arabic PDF: 116,600 bytes; live English PDF: 114,860 bytes. These private verification files were not uploaded to Storage or exposed as public artifacts.
- Selected all filtered results: all **23** currently active workshop records were included, not just the ten visible rows. Selecting all did not eagerly load all pages; the explicit print action did. The existing result-scope consistency checks remained active.
- Verified center tabs, supervisor Awaiting arrival / With customer tabs, and Desktop/tablet/mobile widths 1366/834/390. No horizontal root overflow or blank page was observed.
- Operational browser write attempts: **0**. Blocked application reads: **0**. HTTP errors: **0**. Console errors: **0**. Page errors: **0**. Test sessions were revoked. No customer transition, signature, financial save or physical printer job was submitted.
- Vercel's optional Preview feedback toolbar was excluded from application testing. Realtime sockets were closed in the controlled read-only browser test; this does not certify live Realtime delivery on physical devices.
- Final alias and deployment READY/source identity were checked after the live smoke. OCR Worker remains ready with one replica and its unchanged pinned image; no Worker or OCR configuration was changed.

## Live activity and preservation

The initial pre/post-migration census contained 168 center rows with identical identities under v2 and v3. A normal operator then created **ENT-2026-0081** through the existing application, uploaded photos and created its linked claim at approximately 05:51–05:52 UTC, after the migration-data invariant check completed at 05:48 UTC. The test harness has no create/upload/claim mutation in its allowlist and issued no such requests. That legitimate live work was preserved, not rolled back to force an old count.

The final read-only census compared v2 and v3 within one current database snapshot: **169 identical visit identities**, no duplicate rows or missing records. Counts: In workshop 23; Awaiting arrival 0; temporary With customer 0; Delivered 108; Cancelled 33; Needs review 5. The old historical conflicts remain reviewable and were not automatically corrected. Non-empty pending-arrival and paper/electronic temporary-exit behavior was verified on isolated Development data before release; no synthetic Production records were created to force these tabs non-empty.

Two initial staged smoke attempts completed printing successfully but failed a test-harness global-idle assertion: four image-signing requests from a cancelled-record page were still being counted after its document had been replaced by navigation to the supervisor. A bounded ordinary-user Storage diagnostic returned HTTP 200 in 359/391 ms, with no service-role Storage bypass or original-image download; relevant Storage server logs also showed a successful response. The harness was corrected to track requests per current document and finish each tab read before moving on, while retaining global HTTP/console error monitoring. Its 20-second deadline was not increased, application code was not weakened, and both paced staged/live reruns passed. The initial attempt artifacts were retained privately.

## Evidence and limits

Private evidence is retained under ignored `.vercel/vehicle-labels-*`, including checkpoint, migration receipt, invariant/census proofs, full build proof, staged/live browser proofs, PDF checks and final alias/Worker verification. It is not part of the deployed source. The source file list and Development regression details are in `docs/vehicle-labels-six-up-development-2026-11-10.md`.

This certifies the scoped release, not every unrelated ERP function or existing security notice. Physical printer dispatch and physical iPhone/iPad certification were not performed. No historical financial correction, duplicate-identity merge or custody repair was included.
