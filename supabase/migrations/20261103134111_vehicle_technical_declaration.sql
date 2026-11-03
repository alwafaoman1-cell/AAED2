-- One technical declaration per vehicle visit. No changes to historical entries.
create table public.vehicle_technical_declarations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  vehicle_entry_id uuid not null unique references public.vehicle_entries(id),
  form_data jsonb not null default '{}'::jsonb,
  revision integer not null default 1 check (revision > 0),
  created_by uuid null,
  updated_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint vehicle_technical_declarations_form_check
    check (jsonb_typeof(form_data) = 'object' and octet_length(form_data::text) <= 16000)
);

create index vehicle_technical_declarations_tenant_entry_idx
  on public.vehicle_technical_declarations (tenant_id, vehicle_entry_id);

alter table public.vehicle_technical_declarations enable row level security;
revoke all on public.vehicle_technical_declarations from public, anon, authenticated;
grant select on public.vehicle_technical_declarations to authenticated;
grant insert (tenant_id, vehicle_entry_id, form_data) on public.vehicle_technical_declarations to authenticated;
grant update (form_data) on public.vehicle_technical_declarations to authenticated;

create policy vehicle_technical_declarations_staff_read
on public.vehicle_technical_declarations for select to authenticated
using (
  tenant_id = (select public.get_user_tenant_id())
  and (select public.get_user_role()) = any (array[
    'admin'::public.app_role, 'manager'::public.app_role,
    'insurance'::public.app_role, 'supervisor'::public.app_role,
    'technician'::public.app_role
  ])
  and exists (
    select 1 from public.vehicle_entries e
    where e.id = vehicle_entry_id and e.tenant_id = vehicle_technical_declarations.tenant_id and e.deleted_at is null
  )
);

create policy vehicle_technical_declarations_staff_insert
on public.vehicle_technical_declarations for insert to authenticated
with check (
  tenant_id = (select public.get_user_tenant_id())
  and (select public.get_user_role()) = any (array[
    'admin'::public.app_role, 'manager'::public.app_role,
    'insurance'::public.app_role, 'supervisor'::public.app_role,
    'technician'::public.app_role
  ])
  and exists (
    select 1 from public.vehicle_entries e
    where e.id = vehicle_entry_id and e.tenant_id = vehicle_technical_declarations.tenant_id and e.deleted_at is null
  )
);

create policy vehicle_technical_declarations_staff_update
on public.vehicle_technical_declarations for update to authenticated
using (
  tenant_id = (select public.get_user_tenant_id())
  and (select public.get_user_role()) = any (array[
    'admin'::public.app_role, 'manager'::public.app_role,
    'insurance'::public.app_role, 'supervisor'::public.app_role,
    'technician'::public.app_role
  ])
  and exists (
    select 1 from public.vehicle_entries e
    where e.id = vehicle_entry_id and e.tenant_id = vehicle_technical_declarations.tenant_id and e.deleted_at is null
  )
)
with check (
  tenant_id = (select public.get_user_tenant_id())
  and (select public.get_user_role()) = any (array[
    'admin'::public.app_role, 'manager'::public.app_role,
    'insurance'::public.app_role, 'supervisor'::public.app_role,
    'technician'::public.app_role
  ])
  and exists (
    select 1 from public.vehicle_entries e
    where e.id = vehicle_entry_id and e.tenant_id = vehicle_technical_declarations.tenant_id and e.deleted_at is null
  )
);

create function public.touch_vehicle_technical_declaration()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
    new.updated_by := auth.uid();
  else
    new.revision := old.revision + 1;
    new.updated_by := auth.uid();
    new.updated_at := now();
  end if;
  return new;
end;
$$;

revoke all on function public.touch_vehicle_technical_declaration() from public, anon;
grant execute on function public.touch_vehicle_technical_declaration() to authenticated;

create trigger trg_touch_vehicle_technical_declaration
before insert or update on public.vehicle_technical_declarations
for each row execute function public.touch_vehicle_technical_declaration();
