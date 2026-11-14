# Vehicle review returns and receipt delivery confirmation — Production release

Owner authorization: push the reviewed vehicle-review return changes to GitHub and deploy the application and required database migration to Production after taking and verifying a fresh backup. Preserve existing business data, forms and signatures.

## Release scope

The implementation is documented in `vehicle-review-return-development-2026-11-14.md`: a separate review visit linked to the previous signed delivery, required arrival/reason/condition/current delivering person, fresh signature and receipt, retry/duplicate protection, immutable audit context, and a separate signed delivery confirmation in the used receipt document. Existing insurance and cash accounting flows remain separate; review arrival does not automatically create financial records.

- Repository: `alwafaoman1-cell/AAED2`, branch `codex/finance-security-development`.
- Production Supabase: `ifnfwssdtjuzdtshnrht`.
- Production Vercel project: `aaed-2` / `prj_3K1bgob3pr0yrjzElfKrnvjW79UL`.
- Public domain: https://aaed-2.vercel.app .
- Exact migration: `20261114075025_vehicle_review_return_and_receipt_delivery_confirmation.sql`.
- Previous live deployment retained for rollback: `dpl_iQKEMbumHumciqbfhM2tYbPvUw46`.
- No Edge Function source changed for this feature. Existing hosted signing-media service remains in place.

## Development evidence

Complete test run: 1903 passed, 6 existing optional tests skipped (306 files passed / 3 skipped). Project TypeScript build, full source ESLint, local build and diff whitespace checks passed. Development database rehearsal and applied-schema tests verified fresh signing/receipt, immutable old evidence, repeat request/active-visit deduplication and denied direct table access. Actual PDFs were downloaded and rendered; both the review receipt and used receipt with delivery signatures fit one A4 page for the tested content.

The fictional Development visit and synthetic test signatures are not copied to Production. Detailed Development test coverage is in the linked implementation report.

## Release gates

The release uses a fresh encrypted Production checkpoint, typed temporary-table restore with fingerprints, a rolled-back Production DDL rehearsal, exact migration-ledger comparison and an isolated Git export. Source files are audited for private credentials and compared against their committed Git blobs. Production environment guards prohibit Development credentials and the loopback signing-media override. The existing OCR worker image is pinned to its current digest.

A staged Production deployment runs typecheck, source lint, the complete test suite and the build before the live alias moves. Database migration application is limited to the exact reviewed file through a ledger-matched official CLI workspace. No blanket database push, reset, business-row repair, message send, customer signature submission or receipt consumption is part of Production release verification.

## Final outcome

**Published and independently verified:** https://aaed-2.vercel.app .

- Application/source commit: `d0185a9cd7d0007b082ef9fb1985160774a6f0c4`, pushed to `codex/finance-security-development`. This report completion is a later documentation-only commit.
- Production deployment: `dpl_DKrBQ2rHmbhFceqYdiisLzPRkXNJ`, READY and promoted. Immutable URL: https://aaed-2-b9oezfbki-alwafaoman1-cells-projects.vercel.app .
- Prepared-source digest: `6a6b00b2cababf3985d9fe1d3bb43be14bd7bfa3bf36569c311531c5d94a2a9a`. All 1,663 exported Git blobs matched the application commit before bounded deployment-only environment/test guards and the existing OCR image pin were added.
- Cloud gates: TypeScript PASS, full-source ESLint PASS, **1903 tests passed / 0 failed / 6 existing optional skips**, Production environment guard PASS and Vite build PASS.
- Physical backup `2256859910`, completed `2026-11-13T22:00:44.938Z`, was under 24 hours old. A new encrypted logical checkpoint captured 186 tables / 24,582 rows. Decryption verified; all 148 business tables restored into typed temporary tables with exact row-count/hash matches. No full physical restore or replacement of the live database was performed. Checkpoint plaintext SHA-256: `4036b9e21324c906e0cef0d3fd6f1ebee1a9e415b44a887bbe9e55dba5b2bcc6`.
- Production DDL rehearsal passed and rolled back completely: 158 existing business/Storage table fingerprints unchanged and all three changed/new function definitions, owners and effective ACLs matched tested Development.
- Official CLI applied only migration `20261114075025`; all 252 earlier migration ledger rows were preserved. No blanket database push, reset, ledger repair or business-row restoration occurred.
- Ordinary active administrator read-only checks passed for receipt permissions and the new RPC's rejection of absent arrival/details. Anonymous execution is denied; immutable metadata/relationship triggers are enabled, with the metadata guard running as invoker. The new table retains RLS and denies direct table access to anonymous, authenticated and service roles.
- Actual staged protected routes and the public live routes returned the expected SPA shell and new main asset `/assets/index-DDdTZx-v.js` with the Production Supabase URL. Cache policy checks passed. The browser opened the normal staff sign-in page; no Production sign-in/session or fictional review visit/signature was created for verification.
- The OCR worker remained ready 1/1 on the exact previous image digest `82c8c777a7e976538736cdbe6b66dba8f721cce360bebded1bb95ed8aaa3797f`. Unchanged Edge Functions were not redeployed.

## Preserved evidence and concurrent user activity

The final post-promotion read-only check matched all **25 prior intake signatures, the existing immutable signed revision and all 90 prior handover rows** against the fresh checkpoint. It also preserved the additional signed handover created by staff while the release was being prepared.

The broad comparison correctly detected normal workshop activity during preparation. Thirteen existing rows across eight tables changed through a signed delivery, a repair-ready update and a new claim/work-order linkage. These were reviewed using their real primary keys, changed fields, timestamps, added handover, visit transitions and entry audit events, tied to an already-active staff actor. Some activity occurred after DDL application while the previous frontend was still live; the migration contains no business-row updates. The signed intake's material fields and revision remained unchanged while its workflow links advanced normally. Prior audit events were preserved. User changes were left intact; no old values were restored over them.

The raw comparator remains marked for concurrent-activity review in private evidence; the separately reviewed preservation proof passed after verifying those exact changes. A local verifier's JSON-list/database-tuple comparison was corrected using exact function-body/owner and effective-ACL comparisons. Connection probes were serialized because the CLI's temporary database login can rotate between concurrent connections. Neither verification issue changed business data or required a source/SQL alteration.

## Security notices and recovery boundaries

The advisor delta is expected: the new RPC-only table has RLS with no direct-access policies, and the explicitly authorized, tenant/staff-checked RPC is listed as authenticated SECURITY DEFINER. No new anonymous callable function was added. Existing unrelated advisor notices were not modified.

References: [RPC-only RLS notice](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [authenticated function notice](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable).

The previous application deployment remains available for rollback. Preserve the additive relation/audit records and signed evidence if reverting the frontend; do not drop tables or restore the old checkpoint over later workshop work. Complete functional return/signature/PDF testing was performed in Development; Production verification remained read-only apart from the approved DDL and deployment.

Detailed private evidence stays ignored under `.vercel/release-20261114/`: checkpoint, backup/rehearsal/build proofs, exact migration receipt, raw/reviewed database comparisons, encrypted concurrent-work review, read-only API checks, advisor delta, staged/live HTTP checks and final signed-evidence preservation proof. Backup contents, credentials, signatures, customer data and private QA artifacts were not pushed to GitHub.
