# Unified customer portal and intake evidence — Production release

The owner authorized committing and pushing all customer-portal/intake changes, and releasing the application, required Supabase migrations and changed services to Production after a fresh verified backup. Existing business data, financial records, intake forms and signature pixels must remain intact.

## Reviewed scope

- Repository `alwafaoman1-cell/AAED2`, branch `codex/finance-security-development`; no merge or force push to `main`.
- Production Supabase `ifnfwssdtjuzdtshnrht`, Vercel `aaed-2` / `prj_3K1bgob3pr0yrjzElfKrnvjW79UL`, public domain https://aaed-2.vercel.app .
- Prior live deployment retained: `dpl_DKrBQ2rHmbhFceqYdiisLzPRkXNJ`.
- Application behavior and primary files are described in `unified-customer-portal-development-2026-11-14.md` and `vehicle-review-workflow-fix-development-2026-11-14.md`.
- Required migration versions, in order: `20261114131838`, `20261114143701`, `20261114151950`.
- Changed Edge service: `vehicle-entry-signature-media`. Other services remain at their existing configuration; the OCR daemon image is pinned to its current digest during the application release.

## Preservation fixes discovered by the Production preflight

1. An existing signed review has a pending claim from the previous workflow. Its four financial foreign keys and its signed snapshot are preserved. Unchanged legacy references remain editable; new, changed or detached review financial links are rejected. Review operations use the original source handover/claim/order without creating or approving new financial records. The pending historical claim is not cancelled, cleared or reassigned.
2. Existing valid customer URLs need a migration path into the plate-protected portal. Only current-owner pairs with undeleted customer/vehicle, a valid plate and an active visit or finalized delivery within ten days are bootstrapped. The rehearsal found 41 eligible pairs. The migration creates only new portal/audit rows, idempotently, and does not enable an already-paused portal or approve old handovers.
3. Legacy intake signatures with no revision remain historical signatures. Their original pixels/name/time are retained; unknown times remain unknown. They do not create a new receipt or signature on unchanged revision one. After a material edit, revision two requires fresh consent. An exact current-revision signature takes priority and preserves idempotent retry behavior.
4. Customer documents retain the technical findings frozen at intake signing. The public projection allows only the 36 typed nonfinancial form fields and report identity/revision, without arbitrary metadata or expenses. It does not substitute today's editable report for the signed one.
5. Signed photo sets are read in bounded batches, including sets larger than twelve. Unsigned previews remain limited to twelve. Missing required evidence blocks an incomplete PDF instead of silently dropping images.

## Verified release gates

- New encrypted logical checkpoint: **187 tables / 24,666 rows**. Decryption passed; **149 business tables** were restored into typed temporary tables with matching row counts and fingerprints. It includes 88 entries, 26 intake signatures, 2 frozen revisions, 91 handovers and 2 receipts. No live table was restored or overwritten.
- The existing completed physical database backup `2256859910`, from `2026-11-13T22:00:44.938Z`, was less than 24 hours old at preflight. The new logical checkpoint is separate and fresh for this release.
- Storage backup: **658 objects / 341,250,468 bytes**, downloaded read-only, individually encrypted, decrypted again and hash-verified. The previous Edge source is backed up and decrypt-verified too. No Storage file was overwritten or deleted.
- Exact-lockfile local validation used an isolated `npm ci` installation: Router 7.18.2, Supabase 2.110.2, Vite 7.3.7 and Vitest 4.1.12. Baseline: **1982 tests passed / 6 optional skips**. The final legacy/portal/PDF/Edge supplement passed **73/73**; counts overlap and are not added as unique tests. Typecheck and full-source ESLint passed. Original shared workspace dependencies were left intact.
- Development rollback tests covered the legacy duplicate-claim review through delivery, old foreign-key/financial/signed-evidence preservation, technical-report projection, idempotent legacy URL bootstrap, paused/invalid/draft/revoked exclusions, retained NULL-revision signatures, rejection of automatic re-signing, revision-two fresh signing and exact-signature retry priority.
- Production DDL rehearsal applied all three candidates and rolled back completely. All **159 pre-existing business/Storage-table fingerprints** stayed unchanged, ignoring only the two new nullable relation columns. **41 changed function bodies** and **41 changed effective ACLs** matched tested Development. Temporary copies of the real legacy review verified unchanged-reference updates and denied insert/attach/detach/move cases without updating public business rows. The actual retained-signature read path was exercised without creating a signature or receipt.

The application release uses an exact committed Git export and a staged Production deployment before moving the public alias. The cloud build repeats typecheck, lint, the complete isolated test suite and the Production environment guard. Only the three source-pinned migration versions may be applied through an isolated official CLI workspace mirroring the existing ledger. There is no blanket database push, reset or migration-history repair.

## Publication status

Preparation gates above passed. Final commit, deployment, migration/service receipt and independent live/preservation checks are recorded here after publication; this preparation entry alone does not claim a completed release.

Private evidence remains ignored under `.vercel/unified-portal-production-release-20261114/`. It contains encrypted backups, source manifests, test/build proofs and read-only checks. Backup contents, customer data, tokens, signatures, images and private QA files are excluded from GitHub.
