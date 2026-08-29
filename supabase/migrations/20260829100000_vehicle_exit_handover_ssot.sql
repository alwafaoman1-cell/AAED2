-- Vehicle Exit & Handover SSOT
-- Keeps every finalized handover immutable and preserves cancelled deliveries as history.

create table if not exists public.vehicle_handover_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  sequence_year integer not null,
  last_number bigint not null default 0 check (last_number >= 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, sequence_year)
);

create table if not exists public.vehicle_handover_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  work_order_id uuid not null references public.job_orders(id) on delete restrict,
  claim_id uuid null references public.insurance_claims(id) on delete restrict,
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  customer_id uuid null references public.customers(id) on delete restrict,
  vehicle_entry_id uuid null references public.vehicle_entries(id) on delete restrict,
  visit_number integer null,
  receipt_number text null,
  status text not null default 'draft' check (status in ('draft','finalized','cancelled')),
  delivered_at timestamptz not null default now(),
  mileage_out text null,
  vehicle_condition text null,
  recipient_type text not null default 'customer' check (recipient_type in (
    'customer','owner','representative','driver','tow_truck','insurance_representative'
  )),
  recipient_name text not null default '',
  recipient_phone text null,
  recipient_id_number text null,
  recipient_relationship text null,
  workshop_representative text null,
  work_summary text null,
  parts_replaced text null,
  warranty_notes text null,
  satisfaction_notes text null,
  declaration_ar text null,
  declaration_en text null,
  delivery_photo_paths jsonb not null default '[]'::jsonb,
  signature_data_url text null,
  receiver_id_photo_url text null,
  snapshot_json jsonb not null default '{}'::jsonb,
  finalized_at timestamptz null,
  finalized_by uuid null references auth.users(id) on delete set null,
  cancelled_at timestamptz null,
  cancelled_by uuid null references auth.users(id) on delete set null,
  cancellation_reason text null,
  created_at timestamptz not null default now(),
  created_by uuid null references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid null references auth.users(id) on delete set null,
  check (status <> 'finalized' or (receipt_number is not null and finalized_at is not null)),
  check (status <> 'cancelled' or (cancelled_at is not null and nullif(trim(cancellation_reason), '') is not null))
);

create unique index if not exists vehicle_handover_one_draft_per_work_order
  on public.vehicle_handover_records(tenant_id, work_order_id)
  where status = 'draft';

create unique index if not exists vehicle_handover_one_active_final_per_work_order
  on public.vehicle_handover_records(tenant_id, work_order_id)
  where status = 'finalized';

create unique index if not exists vehicle_handover_receipt_number_uq
  on public.vehicle_handover_records(tenant_id, receipt_number)
  where receipt_number is not null;

create index if not exists vehicle_handover_claim_idx
  on public.vehicle_handover_records(tenant_id, claim_id, delivered_at desc);
create index if not exists vehicle_handover_vehicle_idx
  on public.vehicle_handover_records(tenant_id, vehicle_id, delivered_at desc);
create index if not exists vehicle_handover_work_order_idx
  on public.vehicle_handover_records(tenant_id, work_order_id, created_at desc);

alter table public.vehicle_handover_sequences enable row level security;
alter table public.vehicle_handover_records enable row level security;

drop policy if exists vehicle_handover_sequences_staff on public.vehicle_handover_sequences;
create policy vehicle_handover_sequences_staff on public.vehicle_handover_sequences
for select to authenticated
using (tenant_id = public.get_user_tenant_id());

drop policy if exists vehicle_handover_records_read on public.vehicle_handover_records;
create policy vehicle_handover_records_read on public.vehicle_handover_records
for select to authenticated
using (tenant_id = public.get_user_tenant_id());

drop policy if exists vehicle_handover_records_insert_draft on public.vehicle_handover_records;
create policy vehicle_handover_records_insert_draft on public.vehicle_handover_records
for insert to authenticated
with check (
  tenant_id = public.get_user_tenant_id()
  and status = 'draft'
  and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role
  ])
);

drop policy if exists vehicle_handover_records_update_draft on public.vehicle_handover_records;
create policy vehicle_handover_records_update_draft on public.vehicle_handover_records
for update to authenticated
using (
  tenant_id = public.get_user_tenant_id()
  and status = 'draft'
  and public.get_user_role() = any (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role
  ])
)
with check (tenant_id = public.get_user_tenant_id());

create or replace function public.guard_vehicle_handover_immutability()
returns trigger
language plpgsql
set search_path = public
as $$
declare v_transition text := current_setting('app.vehicle_handover_transition', true);
begin
  if tg_op = 'DELETE' then
    raise exception 'VEHICLE_HANDOVER_DELETE_FORBIDDEN';
  end if;
  if old.status in ('finalized','cancelled') and coalesce(v_transition, '') <> 'cancel' then
    raise exception 'VEHICLE_HANDOVER_FINALIZED_IMMUTABLE';
  end if;
  if old.status = 'draft' and new.status <> 'draft' and coalesce(v_transition, '') <> 'finalize' then
    raise exception 'VEHICLE_HANDOVER_TRANSITION_REQUIRES_RPC';
  end if;
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_guard_vehicle_handover_immutability on public.vehicle_handover_records;
create trigger trg_guard_vehicle_handover_immutability
before update or delete on public.vehicle_handover_records
for each row execute function public.guard_vehicle_handover_immutability();

create or replace function public.finalize_vehicle_handover(p_record_id uuid)
returns public.vehicle_handover_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_record public.vehicle_handover_records;
  v_year integer;
  v_sequence bigint;
  v_receipt text;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'VEHICLE_HANDOVER_AUTH_REQUIRED';
  end if;
  if public.get_user_role() <> all (array[
    'admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role
  ]) then
    raise exception 'VEHICLE_HANDOVER_PERMISSION_DENIED';
  end if;

  select * into v_record from public.vehicle_handover_records
  where id = p_record_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VEHICLE_HANDOVER_NOT_FOUND'; end if;
  if v_record.status = 'finalized' then return v_record; end if;
  if v_record.status <> 'draft' then raise exception 'VEHICLE_HANDOVER_NOT_DRAFT'; end if;
  if nullif(trim(v_record.recipient_name), '') is null then
    raise exception 'VEHICLE_HANDOVER_RECIPIENT_REQUIRED';
  end if;
  if nullif(trim(coalesce(v_record.signature_data_url, '')), '') is null then
    raise exception 'VEHICLE_HANDOVER_SIGNATURE_REQUIRED';
  end if;

  v_year := extract(year from v_record.delivered_at at time zone 'Asia/Muscat')::integer;
  insert into public.vehicle_handover_sequences(tenant_id, sequence_year, last_number)
  values (v_tenant, v_year, 1)
  on conflict (tenant_id, sequence_year) do update
    set last_number = public.vehicle_handover_sequences.last_number + 1, updated_at = now()
  returning last_number into v_sequence;
  v_receipt := format('VH-%s-%s', v_year, lpad(v_sequence::text, 5, '0'));

  perform set_config('app.vehicle_handover_transition', 'finalize', true);
  update public.vehicle_handover_records set
    status = 'finalized', receipt_number = v_receipt,
    finalized_at = now(), finalized_by = auth.uid(), updated_at = now(), updated_by = auth.uid()
  where id = p_record_id returning * into v_record;

  update public.job_orders set
    status = 'delivered', vehicle_delivered_at = v_record.delivered_at,
    vehicle_presence_status = 'with_customer', vehicle_location_note = 'تم خروج وتسليم المركبة',
    updated_at = now()
  where id = v_record.work_order_id and tenant_id = v_tenant and deleted_at is null;

  if v_record.claim_id is not null then
    update public.insurance_claims set
      delivered_at = v_record.delivered_at, vehicle_delivered_at = v_record.delivered_at,
      vehicle_presence_status = 'with_customer', repair_stage = 'delivered',
      receiver_name = v_record.recipient_name,
      receiver_id_number = v_record.recipient_id_number,
      receiver_id_photo = v_record.receiver_id_photo_url,
      delivery_notes = v_record.satisfaction_notes,
      vehicle_location_note = 'تم خروج وتسليم المركبة', updated_at = now()
    where id = v_record.claim_id and tenant_id = v_tenant and deleted_at is null;
  end if;

  update public.claim_work_order_operations set
    vehicle_delivered_at = v_record.delivered_at,
    vehicle_presence_status = 'with_customer', operational_status = 'delivered',
    repair_stage = 'delivered', vehicle_location_note = 'تم خروج وتسليم المركبة',
    updated_at = now(), last_changed_from = 'system', last_changed_by = auth.uid()
  where tenant_id = v_tenant
    and (work_order_id = v_record.work_order_id or (v_record.claim_id is not null and claim_id = v_record.claim_id));

  return v_record;
end;
$$;

create or replace function public.cancel_vehicle_handover(p_record_id uuid, p_reason text)
returns public.vehicle_handover_records
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_record public.vehicle_handover_records;
begin
  if auth.uid() is null or v_tenant is null then raise exception 'VEHICLE_HANDOVER_AUTH_REQUIRED'; end if;
  if public.get_user_role() <> all (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]) then
    raise exception 'VEHICLE_HANDOVER_CANCEL_PERMISSION_DENIED';
  end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'VEHICLE_HANDOVER_CANCEL_REASON_REQUIRED'; end if;

  select * into v_record from public.vehicle_handover_records
  where id = p_record_id and tenant_id = v_tenant for update;
  if not found then raise exception 'VEHICLE_HANDOVER_NOT_FOUND'; end if;
  if v_record.status = 'cancelled' then return v_record; end if;
  if v_record.status <> 'finalized' then raise exception 'VEHICLE_HANDOVER_NOT_FINALIZED'; end if;

  perform set_config('app.vehicle_handover_transition', 'cancel', true);
  update public.vehicle_handover_records set
    status = 'cancelled', cancelled_at = now(), cancelled_by = auth.uid(),
    cancellation_reason = trim(p_reason), updated_at = now(), updated_by = auth.uid()
  where id = p_record_id returning * into v_record;

  update public.job_orders set
    status = 'completed', vehicle_delivered_at = null,
    vehicle_presence_status = 'in_workshop',
    vehicle_location_note = 'إلغاء التسليم: ' || trim(p_reason), updated_at = now()
  where id = v_record.work_order_id and tenant_id = v_tenant and deleted_at is null;

  if v_record.claim_id is not null then
    update public.insurance_claims set
      delivered_at = null, vehicle_delivered_at = null,
      vehicle_presence_status = 'in_workshop', repair_stage = 'ready',
      vehicle_location_note = 'إلغاء التسليم: ' || trim(p_reason), updated_at = now()
    where id = v_record.claim_id and tenant_id = v_tenant and deleted_at is null;
  end if;

  update public.claim_work_order_operations set
    vehicle_delivered_at = null, vehicle_presence_status = 'in_workshop',
    operational_status = 'completed', repair_stage = 'ready',
    vehicle_location_note = 'إلغاء التسليم: ' || trim(p_reason),
    updated_at = now(), last_changed_from = 'system', last_changed_by = auth.uid()
  where tenant_id = v_tenant
    and (work_order_id = v_record.work_order_id or (v_record.claim_id is not null and claim_id = v_record.claim_id));
  return v_record;
end;
$$;

revoke all on function public.finalize_vehicle_handover(uuid) from public;
revoke all on function public.cancel_vehicle_handover(uuid, text) from public;
grant execute on function public.finalize_vehicle_handover(uuid) to authenticated;
grant execute on function public.cancel_vehicle_handover(uuid, text) to authenticated;

grant select, insert, update on public.vehicle_handover_records to authenticated;
grant select on public.vehicle_handover_sequences to authenticated;

comment on table public.vehicle_handover_records is
  'Single source of truth for vehicle exit and customer handover; finalized rows are immutable.';
