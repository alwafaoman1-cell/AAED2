# Vehicle technical declaration release — 2026-11-03

Scope: one new declaration per existing vehicle-entry visit. No historical row, invoice, claim, work order, Storage object, or financial value was changed. Production migrations were applied selectively through Supabase `apply_migration`; do not replay them through a blanket `db push` while the wider migration ledger remains unreconciled.

| Local / Development version | Production ledger version | Migration name |
| --- | --- | --- |
| `20261103134111` | `20261103162425` | `vehicle_technical_declaration` |
| `20261103134928` | `20261103162443` | `vehicle_technical_declaration_index_cleanup` |
| `20261103135023` | `20261103162446` | `vehicle_technical_declaration_tenant_fk_index` |

Production post-migration checks: new table present and empty; RLS enabled; three staff/tenant policies; `anon` has no table grant; authenticated INSERT limited to tenant, entry and form data, UPDATE limited to form data; unique vehicle-entry constraint; tenant and primary-key indexes. Supabase Security Advisor reported no finding for this new table. Performance Advisor reported the expected unused tenant index while the table had zero rows.

Frontend release boundary: route `/vehicle-entry/:id/technical-declaration` and its button on vehicle-entry detail, form/PDF module, targeted tests, and three translation entries only. Other dirty worktree changes are excluded.

Remaining verification: authenticated browser save/reopen/print on Production requires a real staff session and a real entry; do not create a fake operational record merely for the release smoke. A READY deployment or a green build does not establish that this authenticated workflow has been exercised.
