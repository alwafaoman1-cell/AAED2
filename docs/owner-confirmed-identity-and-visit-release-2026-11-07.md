# Owner-confirmed identity correction and selective vehicle-center release

## Approved scope

Owner confirmed Tesla **OM / DD / 67731**, Lexus **OM / W / 86765**, and Toyota Fortuner **OM / MS / 9707**. This settles three specific identity discrepancies, not permission to merge the vehicle registry, invent visits/signatures or change financial history.

## Completed Production correction

- Tesla ENT-2026-0009 / WO-I-26-0064: existing claim, entry, expense and media already identify DD 67731. Corrected only the work-order vehicle relationship and its existing operation relationship.
- Lexus ENT-2026-0041 / WO-I-26-0097: corrected missing claim vehicle and the unsigned entry's vehicle relationship to W 86765. Preserved saved snapshot, customer, owner and original dates. Existing estimate-change audit remains active; its revision metadata records the correction. No archived estimate was rewritten.
- Fortuner ENT-2026-0042 / WO-I-26-0099: corrected only work-order/operation vehicle relationships to MS 9707. Existing signed entry and signature are unchanged.
- Existing closed-order link protections were retained. Tesla's closed visit was not forcibly linked to bypass the missing historical handover evidence.
- No new vehicles, entries, orders, invoices, expenses, signatures, ownership changes, registry merges/deletes or financial modifications.

The exact bounded correction was rehearsed in Development using synthetic inconsistencies and active tenant/role guards, then rolled back. Stale before-image, wrong plate and wrong tenant were denied without partial changes. Production required a completed physical database backup younger than 24 hours and a fresh encrypted/decryption-verified before-image. All unrelated public/private tables, financial records, signatures, Storage, sequences and schema/ledger were fingerprinted and checked unchanged within the correction transaction. Fresh Production read-back passed.

Maintenance source: `supabase/production/vehicle-visits/20261107_owner_confirmed_vehicle_identity.sql`. Three additional regression contract tests passed. Sensitive snapshots and trusted execution controls remain ignored under `.vercel/`; they are not frontend assets or committed credentials.

## Selective backend update

Applied only `20261107115803_vehicle_visit_workspace_intake_and_projection.sql`, with its exact ledger entry in the same transaction. No blanket `db push` or historical backfill.

Actual Production function definitions were first transplanted into a Development rollback transaction. The candidate generated exactly the already-tested Development definitions; all 19 projection parity cases passed and Development was fully rolled back. Production changed only the four reviewed functions, the guarded actual-arrival RPC and one ledger row. Public business rows, financial projection, Storage objects, sequences, policies, triggers, indexes and old migration entries were unchanged. Fresh ordinary-administrator center RPC verification passed.

## Selective frontend release

Frozen tested center/workspace and supervisor inspection-release inputs were overlaid on the current live release artifact. 1,519 source inputs matched the frozen manifests; 47 explicit files were included, without unrelated dirty accounting, OCR or messaging-handler changes. Existing Production environment guards, Worker image and daemon configuration were preserved.

- Source base: `bcc4b64469651614bef484df76c0a74845ac64b9` (not a new release commit).
- Source digest: `76726c96f9b2588c4d52d6c222057a1685d769a2a4c014a27ab98dfed9afdfda`.
- Staged Production deployment: `dpl_5HhxzsVCQEaonkqamKokWaWL2KTq`.
- Full cloud gates: typecheck PASS; lint PASS; build PASS; 1,725 tests: 1,719 passed, 0 failed, 6 existing skips.
- Existing independent OCR Worker remains ready 1/1 on the identical pinned image.

Current status: **PUBLISHED AND VERIFIED ON THE LIVE PRODUCTION DOMAIN**: https://aaed-2.vercel.app/vehicle-entry . Live alias points to `dpl_5HhxzsVCQEaonkqamKokWaWL2KTq`; independent Worker remains ready 1/1 on the unchanged image. No new commit or Git push was created; exact release provenance is the frozen source digest above.

## Actual browser and post-release verification

- Staged and live-domain read-only authenticated checks passed: all five custody tabs, three corrected entry detail pages, supervisor inspection/temporary-release choices and retained supervisor route, Arabic RTL, desktop 1440px, tablet 1024px and mobile 390px. No horizontal overflow.
- A separate live regression opened and cancelled the existing Edit, Photos, Status, Expense, QR, Delete and Print dialogs; tested cash/insurance filters, search and server pagination. No destructive/save action was executed. Print iframe retained styles, contained no scripts or active attributes, and displayed real content.
- Both live browser runs: zero unexpected HTTP errors, Console errors, page errors, asset errors, blocked reads or attempted business writes. Temporary verification sessions were revoked locally without signing out other sessions.
- Fresh post-release database fingerprint check: all business rows identical to the authorized post-identity/pre-migration checkpoint; financial projection, Storage objects, sequences and old ledger entries unchanged. Exactly one approved migration added. The three previously confirmed inside-workshop records remain synchronized without review reasons.
- Center has 168 distinct cards: 23 inside, 0 with customer, 100 delivered, 26 cancelled, 19 requiring review. The migration improves read-only classification of old delivered/cancelled claim-only cards; it does not fabricate entry or handover records.
- Original first staging smoke failure is retained. Its selector used the first `h1`, which was the company name in the sidebar, rather than the entry heading. The verifier was corrected to require the exact entry-number heading. Full staging and live runs then passed; application code and error handling were not weakened.
- Development previously exercised actual save failure/retry, report read-back, link generation, reviewed message dry run, public signature and return. Production verification deliberately remained read-only: no live customer messages, test signatures, new reports or test operational data.

Ignored verification evidence: `visit-production-platform-final-20261107.json`, `list-production-smoke-visit-final-20261107.json`, `list-production-smoke-buttons-final-20261107.json`, `visit-production-preservation-final-20261107.json`, `identity-three-development.json`, `identity-three-applied.json`, `identity-three-verified.json`, and migration checkpoint/rehearsal/applied artifacts, all under `.vercel/`.

## Boundaries retained

Historical records lacking an entry or genuine signed handover remain visibly reviewable; no missing proof is fabricated merely to clear a warning. Four other open-link candidates remain separate from these three factual identity approvals; link confirmation alone would not establish contradictory physical custody. All test customer sending occurred only as previously documented Development dry runs; Production smoke will not save drafts, generate customer links or send WhatsApp/email.
