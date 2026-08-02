# Accounting Production Migration Manifest

Phase: `5B — Accounting Production Preflight Hardening`
Development: `rrhyglrnlveygyiandhs`
Production (read-only audit only): `ifnfwssdtjuzdtshnrht`
Audit date: `2026-08-02`

No migration-history repair is authorized by this manifest. A migration is eligible for history repair only after every object, definition, trigger, policy, grant, and required data effect has been proven equivalent. Name-only matches are insufficient.

## Classification summary

| Classification | Count |
|---|---:|
| Apply | 21 |
| Already Present — Eligible for History Repair | 0 |
| Partially Present — Replacement Required | 9 |
| Superseded — Do Not Apply Directly | 0 |
| Blocked | 1 |
| Not Required for Accounting Deployment | 11 |
| **Total pending migrations audited** | **42** |

## Detailed manifest

| Migration | Objects Created/Changed | Present in Production | Definition Match | Data Effect | Dependency | Recommended Action |
|---|---|---|---|---|---|---|
| `20260712213000_estimate_claim_cleanup_ai_extraction` | Estimate/claim compatibility fields, AI extraction audit | Not established for this accounting rollout | Not evaluated | Additive operational metadata | Estimates/claims | Not Required for Accounting Deployment |
| `20260713193000_ollama_ai_usage_logs` | `ai_usage_logs`, index/RLS | Not established | Not evaluated | No operational-row mutation | AI integration | Not Required for Accounting Deployment |
| `20260715143000_unified_claim_work_order_operational_file` | Unified claim/work-order operational file | Production has later operational schema | Not evaluated | Includes operational backfill | Claims/work orders | Not Required for Accounting Deployment |
| `20260718090000_renumber_work_orders_four_digits` | Work-order number audit and renumber | Production operational numbering exists | Not evaluated | Mutates display numbers | Work orders | Not Required for Accounting Deployment |
| `20260718120000_add_supplier_id_to_expenses` | Nullable `expenses.supplier_id`, FK `ON DELETE SET NULL`, index | Column absent | Missing | No backfill | `expenses`, `suppliers` | Apply |
| `20260719163000_work_order_vehicle_customer_relationship` | Four nullable job-order relationship fields and indexes | Missing per Phase 5A | Missing | No backfill | Work orders | Not Required for Accounting Deployment |
| `20260720130000_unify_claim_media_documents` | `vehicle_media` fields, claim media compatibility | Operational media exists | Not evaluated | Media backfill possible | Storage/claims | Not Required for Accounting Deployment |
| `20260720143000_vehicle_avatar_media` | Avatar fields/index/policy | Operational media exists | Not evaluated | No destructive effect | `vehicle_media` | Not Required for Accounting Deployment |
| `20260721130000_public_work_order_links_legacy_token_fallback` | Public tracking/signature RPC replacements | Public RPCs exist | Not evaluated | Function-only | Portal tokens | Not Required for Accounting Deployment |
| `20260723074500_auth_tenant_role_fallbacks` | Tenant/role resolver functions | Resolver functions exist | Not evaluated | Function-only | Auth/profile model | Not Required for Accounting Deployment |
| `20260723193000_whatsapp_cloud_api_readiness` | Messaging columns/tables/RLS | WhatsApp foundation exists | Not evaluated | Additive messaging schema | Messaging | Not Required for Accounting Deployment |
| `20260725173000_vehicle_entry_receipt` | Vehicle entry tables, sequence, links | Operational feature exists | Not evaluated | Additive operational schema | Vehicles/claims | Not Required for Accounting Deployment |
| `20260729110000_reports_center_read_models` | Saved views, report read model/RPC | Objects manually present without history | Mixed/insufficient proof | Read-model schema | Operational tables | Partially Present — Replacement Required |
| `20260729120000_reports_center_detail_read_models` | Detail views/RPCs | Objects manually present | Three fact views differ; other sampled objects match | View/function replacement | Previous report model | Partially Present — Replacement Required |
| `20260729130000_reports_center_security_hardening` | Explicit `anon` revokes | Grants differ from intended history | Not equivalent | Security only | Report objects | Partially Present — Replacement Required |
| `20260729140000_reports_center_sorting_fix` | Report query ordering | Function exists manually | Full overload proof incomplete | Function replacement | Report RPC | Partially Present — Replacement Required |
| `20260729150000_reports_center_summary_parity_fix` | Completed-without-invoice parity | Function exists manually | Full overload proof incomplete | Function replacement | Report RPC | Partially Present — Replacement Required |
| `20260730103000_reports_center_permissions_and_work_orders_performance` | Permission bridge and optimized work-order report | Objects manually present | Full definition proof incomplete | Functions/indexes | Reports center | Partially Present — Replacement Required |
| `20260730113000_reports_center_access_assertion` | Access assertion and saved-view policy | Objects manually present | Full policy proof incomplete | Security/function replacement | Reports center | Partially Present — Replacement Required |
| `20260730120000_reports_center_tenant_null_guard` | Fail-closed tenant guard | Function manually present | Full overload proof incomplete | Function replacement | Access assertion | Partially Present — Replacement Required |
| `20260730123000_reports_center_work_orders_fail_closed_wrapper` | Fail-closed wrapper | Function manually present | Full overload proof incomplete | Function replacement | Work-order report RPC | Partially Present — Replacement Required |
| `20260801100000_accounting_cloud_foundation` | Core accounting tables/types | Core tables absent | Missing | Empty accounting schema only | Operational source tables | Apply |
| `20260801101000_accounting_cloud_security` | RLS and permission bridge | Core absent | Missing | Security only | Foundation | Apply |
| `20260801102000_accounting_source_eligibility` | Central eligibility functions | Core absent | Missing | Function-only | Operational sources | Apply |
| `20260801103000_accounting_validation_and_posting` | Validation, posting, reversal, numbering, audit | Core absent | Missing | No automatic posting | Foundation/security | Apply |
| `20260801104000_accounting_foundation_indexes` | Tenant/accounting indexes | Core absent | Missing | Index-only | Foundation | Apply |
| `20260801105000_accounting_runtime_hardening` | Validation/RPC hardening | Core absent | Missing | Function/trigger replacement | Prior accounting migrations | Apply |
| `20260801106000_accounting_audit_runtime_fix` | Audit trigger function fix | Core absent | Missing | Function replacement | Audit foundation | Apply |
| `20260801107000_accounting_transition_security_fix` | Trusted transition boundary | Core absent | Missing | Function/trigger replacement | Posting validation | Apply |
| `20260801108000_accounting_legacy_surface_security` | Legacy accounting RLS/revokes/security-invoker views | Legacy surfaces present and insecure | Not equivalent | Security only | Existing legacy accounting objects | Apply |
| `20260801109000_app_versions_schema_alignment` | `app_versions` compatibility schema | Production state must be asserted at execution | Pending precondition | No seed data | App update contract | Apply |
| `20260801110000_accounting_posting_rules_engine` | Manual preview/post engine, request idempotency | Core absent | Missing | No rules activated | Foundation | Apply |
| `20260801111000_accounting_supplier_posting_extension` | Supplier invoice/payment posting support | Core absent | Missing | Function-only | Supplier source fields | Apply |
| `20260801112000_accounting_administration_setup` | Admin setup/opening batch foundation | Core absent | Missing | No tenant fixtures | Foundation | Apply |
| `20260801113000_accounting_accountant_role_alignment` | Adds `app_role.accountant` | Enum value absent | Missing | Irreversible enum expansion | Role model approval | Blocked |
| `20260801114000_accounting_opening_batch_scope` | Opening balance batch uniqueness | Core absent | Missing | Index/constraint only | Administration setup | Apply |
| `20260801115000_accounting_rule_runtime_fixture_guard` | Runtime-only rule activation guard | Core absent | Missing | Function-only | Posting rules | Apply |
| `20260801120000_accounting_reports_standalone` | Accounting reports/RPCs/saved views | Core absent; two legacy summary RPCs exist | New standalone objects missing | Read-only reporting | Accounting core | Apply |
| `20260801121000_accounting_reports_rpc_uuid_fix` | Report RPC UUID correction | Core absent | Missing | Function replacement | Phase 4 reports | Apply |
| `20260801122000_accounting_vehicle_profit_loss_eligible` | Vehicle P&L RPC | Core absent | Missing | Function-only | Eligibility/reports | Apply |
| `20260801123000_accounting_vehicle_profit_loss_uuid_links` | Vehicle P&L UUID links | Core absent | Missing | Function replacement | P&L RPC | Apply |
| `20260801124000_accounting_vehicle_profit_loss_uuid_links_exact` | Exact-format UUID correction | Core absent | Missing | Function replacement | Previous P&L fixes | Apply |

## Production object collision evidence

Identical hashes are safe to keep. Differing hashes require the official migration replacement path; they are not eligible for history repair.

| Object | Production hash | Development hash | Match | Safe action |
|---|---|---|---|---|
| `accounting_dashboard_summary_rpc` | `2fc83e0cc4d8f78e208b521b9d38f8bc` | same | Yes | Keep; later security migration controls grants |
| `accounting_reports_summary_rpc` | `a702e615065580e95fc7725e4f197af5` | same | Yes | Keep; later security migration controls grants |
| `accounting_claims_summary_view` | `6ad2d1ae3d19adf667204c87c53ad69f` | same | Yes | Keep; apply security-invoker hardening |
| `accounting_work_order_profit_view` | `1bb7fb5a96b10eb97ca65c20f9de54bf` | same | Yes | Keep; apply security-invoker hardening |
| `reports_center_rows_v1` | `bf10f2b963edc241194c841843c1f3be` | same | Yes | Keep |
| `reports_insurance_statement_facts_v1` | `109f641be1a88c52ea95f92d5c4853ea` | same | Yes | Keep |
| `reports_work_order_facts_v1` | `5ee02164b89aa668e2486429120be205` | same | Yes | Keep |
| `reports_expense_facts_v1` | `706b12d59c3cd82d9f0b4cd36d9b36f8` | `540cff0d164365a0c31527740b9bbd73` | No | Controlled `CREATE OR REPLACE` from official report migration |
| `reports_invoice_facts_v1` | `beee4802f5288979fa703e03020215cc` | `db26e22dfc8f2c9b235ff9084ff58603` | No | Controlled `CREATE OR REPLACE` from official report migration |
| `reports_payment_facts_v1` | `c3d2676f824431d6c9e1def639b7205d` | `37abb7642b07b08bc7fe89650b3b23df` | No | Controlled `CREATE OR REPLACE` from official report migration |

## `insurance_claims` metadata reconciliation

The earlier hash mismatch was caused by different normalization queries. A canonical, identical metadata query was executed against both projects and compared columns, defaults, nullability, constraints, indexes, triggers, and policies. No functional differences were found.

| Area | Development | Production | Functional impact | Blocks accounting | Resolution |
|---|---|---|---|---|---|
| Columns/defaults/nullability/generated expressions | Canonical SHA-256 `525e468de63f6834f6fab2f80c2bb8e610a43af6b2e41dfcf208672869eebef0` | Same | None | No | No migration |
| Constraints/FKs | Exact canonical match | Exact canonical match | None | No | No migration |
| Indexes | Exact canonical match | Exact canonical match | None | No | No migration |
| Triggers | Exact canonical match | Exact canonical match | None | No | No migration |
| Policies | Exact canonical match | Exact canonical match | None | No | No migration |

## Claim-payment duplicate metadata

| Metric | Result |
|---|---:|
| Duplicate payment-number groups | 4 |
| Rows in duplicate groups | 8 |
| Groups with distinct IDs | 4 |
| Groups with different amounts | 4 |
| Groups with different dates | 4 |
| Numbers crossing tenants | 0 |

These rows are not modified. They do not block the empty accounting foundation because no uniqueness constraint is added to `claim_payments.payment_number`. Historical reconciliation/backfill remains blocked pending manual accountant review.

## Stop conditions

Stop before any future Production execution if the project ref is not exact, the three collision hashes changed, any accounting core table is partially present, `expenses.supplier_id` has a conflicting definition, the accountant enum decision is not approved, or row-count snapshots cannot be taken.
