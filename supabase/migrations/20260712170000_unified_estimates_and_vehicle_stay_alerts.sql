-- Unified estimates + vehicle stay alerts.
-- Non destructive: creates new tables and adds optional claim fields only.

create table if not exists public.estimate_sequences (
  tenant_id uuid not null,
  year integer not null,
  next_value integer not null default 1,
  updated_at timestamptz not null default now(),
  primary key (tenant_id, year)
);

create table if not exists public.estimates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  estimate_number text not null,
  estimate_type text not null default 'independent'
    check (estimate_type in ('independent','insurance','supplementary')),
  status text not null default 'draft'
    check (status in ('draft','issued','approved','rejected','converted','expired','archived')),
  customer_id uuid null references public.customers(id) on delete set null,
  vehicle_id uuid null references public.vehicles(id) on delete set null,
  claim_id uuid null references public.insurance_claims(id) on delete set null,
  work_order_id uuid null references public.job_orders(id) on delete set null,
  insurance_company_id uuid null,
  insurance_employee_id uuid null,
  parent_estimate_id uuid null references public.estimates(id) on delete set null,
  title text null,
  purpose text null,
  estimate_date date not null default current_date,
  valid_until date null,
  currency text not null default 'OMR',
  subtotal numeric(12,3) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  vat_amount numeric(12,3) not null default 0,
  total numeric(12,3) not null default 0,
  notes text null,
  terms text null,
  internal_notes text null,
  issued_at timestamptz null,
  issued_by uuid null,
  converted_at timestamptz null,
  archived_at timestamptz null,
  created_by uuid null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, estimate_number)
);

create table if not exists public.estimate_items (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  estimate_id uuid not null references public.estimates(id) on delete cascade,
  category text not null default 'other'
    check (category in ('labor','parts','paint_materials','mechanical','electrical','programming','diagnosis','sublet','transport','other')),
  description_ar text null,
  description_en text null,
  quantity numeric(12,3) not null default 1,
  unit_price numeric(12,3) not null default 0,
  line_subtotal numeric(12,3) not null default 0,
  vat_rate numeric(5,2) not null default 5,
  vat_amount numeric(12,3) not null default 0,
  line_total numeric(12,3) not null default 0,
  sort_order integer not null default 0,
  notes text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.vehicle_stay_notifications (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  claim_id uuid null references public.insurance_claims(id) on delete set null,
  work_order_id uuid null references public.job_orders(id) on delete set null,
  customer_id uuid null references public.customers(id) on delete set null,
  vehicle_id uuid null references public.vehicles(id) on delete set null,
  trigger_days integer not null,
  vehicle_days_in_workshop integer not null,
  notification_type text not null default 'vehicle_stay',
  channel text not null default 'internal',
  recipient text null,
  template_key text null,
  status text not null default 'draft'
    check (status in ('draft','pending_review','approved','sent','failed','acknowledged','snoozed','excluded')),
  scheduled_at timestamptz null,
  sent_at timestamptz null,
  failed_at timestamptz null,
  failure_reason text null,
  acknowledged_at timestamptz null,
  acknowledged_by uuid null,
  snoozed_until timestamptz null,
  delay_reason text null,
  last_contact_at timestamptz null,
  internal_note text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_rules (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  rule_key text not null,
  enabled boolean not null default true,
  trigger_days integer not null default 30,
  repeat_every_days integer not null default 7,
  send_mode text not null default 'draft_requires_review'
    check (send_mode in ('internal_only','draft_requires_review','send_after_approval','automatic')),
  channels text[] not null default array['internal']::text[],
  require_approval boolean not null default true,
  template_ar text null,
  template_en text null,
  exclude_statuses text[] not null default array['delivered','cancelled','closed']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, rule_key)
);

alter table public.insurance_claims
  add column if not exists replacement_vehicle_requested boolean default false,
  add column if not exists replacement_vehicle_policy_includes boolean,
  add column if not exists replacement_vehicle_request_type text,
  add column if not exists replacement_vehicle_requested_at timestamptz,
  add column if not exists replacement_vehicle_insurance_company text,
  add column if not exists replacement_vehicle_responsible_employee text,
  add column if not exists replacement_vehicle_status text default 'not_requested',
  add column if not exists replacement_vehicle_benefit_start_at date,
  add column if not exists replacement_vehicle_approved_days integer,
  add column if not exists replacement_vehicle_daily_amount numeric(12,3),
  add column if not exists replacement_vehicle_required_documents text,
  add column if not exists replacement_vehicle_insurance_note text,
  add column if not exists vehicle_stay_alert_excluded boolean default false,
  add column if not exists vehicle_stay_delay_reason text,
  add column if not exists vehicle_stay_last_contact_at timestamptz;

create or replace function public.generate_unified_estimate_number()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_year integer := extract(year from coalesce(NEW.estimate_date, current_date))::integer;
  v_next integer;
begin
  if NEW.estimate_number is null or btrim(NEW.estimate_number) = '' then
    insert into public.estimate_sequences (tenant_id, year, next_value)
    values (NEW.tenant_id, v_year, 2)
    on conflict (tenant_id, year)
    do update set next_value = public.estimate_sequences.next_value + 1,
                  updated_at = now()
    returning next_value - 1 into v_next;

    NEW.estimate_number := 'EST-' || v_year::text || '-' || lpad(v_next::text, 5, '0');
  end if;
  return NEW;
end
$$;

drop trigger if exists trg_estimates_number on public.estimates;
create trigger trg_estimates_number
before insert on public.estimates
for each row execute function public.generate_unified_estimate_number();

drop trigger if exists trg_estimates_updated on public.estimates;
create trigger trg_estimates_updated
before update on public.estimates
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_estimate_items_updated on public.estimate_items;
create trigger trg_estimate_items_updated
before update on public.estimate_items
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_vehicle_stay_notifications_updated on public.vehicle_stay_notifications;
create trigger trg_vehicle_stay_notifications_updated
before update on public.vehicle_stay_notifications
for each row execute function public.update_updated_at_column();

drop trigger if exists trg_notification_rules_updated on public.notification_rules;
create trigger trg_notification_rules_updated
before update on public.notification_rules
for each row execute function public.update_updated_at_column();

create index if not exists idx_estimates_tenant_created on public.estimates(tenant_id, created_at desc);
create index if not exists idx_estimates_tenant_type_status on public.estimates(tenant_id, estimate_type, status);
create index if not exists idx_estimates_claim on public.estimates(claim_id);
create index if not exists idx_estimates_work_order on public.estimates(work_order_id);
create index if not exists idx_estimate_items_estimate on public.estimate_items(estimate_id, sort_order);
create index if not exists idx_vehicle_stay_notifications_tenant_status on public.vehicle_stay_notifications(tenant_id, status, created_at desc);
create index if not exists idx_notification_rules_tenant_key on public.notification_rules(tenant_id, rule_key);

alter table public.estimate_sequences enable row level security;
alter table public.estimates enable row level security;
alter table public.estimate_items enable row level security;
alter table public.vehicle_stay_notifications enable row level security;
alter table public.notification_rules enable row level security;

drop policy if exists "Tenant read estimate sequences" on public.estimate_sequences;
create policy "Tenant read estimate sequences"
on public.estimate_sequences for select to authenticated
using (tenant_id = public.get_user_tenant_id());

drop policy if exists "Staff manage estimate sequences" on public.estimate_sequences;
create policy "Staff manage estimate sequences"
on public.estimate_sequences for all to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]));

drop policy if exists "Staff manage estimates" on public.estimates;
create policy "Staff manage estimates"
on public.estimates for all to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]));

drop policy if exists "Staff manage estimate items" on public.estimate_items;
create policy "Staff manage estimate items"
on public.estimate_items for all to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role]));

drop policy if exists "Staff manage vehicle stay notifications" on public.vehicle_stay_notifications;
create policy "Staff manage vehicle stay notifications"
on public.vehicle_stay_notifications for all to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role,'insurance'::app_role,'supervisor'::app_role]));

drop policy if exists "Managers manage notification rules" on public.notification_rules;
create policy "Managers manage notification rules"
on public.notification_rules for all to authenticated
using (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role]))
with check (tenant_id = public.get_user_tenant_id() and public.get_user_role() = any (array['admin'::app_role,'manager'::app_role]));

