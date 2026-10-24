# Confirmed cloud-save production rollout (2026-10-24)

The four SQL files below were applied to Supabase Development (`rrhyglrnlveygyiandhs`) under their repository versions. Their **same SQL bodies** were applied selectively to Production (`ifnfwssdtjuzdtshnrht`) using the Supabase migration tool, which assigned new versions:

| Repository / Development version | Production history version | Migration |
| --- | --- | --- |
| `20261022121924` | `20261024044415` | `secure_hr_tenant_setting` |
| `20261022125441` | `20261024044434` | `private_hr_documents` |
| `20261022125444` | `20261024044449` | `restrict_staging_tenant_attachment` |
| `20261022125914` | `20261024044503` | `tenant_guard_customer_notification_rpcs` |

Do **not** run a comprehensive `supabase db push` against either project based on this repository. The two migration histories do not match; this is in addition to older history drift. Audit and reconcile the histories as a separate, approved operation before using automated migration push. Do not replay the notification-function migration: it renames existing functions.

Before the Production SQL, an application ZIP backup was downloaded and verified locally, and a scheduled physical database backup was present in Supabase. The ZIP covers only the application's supported tables and attachments; it is **not** a full PostgreSQL/Storage backup. No historical backfill, automatic posting, or data repair was performed.

Production checks after applying SQL: the existing `alwafa_hr_v1` row's version and checksum were unchanged, three HR-specific `tenant_settings` policies exist, `hr-documents` is private, and `anon` cannot execute `attach_user_to_staging_tenant(text)`. Existing Supabase Security Advisor findings outside this narrow release remain open and must not be reported as resolved.
