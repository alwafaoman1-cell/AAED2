# Selective release — 2026-10-21

This release excludes the separate Work Order Detail responsive-design worktree.
It includes the pending document-extraction, vehicle-entry PDF, insurance
damage-report, and claim/work-order duplicate-guard changes only. No historical
rows are renumbered, reclassified, deleted, or backfilled.

## Production database rollout

The following SQL files were applied selectively through Supabase migrations to
project `ifnfwssdtjuzdtshnrht` after read-only preflight. The first four guard
steps had already been applied under different Production versions; they were
not replayed. Development also has its own migration versions for these names.

| Local SQL file prefix | Migration name | Production version | State |
| --- | --- | --- | --- |
| 20261021100000 | guard_primary_claim_work_order_creation | 20261021051756 | Pre-existing |
| 20261021101000 | correct_primary_claim_work_order_uuid_selection | 20261021051800 | Pre-existing |
| 20261021102000 | harden_primary_claim_work_order_links | 20261021051804 | Pre-existing |
| 20261021104000 | guard_claim_order_on_all_updates | 20261021052508 | Pre-existing |
| 20261021103000 | unique_primary_claim_work_order | 20261021153051 | Applied in this release |
| 20261021060721 | atomic_insurance_damage_report_numbering | 20261021153106 | Applied in this release |
| 20261021075356 | document_vehicle_entry_gate_pass_detection | 20261021153126 | Applied in this release |

Before the unique index, the read-only Production check found zero duplicate
active primary claim/order groups. Afterwards the index exists and the count
remains zero. The new damage-report sequence has RLS enabled; anonymous users
cannot execute its save RPC. Existing report rows were not changed. All five
document-worker policies now accept the immutable `1.0.6-worker` queue version.

The `document-worker-download` Edge Function was updated from version 6 to 7,
adding `1.0.6-worker` to its allowed versions. Its existing worker-secret and
active-lease checks remain in place; `verify_jwt=false` is unchanged because
this internal endpoint authenticates through those checks.

**Do not run a blanket `supabase db push` or repair migration history by file
name.** This repository has older history drift, and the local versions above
are not the versions recorded by both remote projects. Future migration work
must compare definitions and recorded versions individually.

## Verification boundary

The code was validated with TypeScript, ESLint, the full Vitest suite, and a
production Vite build before release. These checks do not replace an
authenticated browser smoke or a real OCR document test. The production worker
must be checked after deployment for a healthy daemon and processing of the
new queue version. The local Python worker unit test could not run in the
bundled Python runtime because `psycopg` is not installed there.
