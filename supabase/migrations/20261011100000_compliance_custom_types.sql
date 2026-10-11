-- Reusable tenant-owned names for licences and register documents.
-- Existing compliance records keep their current kind and remain untouched.
create table if not exists public.compliance_record_types (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in ('other', 'employee_permit')),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 80),
  name_en text not null check (length(btrim(name_en)) between 1 and 80),
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now()
);

create unique index if not exists compliance_record_types_tenant_id_id_kind_key
  on public.compliance_record_types (tenant_id, id, kind);
create unique index if not exists compliance_record_types_name_ar_key
  on public.compliance_record_types (tenant_id, lower(btrim(name_ar)));
create unique index if not exists compliance_record_types_name_en_key
  on public.compliance_record_types (tenant_id, lower(btrim(name_en)));

alter table public.compliance_record_types enable row level security;
drop policy if exists compliance_record_types_read on public.compliance_record_types;
drop policy if exists compliance_record_types_insert on public.compliance_record_types;
create policy compliance_record_types_read on public.compliance_record_types for select to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));
create policy compliance_record_types_insert on public.compliance_record_types for insert to authenticated
with check (tenant_id = public.get_user_tenant_id() and created_by = auth.uid()
  and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));

revoke all on public.compliance_record_types from public, anon, authenticated;
grant select, insert on public.compliance_record_types to authenticated;

alter table public.compliance_records add column if not exists custom_type_id uuid;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_records'::regclass
      and conname = 'compliance_records_custom_type_kind_check'
  ) then
    alter table public.compliance_records
      add constraint compliance_records_custom_type_kind_check
      check (custom_type_id is null or kind in ('other', 'employee_permit'));
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.compliance_records'::regclass
      and conname = 'compliance_records_custom_type_tenant_fkey'
  ) then
    alter table public.compliance_records
      add constraint compliance_records_custom_type_tenant_fkey
      foreign key (tenant_id, custom_type_id, kind)
      references public.compliance_record_types (tenant_id, id, kind);
  end if;
end $$;

create index if not exists compliance_records_custom_type_idx
  on public.compliance_records (tenant_id, custom_type_id)
  where custom_type_id is not null;
