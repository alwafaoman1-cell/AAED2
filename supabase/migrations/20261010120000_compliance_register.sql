-- Tenant-scoped compliance register. Additive only: employee HR contracts remain
-- in the existing HR source and are never copied or rewritten here.
create table if not exists public.compliance_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  kind text not null check (kind in (
    'commercial_registration', 'lease', 'vat_registration', 'police_permit',
    'employee_permit', 'other'
  )),
  title text not null check (length(btrim(title)) between 1 and 200),
  reference_number text,
  issuing_authority text,
  employee_id text,
  employee_name text,
  issued_on date,
  expires_on date not null,
  status text not null default 'active' check (status in ('active', 'closed')),
  notes text,
  file_path text,
  created_by uuid,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint compliance_employee_link_check check (kind <> 'employee_permit' or nullif(btrim(employee_id), '') is not null),
  constraint compliance_date_order_check check (issued_on is null or issued_on <= expires_on),
  constraint compliance_file_tenant_path_check check (file_path is null or left(file_path, length(tenant_id::text) + 1) = tenant_id::text || '/')
);

create index if not exists compliance_records_deadline_idx
  on public.compliance_records(tenant_id, expires_on, id) where status = 'active';
create index if not exists compliance_records_list_idx
  on public.compliance_records(tenant_id, created_at desc);
create unique index if not exists compliance_records_active_reference_unique
  on public.compliance_records(tenant_id, kind, lower(btrim(reference_number)))
  where status = 'active' and nullif(btrim(reference_number), '') is not null;

create table if not exists public.compliance_record_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  record_id uuid not null references public.compliance_records(id),
  actor_id uuid,
  action text not null check (action in ('created', 'updated')),
  old_value jsonb,
  new_value jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists compliance_record_audit_record_idx
  on public.compliance_record_audit(tenant_id, record_id, created_at desc);

create or replace function public.compliance_record_prepare()
returns trigger language plpgsql set search_path = pg_catalog, public as $$
begin
  if tg_op = 'UPDATE' then
    if new.id is distinct from old.id or new.tenant_id is distinct from old.tenant_id
       or new.created_by is distinct from old.created_by or new.created_at is distinct from old.created_at then
      raise exception 'COMPLIANCE_IDENTITY_IMMUTABLE';
    end if;
  else
    new.created_by := auth.uid();
  end if;
  new.updated_by := auth.uid();
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists compliance_record_prepare_trigger on public.compliance_records;
create trigger compliance_record_prepare_trigger before insert or update on public.compliance_records
for each row execute function public.compliance_record_prepare();

create or replace function public.compliance_record_audit_change()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  insert into public.compliance_record_audit
    (tenant_id, record_id, actor_id, action, old_value, new_value)
  values
    (new.tenant_id, new.id, auth.uid(), case when tg_op = 'INSERT' then 'created' else 'updated' end,
     case when tg_op = 'UPDATE' then to_jsonb(old) else null end, to_jsonb(new));
  return new;
end $$;

drop trigger if exists compliance_record_audit_trigger on public.compliance_records;
create trigger compliance_record_audit_trigger after insert or update on public.compliance_records
for each row execute function public.compliance_record_audit_change();

alter table public.compliance_records enable row level security;
alter table public.compliance_record_audit enable row level security;

drop policy if exists compliance_records_read on public.compliance_records;
drop policy if exists compliance_records_insert on public.compliance_records;
drop policy if exists compliance_records_update on public.compliance_records;
drop policy if exists compliance_record_audit_read on public.compliance_record_audit;
create policy compliance_records_read on public.compliance_records for select to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));
create policy compliance_records_insert on public.compliance_records for insert to authenticated
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));
create policy compliance_records_update on public.compliance_records for update to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() in ('admin'::app_role, 'manager'::app_role))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));
create policy compliance_record_audit_read on public.compliance_record_audit for select to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));

revoke all on public.compliance_records, public.compliance_record_audit from public, anon, authenticated;
grant select, insert, update on public.compliance_records to authenticated;
grant select on public.compliance_record_audit to authenticated;
revoke all on function public.compliance_record_audit_change() from public, anon, authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('compliance-documents', 'compliance-documents', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

drop policy if exists compliance_documents_read on storage.objects;
drop policy if exists compliance_documents_insert on storage.objects;
create policy compliance_documents_read on storage.objects for select to authenticated
using (bucket_id = 'compliance-documents'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));
create policy compliance_documents_insert on storage.objects for insert to authenticated
with check (bucket_id = 'compliance-documents'
  and (storage.foldername(name))[1] = public.get_user_tenant_id()::text
  and public.get_user_role() in ('admin'::app_role, 'manager'::app_role));
