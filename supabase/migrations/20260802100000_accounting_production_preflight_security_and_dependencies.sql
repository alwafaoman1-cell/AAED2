-- Phase 5B: production preflight hardening.
-- Forward-only, non-destructive, no source-data backfill and no automatic posting.

do $$
declare
  v_type text;
  v_nullable text;
  v_default text;
  v_fk_count integer;
begin
  if to_regclass('public.expenses') is null or to_regclass('public.suppliers') is null then
    raise exception 'ACCOUNTING_PREFLIGHT_REQUIRED_SOURCE_TABLE_MISSING';
  end if;

  select c.udt_name, c.is_nullable, c.column_default
    into v_type, v_nullable, v_default
  from information_schema.columns c
  where c.table_schema = 'public'
    and c.table_name = 'expenses'
    and c.column_name = 'supplier_id';

  if v_type is null then
    alter table public.expenses add column supplier_id uuid null;
    v_type := 'uuid';
    v_nullable := 'YES';
    v_default := null;
  end if;

  if v_type <> 'uuid' or v_nullable <> 'YES' or v_default is not null then
    raise exception 'ACCOUNTING_PREFLIGHT_EXPENSE_SUPPLIER_ID_CONFLICT type=% nullable=% default=%',
      v_type, v_nullable, coalesce(v_default, '<null>');
  end if;

  select count(*) into v_fk_count
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname = 'expenses'
    and c.contype = 'f'
    and c.conkey = array[
      (select a.attnum from pg_attribute a
       where a.attrelid = r.oid and a.attname = 'supplier_id' and not a.attisdropped)
    ]::smallint[]
    and c.confrelid = 'public.suppliers'::regclass
    and c.confdeltype = 'n'; -- SET NULL

  if v_fk_count = 0 then
    if exists (
      select 1 from pg_constraint
      where conrelid = 'public.expenses'::regclass
        and conname = 'expenses_supplier_id_fkey'
    ) then
      raise exception 'ACCOUNTING_PREFLIGHT_EXPENSE_SUPPLIER_FK_NAME_CONFLICT';
    end if;

    alter table public.expenses
      add constraint expenses_supplier_id_fkey
      foreign key (supplier_id)
      references public.suppliers(id)
      on delete set null;
  elsif v_fk_count > 1 then
    raise exception 'ACCOUNTING_PREFLIGHT_DUPLICATE_EXPENSE_SUPPLIER_FK';
  end if;
end $$;

create index if not exists idx_expenses_supplier_id
  on public.expenses (supplier_id);

do $$
declare
  v_missing text[] := array[]::text[];
  v_name text;
begin
  foreach v_name in array array[
    'accounting_accounts',
    'accounting_fiscal_years',
    'accounting_periods',
    'accounting_cost_centers',
    'accounting_journal_entries',
    'accounting_journal_lines',
    'accounting_source_links',
    'accounting_account_mappings',
    'accounting_posting_rules',
    'accounting_audit_logs',
    'accounting_role_permissions',
    'accounting_report_saved_views'
  ] loop
    if to_regclass('public.' || v_name) is null then
      v_missing := array_append(v_missing, v_name);
    end if;
  end loop;

  if cardinality(v_missing) > 0 then
    raise exception 'ACCOUNTING_PREFLIGHT_PARTIAL_SCHEMA missing=%', array_to_string(v_missing, ',');
  end if;
end $$;

-- Revoke every accounting relation from unauthenticated roles. Existing
-- authenticated grants and RLS policies remain authoritative.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'accounting\_%' escape '\'
      and c.relkind in ('r','p','v','m','S','f')
  loop
    if r.relkind = 'S' then
      execute format('revoke all privileges on sequence %I.%I from public, anon', r.nspname, r.relname);
    else
      execute format('revoke all privileges on table %I.%I from public, anon', r.nspname, r.relname);
    end if;
  end loop;
end $$;

-- Trigger functions are included. They require no client EXECUTE privilege.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, p.proname, pg_get_function_identity_arguments(p.oid) as args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname like 'accounting\_%' escape '\'
  loop
    execute format(
      'revoke all privileges on function %I.%I(%s) from public, anon',
      r.nspname, r.proname, r.args
    );
  end loop;
end $$;

-- Prevent PostgreSQL defaults from silently reopening future objects. Access
-- must always be granted explicitly by the migration that creates the object.
alter default privileges in schema public revoke all on tables from public, anon;
alter default privileges in schema public revoke all on sequences from public, anon;
alter default privileges in schema public revoke execute on functions from public, anon;

-- Every tenant accounting table must remain protected by RLS.
do $$
declare
  r record;
begin
  for r in
    select n.nspname, c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relname like 'accounting\_%' escape '\'
      and c.relkind in ('r','p')
  loop
    execute format('alter table %I.%I enable row level security', r.nspname, r.relname);
  end loop;
end $$;

-- Fail closed if an accounting SECURITY DEFINER function has no fixed path,
-- or if any accounting object remains exposed to PUBLIC/anon.
do $$
declare
  v_count bigint;
begin
  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname like 'accounting\_%' escape '\'
    and p.prosecdef
    and not coalesce(p.proconfig, array[]::text[]) && array['search_path=pg_catalog, public','search_path=pg_catalog,public'];
  if v_count <> 0 then
    raise exception 'ACCOUNTING_PREFLIGHT_UNSAFE_SECURITY_DEFINER count=%', v_count;
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  cross join lateral aclexplode(coalesce(c.relacl, acldefault(case when c.relkind='S' then 'S'::"char" else 'r'::"char" end, c.relowner))) a
  left join pg_roles grantee on grantee.oid = a.grantee
  where n.nspname = 'public'
    and c.relname like 'accounting\_%' escape '\'
    and (a.grantee = 0 or grantee.rolname = 'anon');
  if v_count <> 0 then
    raise exception 'ACCOUNTING_PREFLIGHT_UNSAFE_RELATION_GRANTS count=%', v_count;
  end if;

  select count(*) into v_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  cross join lateral aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
  left join pg_roles grantee on grantee.oid = a.grantee
  where n.nspname = 'public'
    and p.proname like 'accounting\_%' escape '\'
    and a.privilege_type = 'EXECUTE'
    and (a.grantee = 0 or grantee.rolname = 'anon');
  if v_count <> 0 then
    raise exception 'ACCOUNTING_PREFLIGHT_UNSAFE_FUNCTION_GRANTS count=%', v_count;
  end if;

  select count(*) into v_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname like 'accounting\_%' escape '\'
    and c.relkind in ('r','p')
    and not c.relrowsecurity;
  if v_count <> 0 then
    raise exception 'ACCOUNTING_PREFLIGHT_RLS_DISABLED count=%', v_count;
  end if;
end $$;

comment on column public.expenses.supplier_id is
  'Optional supplier link. Historical rows remain nullable; no Phase 5B backfill is performed.';
