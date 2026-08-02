# Accounting Production Rollback Plan

This package has **not** been executed. Before a future rollout, take a fresh verified backup and record row-count/security snapshots.

## Checkpoints

1. `01_batch_preflight`: transactional; any SQL error rolls back the supplier prerequisite.
2. `02_batch_foundation`: transactional; stop if any accounting core table already exists.
3. `03_batch_posting`: transactional; creates no journals and activates no rule.
4. `04_batch_administration`: requires explicit enum approval. The enum addition is not safely reversible.
5. `05_batch_reports`: transactional; collision hashes must match the audited Production state.

## Failure response

- During a transaction: issue `ROLLBACK`, collect the exact error, and do not continue.
- After a committed batch but before application enablement: keep feature flags disabled, run security and row-count verification, and prepare a forward corrective migration.
- If an operational table count changes unexpectedly, if a source row is mutated, or if an enum rollback is required: stop all further batches and restore the verified pre-rollout backup under a maintenance window.
- Never drop accounting objects or repair migration history as an improvised rollback.
- Never remove `app_role.accountant` by replacing the enum in-place during an incident.

## Migration history

Run official migrations through a controlled migration runner so history and SQL execution remain atomic and auditable. The `\ir` files are review/execution manifests derived from official migrations; do not mark any version applied unless its complete object/data/security equivalence is verified.
