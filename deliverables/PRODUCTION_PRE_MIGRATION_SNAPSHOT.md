# Production Pre-Migration Snapshot

- Timestamp: 22 June 2026
- Supabase project ref: `ifnfwssdtjuzdtshnrht`
- Project name: `AAED2`
- Plan: Free
- Scheduled backups: unavailable on the current plan

## Logical inventory

The following query was executed with the `postgres` role before applying any migration:

```sql
select table_schema, table_name
from information_schema.tables
where table_schema = 'public' and table_type = 'BASE TABLE'
order by table_name;
```

Result: `0 rows`.

The production `public` schema contained no application tables and no application data before deployment. Therefore, there was no existing production dataset to export or restore. This inventory is the pre-migration logical snapshot.

