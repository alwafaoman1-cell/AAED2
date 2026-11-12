# Database outage: evidence and approved capacity remediation

Date: 2026-11-08. Scope: connection stability and compute capacity only.

## Diagnosis and certainty

- Production `ifnfwssdtjuzdtshnrht` was still Nano (up to 0.5 GB), despite the organization's Pro subscription. Actual host RAM was about 406.5 MiB.
- At 06:24:45Z, memory commitment was 1383.43 / 1227.25 MiB (112.7%). At 06:42:36Z it was 1404.09 / 1227.25 MiB (114.4%). This was a sustained allocation-risk condition, not simply a high ordinary RAM chart. The dashboard also classified commitment as Severe.
- Current available RAM did not disprove the risk. [Supabase's memory-commitment documentation](https://supabase.com/docs/guides/observability/reports#memory-commitment) distinguishes outstanding kernel commitments from physical memory already touched, and explains connection-fork and concurrent-query risks.
- The precise trigger of the earlier 05:21Z outage remains unproven. No explicit OOM-kill / allocation-failure entry was recovered. PostgreSQL statistics were reset at the external recovery restart, `05:54:25.727105Z`; the current OOM counter cannot reconstruct the earlier instance. The restart alone is not a root-cause fix.
- Disk space was not exhausted (about 0.41 GB of 2 GB, including system/WAL). Approximately 27-37 connections were observed against a configured 60; a connection-limit breach was not established. Slow query entries were reviewed, but no unrelated SQL/business-rule rewrite was justified by this evidence.
- Existing Nano defaults included `shared_buffers=28672 * 8kB` (224 MiB), `work_mem=2184 kB`, `max_connections=60`. Do not misread the 8kB unit as a concatenated byte quantity.

## Authorization and safeguards

- User approved Nano -> Micro (1 GB) **at the same price only**, Development first, then Production only after successful Development validation.
- Both actual review dialogs showed **$9.68/month -> $9.68/month, +$0.00/month**, at $0.01344/hour. This is the compute quote, not a promise about unrelated usage or tax charges.
- No disk, region, spend-cap, paid add-on, access grants, historical rows, invoice numbers, accounting rules, or application feature flags are part of this change.
- Completed physical backup verified before Production: `2197220600`, `2026-11-07T21:56:56.056Z`. Fresh encrypted/decryption-verified integrity checkpoint captured at `06:41:03Z`: 145 public/private business tables, 618 Storage-object metadata records, 2 Auth identities, schema/ACL/RLS/ledger, sequences, financial reconciliation. This checkpoint is an integrity comparison artifact, not a replacement for the physical backup or a claimed restore drill.
- No blanket `db push`, new migration, backfill, data repair, reclassification, or restore was run.

## Development validation

- Compute changed to Micro; new PostgreSQL boot `06:33:58.355284Z`, project ACTIVE_HEALTHY.
- Strict post-compute integrity comparison passed before browser activity: all 144 tables, 19 Storage metadata records, 7 Auth identities, sequences, schema, permissions and migration ledger matched.
- Browser suites `core`, `actions`, `finance`: PASS. Browsing writes=0; HTTP/Console/page errors=0; local test sessions revoked. Ten work-order actions opened without submitting business writes. Print preview: scripts=0, styles=3, active handlers=false. Desktop/tablet/mobile viewport checks passed; not physical-device testing.
- Controlled read workload: 48 requests, concurrency capped at 4, three existing tenant-scoped RPCs. All responses successful and result hashes identical. Median 294.29 ms, maximum 1044.44 ms, including client/network time. Not a maximum-capacity benchmark.
- Resources: commitment 113.7% on Nano -> 79.0% just after Micro boot; 93.1-94.1% in later validation samples. Actual available RAM after validation about 406 MiB; OOM counter=0 and swap-in/out counters=0 since the new boot. Do not describe the idle 79% as the load result.
- Browser tests temporarily enabled only two pre-existing, named synthetic Development accounts and restored their disabled access state in `finally`. Their legitimate `updated_at` triggers changed two timestamps. The strict after-browser check therefore flagged `public.profiles`; it was **not** silenced or repaired. A separate read-only verification confirmed all 143 business tables unchanged, identical Storage/Auth/sequences/finance/schema/ledger, restored access, and only these two test identities updated since the checkpoint. Full profile-row hash parity after browser activity is not asserted. Production test access will not use this toggle.

## Verification tooling correction

The earlier integrity helper assembled a single large UNION across all tables. It now reads one table at a time, materializes only row hashes, serializes each row once and sorts bounded hashes. It preserves the aggregate format; three independent helper tests and four-table legacy-algorithm parity on Development passed. Session-local memory/parallelism limits are used by the new checkpoint tool, without changing database defaults. This removes avoidable diagnostic memory pressure; it does not establish that diagnostics caused the original outage.

## Production: first-stage result and remaining risk

- Micro was applied at the same compute price. Actual new PostgreSQL boot: `06:47:30.227388Z`; SQL and API recovered. The UI now displays Micro. Only one resize was submitted; a browser selector timeout after submission was resolved by observing RESIZING, not by submitting again.
- Strict integrity comparisons at `06:48:39Z` and `06:53:41Z`: PASS. All 145 tables, 618 Storage metadata records, 2 stable Auth identities, sequences, schema, ACL/RLS and migration ledger unchanged. Financial mismatches=0. No business writes or historical repairs.
- Six actual-site browser suites passed: core, finance, detail, list, mobile, categories. No HTTP/Console/page errors, attempted business writes, or blocked reads. Six local test sessions revoked. Preview authentication was not mistaken for application success. Tests used the existing Production admin without changing their role/access or creating a user.
- Log window `06:48:00Z-06:52:50Z`: zero matched memory-allocation, pool-checkout, connection-timeout, statement-timeout or too-many-client entries across the returned sources. Ingestion/window limitations apply; this is not proof that future incidents are impossible.
- **The upgrade alone was insufficient for a complete stability claim.** Commitment samples: 84.8% just after boot, 99.5% during browser testing, 107.4% with final integrity work active, 105.8% after a further quiet minute. Available physical RAM remained about 398-413 MiB; OOM counter remained zero. Some swap activity occurred. Successful pages do not erase this resource risk.

## Second-stage memory allocation experiment — Development first

Only a supported `shared_buffers` override is being evaluated: 256 MiB -> 128 MiB, without reducing timeouts, changing permissions, raising spending or disabling durability. Existing overrides were `{}` on both projects. Actual usable Micro RAM is below 1 GiB and is shared by database/platform services; the Production database is about 116 MiB. This is a workload-specific hypothesis, not an arbitrary warning suppression.

[PostgreSQL 17's resource documentation](https://www.postgresql.org/docs/17/runtime-config-resource.html) describes 128 MB as the usual default, a smaller RAM percentage for systems below 1 GB, and continued use of OS cache. [Supabase documents the supported CLI configuration/restart mechanism](https://supabase.com/docs/guides/database/custom-postgres-config#managing-postgres-configuration-with-the-cli). No other configuration is included; the single override can be removed to restore vendor defaults.

- Development override applied, boot `06:56:35.533689Z`; actual `shared_buffers=16384 * 8kB`, pending_restart=false.
- Fresh strict pre/post integrity comparison for this experiment: PASS for all 144 tables, Storage/Auth, sequences, schema/ledger and finance.
- After integrity work, commitment sample was 75.1%; during browser testing 81.0%, and after full validation 87.0%. OOM/swap-in/swap-out counters remained zero and database was up.
- Full Development browser suites and all 48 concurrent bounded reads passed again. Read-workload median 294.29 -> 291.07 ms, maximum 1044.44 -> 754.94 ms. These are samples, not an SLA or a generalized acceleration claim. Some cold-page times varied upward and others downward (center 3417 -> 4629 ms, detail 5226 -> 4920 ms), so no claim that every page became faster is made.
- Post-browser business-data/access restoration checks passed with the same explicitly recorded two synthetic profile timestamp changes. No historical data was repaired to obtain parity.
- Production received the **single** validated `shared_buffers=128MB` override at `07:01:50Z`, merging rather than replacing existing configuration. CLI read-back confirmed exactly that one override. No invoice/accounting/table mutation was issued. A fresh completed physical backup (`2202376988`, `06:50:38.941Z`) and encrypted checkpoint (`06:59:14Z`) preceded it.
- The planned restart briefly returned PostgreSQL `57P03: database system is shutting down` to early verification attempts; these failed checks were not labeled PASS. No restart loop or second submission was used. Actual new boot: `07:03:25.181930Z`; `shared_buffers=16384 * 8kB`, pending_restart=false.
- Strict post-setting integrity at `07:05:19Z`: PASS across all 145 tables, 618 Storage metadata records, 2 stable Auth identities, schema/ACL/RLS/ledger, sequences and financial reconciliation (zero mismatches).
- First healthy post-setting resource sample at `07:04:52Z`: commitment 78.9%, available RAM about 502 MiB, OOM counter zero. The host was not replaced in this setting-only restart, so swap counters are cumulative and must not be described as reset at this PostgreSQL boot.
- Final post-setting Production suites completed at `07:08:36Z`: six suites, 22 page/view measurements, all PASS. HTTP/Console/page errors=0, browsing business writes/attempts=0, blocked reads=0; all six local test sessions revoked.
- Final post-browser integrity comparison at `07:09:31Z`: all 145 tables, 618 Storage metadata records, 2 stable Auth identities, schema/ACL/RLS/ledger, sequences and finance remained identical to the fresh pre-setting checkpoint. Financial mismatches stayed zero.
- Post-setting log window `07:04:30Z-07:08:40Z`: parsed PostgreSQL ERROR/FATAL/PANIC entries=0 and selected SQLSTATE resource/connection/timeout codes=0. Earlier regular-expression checks inspected log attributes, **not exhaustive message bodies**; they must not be presented as a complete search of every pooler message. Log ingestion/window limitations remain.
- Production source/deployment remained the previous selective release: `dpl_GCHCwSD7S7cb5twyJCdf8W1qmkQi`, digest `99b998d5f96537a67396c936290ad05560112d3b6ecd419f34f4c9f2dbfa836a`, base `bcc4b64469651614bef484df76c0a74845ac64b9`. No app deployment, new migration, commit or push was made in this infrastructure task. Older unrelated working-tree changes were preserved.
- Worker daemon remained Ready 1/1 with its pinned image unchanged. SQL separately confirmed one dedicated worker connection, reconnected at `07:03:25.904994Z` after the new PostgreSQL boot. No real OCR/upload job was inserted to test it.

## Final capacity decision — not an unconditional completion claim

| Observed phase | Memory commitment / limit | Interpretation |
| --- | --- | --- |
| Nano before remediation | 112.7-114.4% | Sustained capacity-risk condition |
| Micro, vendor buffer defaults, after validation | 105.8% | Upgrade alone insufficient |
| Micro, 128 MiB buffers, during browser testing | 91.6% | Improved; functional checks successful |
| Same, final integrity work active | 99.5% | Heavy diagnostic workload nearly consumes commitment headroom |
| Same, about a minute after integrity connection closed | 97.4% | Below the threshold, but still limited steady headroom |

These are timestamped samples, not a continuous peak, long-term trend, or measured maximum concurrent-user capacity. The last sample had about 285 MiB available physical RAM, database up, OOM counter=0, and no additional swap-out pages since the post-restart sample. Swap-in counters increased slightly; no zero-swap assertion is made for Production.

**Decision: functional and data-integrity verification passed; capacity headroom remains limited. Complete prevention of recurrent connection outages is not certified.** The sustained excess condition improved, but it would be misleading to declare an unlimited stability guarantee or the historical crash's exact cause proven. Further blind memory reductions are not a substitute for a defensible capacity budget.

The user's zero-price-increase boundary was respected. No paid upgrade was applied. A larger Production tier needs a separate cost decision: the observed Small (2 GB) rate was $0.0206/hour versus $0.01344/hour, an indicative difference of about $5.16 per 30-day month before taxes/other usage; this is **not** a freshly confirmed final billing quote or authorization. Development can stay on the tested Micro configuration. Obtain an actual review quote and explicit cost approval before any paid change, then repeat targeted validation. Provider-side pre-incident records may still be needed to identify the precise original crash trigger.

## Files and verification scope

- New tracked candidate: this report only. Infrastructure changes persist in the two explicitly identified Supabase projects, not in app code.
- Ignored operational helpers: `outage-capacity-integrity.py`, `outage-resource-snapshot.py`, `outage-integrity-regression.py`, `outage-development-runtime-integrity.py`, `outage-dev-validation.py`, `outage-production-runtime.py`, `outage-apply-production-buffer128.py`, plus the bounded `footprint` correction in `production-update-preflight.py`. These contain no embedded credentials; encrypted checkpoints and all earlier proof files were retained.
- Three helper regression tests passed; Development parity against the legacy fingerprint algorithm passed on four tables; the bounded replacement inspected 144 tables sequentially.
- Full project typecheck/lint/build/test were not rerun for these configuration-only changes. The preceding frozen application release's results remain separate evidence (1741 passed, 6 pre-existing skipped, typecheck/lint/build passed), not a claim of a fresh full suite here.
- No real Production business save/payment/delete/upload/WhatsApp send was submitted. Browser checks cover reads, rendered results, permitted action opening, print preview and responsive viewports; not physical devices or every write workflow.

## Evidence locations

Operational proof files are ignored local artifacts in `.vercel/`: `outage-capacity-*-before/after.json`, encrypted `outage-capacity-*-before.dpapi`, `outage-resource-*.json`, `outage-capacity-development-runtime.json`, `outage-development-runtime-integrity.json`, `outage-integrity-regression.json`. No credentials are included in this report. Same-price UI evidence: `output/outage-production-micro-quote-20261108.jpg`.
