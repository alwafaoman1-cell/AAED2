# Production Decision: `app_role.accountant`

Status: **approval required before Production**.

## Current design

The implemented accounting permission model and runtime tests use the existing `app_role` enum and include the `accountant` role. Migration `20260801113000_accounting_accountant_role_alignment.sql` adds the enum value only; it does not assign the role to a user and does not grant tenant access by itself.

## Rollback limitation

PostgreSQL enum values cannot be removed safely with a simple rollback. Removing one later requires replacing the enum type and migrating every dependent column/function, which is materially more invasive than the forward change.

## Options

1. **Adopt `accountant` permanently (recommended).** This keeps one role model across UI, RLS, permission tables, and reports. Apply only after a fresh backup and explicit Production approval.
2. Redesign before Production to map accounting permissions onto an existing role. This avoids the enum change but requires code, RLS, tests, and permission-contract changes and is not a safe preflight-only adjustment.

## Recommendation

Approve permanent adoption of `app_role.accountant`. Do not apply migration `20260801113000` until that approval is recorded. No current Production user is changed by the migration.
