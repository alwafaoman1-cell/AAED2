-- Development schema alignment for the existing cloud update contract.
-- Non-destructive: creates the missing table/index/policies only; no seed data.

create table if not exists public.app_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  version text not null,
  title text,
  changelog text,
  released_at timestamptz not null default now(),
  mandatory boolean not null default false,
  grace_minutes integer not null default 30 check (grace_minutes >= 0),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_versions_tenant_version_key unique (tenant_id, version),
  constraint app_versions_version_not_blank check (btrim(version) <> '')
);

create index if not exists app_versions_tenant_release_idx
  on public.app_versions (tenant_id, released_at desc);

alter table public.app_versions enable row level security;

revoke all on table public.app_versions from public, anon;
grant select on table public.app_versions to authenticated;
grant all on table public.app_versions to service_role;

drop policy if exists app_versions_tenant_read on public.app_versions;
create policy app_versions_tenant_read
  on public.app_versions
  for select
  to authenticated
  using (tenant_id = public.get_user_tenant_id());

drop policy if exists app_versions_admin_manage on public.app_versions;
create policy app_versions_admin_manage
  on public.app_versions
  for all
  to authenticated
  using (
    tenant_id = public.get_user_tenant_id()
    and public.get_user_role() = 'admin'::public.app_role
  )
  with check (
    tenant_id = public.get_user_tenant_id()
    and public.get_user_role() = 'admin'::public.app_role
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1
       from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'app_versions'
     ) then
    alter publication supabase_realtime add table public.app_versions;
  end if;
end;
$$;

comment on table public.app_versions is
  'Tenant-scoped application release metadata consumed by the existing cloud update watcher.';
