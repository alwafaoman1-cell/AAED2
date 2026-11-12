# Historical vehicle-visit repair — factual decision gate

Status: **THREE OWNER-CONFIRMED LOCATIONS AND THREE EXPLICITLY APPROVED VEHICLE IDENTITIES REPAIRED; SELECTIVE FRONTEND RELEASE PUBLISHED AND VERIFIED IN PRODUCTION**.

Subsequent update: the owner explicitly confirmed DD 67731, W 86765 and MS 9707. The bounded identity correction and selective center migration have now passed Development rehearsal and Production read-back without financial, ownership, signature or Storage changes. See [current execution evidence](owner-confirmed-identity-and-visit-release-2026-11-07.md). The inventory and pending statements below describe the original preflight, not the later completed corrections.

User authorized correcting old conflicts and publishing the completed updates without data loss. The initial inventory below was read-only. In the subsequent confirmation “داخل الورشة ال 3”, the owner attested that Camry RW 2525, Micra TH 369 and Venue TB 4556 are inside the workshop. Only these three custody discrepancies have now been corrected and independently read back in Production. See [the correction evidence](custody-three-production-correction-2026-11-07.md). No schema/migration, invoice, ownership, archive, numbering or other historical identity was changed. No frontend deployment, Git commit or push was performed.

## Current verified inventory

- Production: `ifnfwssdtjuzdtshnrht`.
- 78 non-deleted entry records; 168 distinct center cards including claim-only projections.
- Current center tabs: 16 in workshop, 0 with customer, 36 delivered, 11 cancelled, 105 review.
- Across all tabs, 58 actual entry cards have review reasons: 34 work-order link, 12 custody, 9 delivery without signed handover, 3 insurance claim required. These are not 58 confirmed duplicate records.
- Another 90 claim-only projections have `claim_without_entry`; their presence in Review is not authorization to fabricate 90 historical entry receipts. The tested pending center migration improves their delivered/cancelled presentation without creating records.
- Existing tested center migration `20261107115803_vehicle_visit_workspace_intake_and_projection` is not present in Production. It remains unapplied while the requested repair-before-release gate is unresolved. No blanket migration push is allowed.
- All tab pages were read through the existing bounded RPC with an ordinary active administrator's tenant/role context. The internal rows helper correctly denies direct authenticated execution; its grants were not widened.

## Four bounded existing-link candidates

Unique same-tenant, same-claim, same-vehicle open work orders were found for entries `ENT-2026-0074`, `ENT-2026-0057`, `ENT-2026-0046`, `ENT-2026-0045`. They are candidates for the existing manager-confirmed link RPC, not committed repairs. Link confirmation alone does not settle contradictory physical custody.

Other candidates are excluded from this list because they are closed/delivered, still drafts, point to unavailable/deleted records, or have differing vehicle identity. Do not loosen the existing closed-link or identity guards simply to force a repair.

## Actual identity conflicts requiring a factual choice

| Entry | Entry / claim identity | Existing order identity | Why not infer |
| --- | --- | --- | --- |
| ENT-2026-0009 | Tesla Model 3, DD 67731 | WO-I-26-0064, Tesla Model 3, DD 67734 | Different plate digits; no saved VIN proof |
| ENT-2026-0041 | Lexus NX 86765, letters absent; claim vehicle is missing | WO-I-26-0097, Lexus NX W 86765, different vehicle UUID | Incomplete identity and no saved VIN proof |
| ENT-2026-0042 | Toyota Fortuner MS 9707 | WO-I-26-0099, Toyota Fortuner 9707, letters absent, different vehicle UUID | Plate letters are material to uniqueness; no saved VIN proof |

Do not merge vehicles or move an invoice/expense to an inferred vehicle. Authoritative plate/letters or supporting vehicle document must settle these choices first.

## Custody conflicts — resolved after the owner's confirmation

Entries `ENT-2026-0053` and `ENT-2026-0054` say inside the workshop while their linked claims say with customer. Entry `ENT-2026-0058` says external workshop yard while its claim says with customer. These entries have no finalized handover record. An updated timestamp alone cannot attest their current physical location.

The owner subsequently confirmed all three are inside. Their linked claims now say `in_workshop`; the external-yard label was normalized to workshop custody with the old wording retained in an audit record and its bay unchanged. The center's ordinary authenticated read now places all three in `in_workshop`, stage `arrived`, with no review reason. This was a current-custody correction, not a new arrival or a historical signature.

Historical delivery statuses must not be turned into invented electronic/paper signatures or a new handover document dated in the past. If historical administrative delivery is to be accepted as a separate evidence class, obtain an explicit policy decision and preserve the distinction from signed handover.

## Evidence and next safe execution

- The read-only inventory is retained encrypted with DPAPI, decryption verified: `.vercel/legacy-visit-inventory-20261107T152903Z.dpapi` (865,190 encrypted bytes). This is a targeted inventory snapshot, **not** a full database/Storage backup or restore rehearsal.
- Machine summary: `.vercel/legacy-visit-inventory-summary.json`; no credentials are printed or committed. Private business snapshots stay outside the deployment bundle.
- Source/report tool: `.vercel/legacy-visit-review.py` performs read-only inventory only. It has no repair/deployment mode.
- After factual decisions: verify a fresh completed database backup, create a fresh encrypted repair before-image and conditional rollback; rehearse the exact bounded corrections on Development with synthetic equivalents; call existing guarded RPCs for confirmed candidates; verify financial/identity/Storage invariants; apply only the tested selective center migration; stage the previously tested center/release frontend with the existing Worker image; run read-only smoke before live promotion.
- Unrelated dirty financial, provider and other local files must not be swept into “all”. The intended release is the completed, verified vehicle-center and supervisor temporary-release bundle, not every unverified working-tree change.
