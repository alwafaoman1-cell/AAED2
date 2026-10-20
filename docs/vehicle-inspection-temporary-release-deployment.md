# Vehicle inspection & temporary release deployment — 2026-10-20

This feature is separate from final vehicle delivery, claim approval, invoices,
and accounting. The two SQL files were applied selectively through Supabase's
managed migration API; **do not run a blanket `db push`**. The repository already
has broader migration-history drift, and the managed API assigned different
versions in each environment. Do not reapply either file merely because its
filename does not match a remote version.

| SQL file | Development (`rrhyglrnlveygyiandhs`) | Production (`ifnfwssdtjuzdtshnrht`) |
| --- | --- | --- |
| `20261020100000_vehicle_inspection_temporary_release.sql` | `20261020080041` | `20261020081902` |
| `20261020101000_vehicle_inspection_release_trigger_grants.sql` | `20261020081540` | `20261020081912` |

The latest Production physical database backup seen before applying the SQL was
2026-10-19 21:56:05 UTC. Supabase database backups do not include Storage
objects. The SQL creates no Storage objects and performs no historical backfill.
Production had 52 active vehicle-entry records before and after the migration;
the new release and link tables contained zero records immediately afterward.

Development validation used synthetic vehicle entries in rolled-back
transactions: staff save and link, anonymous token lookup and signature,
claim/work-order vehicle-presence changes, return to workshop, and direct
anonymous table-access denial. A separate synthetic Edge Function link returned
HTTP 200 and was then deleted. The pre-existing vehicle-entry signature path
was checked with an invalid-link request after the Edge Function update.

The public token-based signature RPCs are intentionally executable by `anon`;
all other release tables and trigger helpers are not. Never expose the link
table, raw tokens, or service-role credentials to the frontend.
