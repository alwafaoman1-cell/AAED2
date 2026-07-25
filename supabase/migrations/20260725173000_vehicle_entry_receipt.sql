-- Vehicle Entry & Receipt foundation.
-- Non-destructive: creates new tables and adds nullable links only.

create table if not exists public.vehicle_entry_sequences (
  tenant_id uuid not null,
  year_value integer not null,
  current_value integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, year_value)
);

create or replace function public.next_vehicle_entry_number(p_year integer default extract(year from now())::integer)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid;
  v_next integer;
begin
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null then
    raise exception 'tenant_not_found';
  end if;

  insert into public.vehicle_entry_sequences (tenant_id, year_value, current_value)
  values (v_tenant, p_year, 1)
  on conflict (tenant_id, year_value)
  do update set current_value = public.vehicle_entry_sequences.current_value + 1,
                updated_at = now()
  returning current_value into v_next;

  return 'ENT-' || p_year::text || '-' || lpad(v_next::text, 4, '0');
end;
$$;

grant execute on function public.next_vehicle_entry_number(integer) to authenticated;

create table if not exists public.vehicle_entries (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  entry_number text not null,
  customer_id uuid null references public.customers(id) on delete set null,
  vehicle_id uuid null references public.vehicles(id) on delete set null,
  insurance_company_id uuid null references public.insurance_companies(id) on delete set null,
  insurance_claim_id uuid null references public.insurance_claims(id) on delete set null,
  work_order_id uuid null references public.job_orders(id) on delete set null,
  converted_claim_id uuid null references public.insurance_claims(id) on delete set null,
  converted_work_order_id uuid null references public.job_orders(id) on delete set null,
  received_by_user_id uuid null,
  status text not null default 'Draft'
    check (status in ('Draft','Received','Issued','Converted to Claim','Converted to Work Order','Cancelled')),
  arrival_date date not null default current_date,
  arrival_time time not null default localtime(0),
  vehicle_location text null,
  vehicle_location_bay text null,
  arrival_method text null,
  received_by_name text null,
  delivered_by jsonb not null default '{}'::jsonb,
  customer_snapshot jsonb not null default '{}'::jsonb,
  vehicle_snapshot jsonb not null default '{}'::jsonb,
  insurance_snapshot jsonb not null default '{}'::jsonb,
  vehicle_condition jsonb not null default '{}'::jsonb,
  vehicle_contents jsonb not null default '{}'::jsonb,
  damage_map jsonb not null default '{}'::jsonb,
  declaration_ar text null,
  declaration_en text null,
  issued_at timestamptz null,
  issued_by uuid null,
  created_by uuid null,
  updated_by uuid null,
  deleted_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_entries_number_unique unique (tenant_id, entry_number)
);

create index if not exists vehicle_entries_tenant_arrival_idx
  on public.vehicle_entries(tenant_id, arrival_date desc, arrival_time desc)
  where deleted_at is null;

create index if not exists vehicle_entries_customer_idx
  on public.vehicle_entries(tenant_id, customer_id)
  where customer_id is not null and deleted_at is null;

create index if not exists vehicle_entries_vehicle_idx
  on public.vehicle_entries(tenant_id, vehicle_id)
  where vehicle_id is not null and deleted_at is null;

create index if not exists vehicle_entries_claim_idx
  on public.vehicle_entries(tenant_id, insurance_claim_id)
  where insurance_claim_id is not null and deleted_at is null;

create table if not exists public.vehicle_entry_damage_marks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_entry_id uuid not null references public.vehicle_entries(id) on delete cascade,
  mark_number integer not null,
  damage_type text null,
  vehicle_part text null,
  description text null,
  related_to_incident boolean null,
  expected_action text null,
  notes text null,
  x numeric null,
  y numeric null,
  color text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, vehicle_entry_id, mark_number)
);

create index if not exists vehicle_entry_damage_marks_entry_idx
  on public.vehicle_entry_damage_marks(tenant_id, vehicle_entry_id, mark_number);

create table if not exists public.vehicle_entry_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_entry_id uuid not null references public.vehicle_entries(id) on delete cascade,
  vehicle_media_id uuid null references public.vehicle_media(id) on delete set null,
  document_type text not null default 'other',
  file_name text null,
  notes text null,
  uploaded_by uuid null,
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz null
);

create index if not exists vehicle_entry_documents_entry_idx
  on public.vehicle_entry_documents(tenant_id, vehicle_entry_id, uploaded_at desc)
  where deleted_at is null;

create table if not exists public.vehicle_entry_signatures (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_entry_id uuid not null references public.vehicle_entries(id) on delete cascade,
  signature_role text not null check (signature_role in ('delivered_by','receiver','override')),
  signer_name text null,
  signer_phone text null,
  signer_title text null,
  signature_data_url text null,
  signed_at timestamptz null,
  signed_by uuid null,
  override_reason text null,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_entry_signatures_entry_idx
  on public.vehicle_entry_signatures(tenant_id, vehicle_entry_id, signature_role, created_at desc);

create table if not exists public.vehicle_entry_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  vehicle_entry_id uuid not null references public.vehicle_entries(id) on delete cascade,
  user_id uuid null,
  action text not null,
  old_value jsonb null,
  new_value jsonb null,
  reason text null,
  created_at timestamptz not null default now()
);

create index if not exists vehicle_entry_audit_logs_entry_idx
  on public.vehicle_entry_audit_logs(tenant_id, vehicle_entry_id, created_at desc);

alter table public.vehicle_media
  add column if not exists vehicle_entry_id uuid null references public.vehicle_entries(id) on delete set null;

create index if not exists vehicle_media_vehicle_entry_idx
  on public.vehicle_media(tenant_id, vehicle_entry_id, uploaded_at desc)
  where vehicle_entry_id is not null and deleted_at is null;

alter table public.insurance_claims
  add column if not exists vehicle_entry_id uuid null references public.vehicle_entries(id) on delete set null;

alter table public.job_orders
  add column if not exists vehicle_entry_id uuid null references public.vehicle_entries(id) on delete set null;

alter table public.vehicle_entry_sequences enable row level security;
alter table public.vehicle_entries enable row level security;
alter table public.vehicle_entry_damage_marks enable row level security;
alter table public.vehicle_entry_documents enable row level security;
alter table public.vehicle_entry_signatures enable row level security;
alter table public.vehicle_entry_audit_logs enable row level security;

drop policy if exists "Staff manage vehicle entry sequences" on public.vehicle_entry_sequences;
create policy "Staff manage vehicle entry sequences"
on public.vehicle_entry_sequences for all
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]));

drop policy if exists "Staff manage vehicle entries" on public.vehicle_entries;
create policy "Staff manage vehicle entries"
on public.vehicle_entries for all
using (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ])
)
with check (
  tenant_id = public.get_user_tenant_id()
  and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ])
);

drop policy if exists "Staff manage vehicle entry damage marks" on public.vehicle_entry_damage_marks;
create policy "Staff manage vehicle entry damage marks"
on public.vehicle_entry_damage_marks for all
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]));

drop policy if exists "Staff manage vehicle entry documents" on public.vehicle_entry_documents;
create policy "Staff manage vehicle entry documents"
on public.vehicle_entry_documents for all
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]));

drop policy if exists "Staff manage vehicle entry signatures" on public.vehicle_entry_signatures;
create policy "Staff manage vehicle entry signatures"
on public.vehicle_entry_signatures for all
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]));

drop policy if exists "Staff manage vehicle entry audit logs" on public.vehicle_entry_audit_logs;
create policy "Staff manage vehicle entry audit logs"
on public.vehicle_entry_audit_logs for all
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role,'technician'::app_role
  ]));

create or replace function public.touch_vehicle_entries_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_touch_vehicle_entries on public.vehicle_entries;
create trigger trg_touch_vehicle_entries
before update on public.vehicle_entries
for each row execute function public.touch_vehicle_entries_updated_at();

