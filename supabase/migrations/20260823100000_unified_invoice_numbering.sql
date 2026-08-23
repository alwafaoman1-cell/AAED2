-- Unified Invoice Numbering (future invoices only)
-- Format: INV-YYYY-NNNNNN, scoped by tenant and invoice issue year.
--
-- Safety guarantees:
--   * This migration never updates/backfills an existing invoice.
--   * Numbering stays inactive until an administrator explicitly calls
--     activate_unified_invoice_numbering after approving the cutover value.
--   * Existing invoice templates, totals, VAT and accounting records are untouched.

create table if not exists public.invoice_numbering_settings (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  prefix text not null default 'INV' check (prefix = 'INV'),
  padding smallint not null default 6 check (padding >= 6 and padding <= 12),
  activated_at timestamptz not null,
  activated_by uuid,
  cutover_year smallint not null check (cutover_year between 2000 and 9999),
  first_sequence bigint not null check (first_sequence > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.invoice_number_sequences (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_year smallint not null check (invoice_year between 2000 and 9999),
  next_value bigint not null check (next_value > 0),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, invoice_year)
);

create table if not exists public.invoice_number_registry (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  invoice_year smallint not null check (invoice_year between 2000 and 9999),
  sequence_number bigint not null check (sequence_number > 0),
  invoice_number text not null check (invoice_number ~ '^INV-[0-9]{4}-[0-9]{6,}$'),
  invoice_type text not null check (invoice_type in ('cash', 'insurance')),
  source_table text not null check (source_table in ('sales_documents', 'insurance_invoices')),
  source_id uuid not null,
  issued_at timestamptz not null,
  issued_by uuid,
  created_at timestamptz not null default now(),
  constraint invoice_number_registry_tenant_number_key unique (tenant_id, invoice_number),
  constraint invoice_number_registry_tenant_year_sequence_key unique (tenant_id, invoice_year, sequence_number),
  constraint invoice_number_registry_source_key unique (tenant_id, source_table, source_id)
);

create table if not exists public.invoice_number_audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  registry_id uuid not null references public.invoice_number_registry(id) on delete restrict,
  source_table text not null check (source_table in ('sales_documents', 'insurance_invoices')),
  source_id uuid not null,
  invoice_number text not null,
  event_type text not null check (event_type in ('allocated', 'cancelled', 'void', 'reversed')),
  event_at timestamptz not null default now(),
  event_by uuid,
  details jsonb not null default '{}'::jsonb,
  constraint invoice_number_audit_event_once_key
    unique (tenant_id, source_table, source_id, event_type)
);

create index if not exists idx_invoice_number_registry_source
  on public.invoice_number_registry (source_table, source_id);
create index if not exists idx_invoice_number_registry_issued
  on public.invoice_number_registry (tenant_id, issued_at desc);
create index if not exists idx_invoice_number_audit_events_source
  on public.invoice_number_audit_events (tenant_id, source_table, source_id, event_at desc);

-- The legacy insurance table used a global UNIQUE(invoice_number), which is
-- incompatible with per-tenant numbering. Replace only that constraint; no row
-- or historical number is changed.
alter table public.insurance_invoices
  drop constraint if exists insurance_invoices_invoice_number_key;
create unique index if not exists insurance_invoices_tenant_invoice_number_key
  on public.insurance_invoices (tenant_id, invoice_number)
  where invoice_number <> '';

alter table public.invoice_numbering_settings enable row level security;
alter table public.invoice_number_sequences enable row level security;
alter table public.invoice_number_registry enable row level security;
alter table public.invoice_number_audit_events enable row level security;

drop policy if exists invoice_numbering_settings_tenant_read on public.invoice_numbering_settings;
create policy invoice_numbering_settings_tenant_read
  on public.invoice_numbering_settings for select to authenticated
  using (tenant_id = public.get_user_tenant_id());

drop policy if exists invoice_number_sequences_tenant_read on public.invoice_number_sequences;
create policy invoice_number_sequences_tenant_read
  on public.invoice_number_sequences for select to authenticated
  using (tenant_id = public.get_user_tenant_id());

drop policy if exists invoice_number_registry_tenant_read on public.invoice_number_registry;
create policy invoice_number_registry_tenant_read
  on public.invoice_number_registry for select to authenticated
  using (tenant_id = public.get_user_tenant_id());

drop policy if exists invoice_number_audit_events_tenant_read on public.invoice_number_audit_events;
create policy invoice_number_audit_events_tenant_read
  on public.invoice_number_audit_events for select to authenticated
  using (tenant_id = public.get_user_tenant_id());

revoke all on public.invoice_numbering_settings from public, anon, authenticated;
revoke all on public.invoice_number_sequences from public, anon, authenticated;
revoke all on public.invoice_number_registry from public, anon, authenticated;
revoke all on public.invoice_number_audit_events from public, anon, authenticated;
grant select on public.invoice_numbering_settings to authenticated;
grant select on public.invoice_number_sequences to authenticated;
grant select on public.invoice_number_registry to authenticated;
grant select on public.invoice_number_audit_events to authenticated;
grant all on public.invoice_numbering_settings to service_role;
grant all on public.invoice_number_sequences to service_role;
grant all on public.invoice_number_registry to service_role;
grant all on public.invoice_number_audit_events to service_role;

create or replace function public.prevent_invoice_number_registry_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  raise exception 'official invoice number registry records are immutable' using errcode = '55000';
end;
$$;

drop trigger if exists trg_invoice_number_registry_immutable on public.invoice_number_registry;
create trigger trg_invoice_number_registry_immutable
  before update or delete on public.invoice_number_registry
  for each row execute function public.prevent_invoice_number_registry_mutation();

revoke all on function public.prevent_invoice_number_registry_mutation()
  from public, anon, authenticated;

create or replace function public.unified_invoice_numbering_is_active(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.invoice_numbering_settings s
    where s.tenant_id = p_tenant_id
      and s.activated_at <= clock_timestamp()
  );
$$;

revoke all on function public.unified_invoice_numbering_is_active(uuid) from public, anon, authenticated;
grant execute on function public.unified_invoice_numbering_is_active(uuid) to service_role;

create or replace function public.allocate_invoice_number_internal(
  p_tenant_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_invoice_type text,
  p_issue_date date,
  p_issued_at timestamptz,
  p_issued_by uuid
)
returns public.invoice_number_registry
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.invoice_number_registry%rowtype;
  v_settings public.invoice_numbering_settings%rowtype;
  v_year smallint;
  v_sequence bigint;
  v_number text;
  v_result public.invoice_number_registry%rowtype;
begin
  if p_tenant_id is null or p_source_id is null then
    raise exception 'tenant_id and source_id are required' using errcode = '22004';
  end if;
  if p_source_table not in ('sales_documents', 'insurance_invoices') then
    raise exception 'unsupported invoice source: %', p_source_table using errcode = '22023';
  end if;
  if p_invoice_type not in ('cash', 'insurance') then
    raise exception 'unsupported invoice type: %', p_invoice_type using errcode = '22023';
  end if;
  if (p_source_table = 'sales_documents' and p_invoice_type <> 'cash')
     or (p_source_table = 'insurance_invoices' and p_invoice_type <> 'insurance') then
    raise exception 'invoice type does not match source table' using errcode = '22023';
  end if;

  -- The source-specific transaction lock makes retries idempotent before a
  -- sequence value is consumed, while the sequence row serializes all invoice
  -- types for the tenant/year.
  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_source_table || ':' || p_source_id::text, 0)
  );

  select * into v_existing
  from public.invoice_number_registry
  where tenant_id = p_tenant_id
    and source_table = p_source_table
    and source_id = p_source_id;
  if found then
    return v_existing;
  end if;

  select * into v_settings
  from public.invoice_numbering_settings
  where tenant_id = p_tenant_id
    and activated_at <= clock_timestamp()
  for share;
  if not found then
    raise exception 'unified invoice numbering is not active for this tenant' using errcode = '55000';
  end if;

  v_year := extract(year from p_issue_date)::smallint;

  insert into public.invoice_number_sequences (tenant_id, invoice_year, next_value, updated_at)
  values (
    p_tenant_id,
    v_year,
    case when v_year = v_settings.cutover_year then v_settings.first_sequence + 1 else 2 end,
    clock_timestamp()
  )
  on conflict (tenant_id, invoice_year) do update
    set next_value = public.invoice_number_sequences.next_value + 1,
        updated_at = clock_timestamp()
  returning next_value - 1 into v_sequence;

  v_number := v_settings.prefix || '-' || v_year::text || '-' ||
    lpad(v_sequence::text, greatest(v_settings.padding, 6), '0');

  insert into public.invoice_number_registry (
    tenant_id, invoice_year, sequence_number, invoice_number,
    invoice_type, source_table, source_id, issued_at, issued_by
  ) values (
    p_tenant_id, v_year, v_sequence, v_number,
    p_invoice_type, p_source_table, p_source_id,
    coalesce(p_issued_at, clock_timestamp()), p_issued_by
  )
  returning * into v_result;

  insert into public.invoice_number_audit_events (
    tenant_id, registry_id, source_table, source_id, invoice_number,
    event_type, event_at, event_by
  ) values (
    p_tenant_id, v_result.id, p_source_table, p_source_id, v_result.invoice_number,
    'allocated', v_result.issued_at, p_issued_by
  );

  return v_result;
end;
$$;

revoke all on function public.allocate_invoice_number_internal(uuid,text,uuid,text,date,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.allocate_invoice_number_internal(uuid,text,uuid,text,date,timestamptz,uuid)
  to service_role;

create or replace function public.activate_unified_invoice_numbering(
  p_year smallint,
  p_first_sequence bigint,
  p_padding smallint default 6
)
returns public.invoice_numbering_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_result public.invoice_numbering_settings%rowtype;
begin
  v_tenant_id := public.get_user_tenant_id();
  v_role := public.get_user_role()::text;
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'invoice numbering activation requires admin or manager' using errcode = '42501';
  end if;
  if p_year not between 2000 and 9999 or p_first_sequence < 1 or p_padding not between 6 and 12 then
    raise exception 'invalid cutover parameters' using errcode = '22023';
  end if;
  if exists (select 1 from public.invoice_numbering_settings where tenant_id = v_tenant_id) then
    raise exception 'unified invoice numbering is already activated for this tenant' using errcode = '55000';
  end if;

  insert into public.invoice_numbering_settings (
    tenant_id, activated_at, activated_by, cutover_year, first_sequence, padding
  ) values (
    v_tenant_id, clock_timestamp(), auth.uid(), p_year, p_first_sequence, p_padding
  ) returning * into v_result;

  insert into public.invoice_number_sequences (tenant_id, invoice_year, next_value)
  values (v_tenant_id, p_year, p_first_sequence)
  on conflict (tenant_id, invoice_year) do nothing;

  return v_result;
end;
$$;

revoke all on function public.activate_unified_invoice_numbering(smallint,bigint,smallint)
  from public, anon;
grant execute on function public.activate_unified_invoice_numbering(smallint,bigint,smallint)
  to authenticated, service_role;

create or replace function public.enforce_sales_document_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registry public.invoice_number_registry%rowtype;
  v_is_official boolean;
  v_was_official boolean := false;
  v_issue_date date;
begin
  if new.doc_type <> 'invoice' then
    return new;
  end if;

  select * into v_registry
  from public.invoice_number_registry
  where tenant_id = new.tenant_id
    and source_table = 'sales_documents'
    and source_id = new.id;
  if found then
    new.doc_number := v_registry.invoice_number;
    if lower(coalesce(new.invoice_status, 'issued')) not in ('cancelled', 'canceled', 'credited') then
      new.invoice_status := 'issued';
    end if;
    new.issued_at := coalesce(new.issued_at, v_registry.issued_at);
    return new;
  end if;

  if not public.unified_invoice_numbering_is_active(new.tenant_id) then
    return new;
  end if;

  v_is_official := lower(coalesce(new.invoice_status, 'draft')) in ('issued', 'approved', 'finalized')
    or new.issued_at is not null;
  if tg_op = 'UPDATE' then
    v_was_official := lower(coalesce(old.invoice_status, 'draft')) in ('issued', 'approved', 'finalized')
      or old.issued_at is not null;
  end if;

  if not v_is_official then
    -- A future draft never consumes or displays an official invoice number.
    if tg_op = 'INSERT' then
      new.doc_number := '';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and v_was_official then
    -- Historical issued rows have no registry and are deliberately untouched.
    return new;
  end if;

  v_issue_date := coalesce(new.date, new.issued_at::date);
  new.issued_at := coalesce(new.issued_at, v_issue_date::timestamptz, clock_timestamp());
  select * into v_registry from public.allocate_invoice_number_internal(
    new.tenant_id, 'sales_documents', new.id, 'cash',
    v_issue_date, new.issued_at, coalesce(new.issued_by, auth.uid())
  );
  new.doc_number := v_registry.invoice_number;
  new.invoice_status := 'issued';
  new.locked_at := coalesce(new.locked_at, new.issued_at);
  new.locked_by := coalesce(new.locked_by, new.issued_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_unified_sales_document_invoice_number on public.sales_documents;
create trigger trg_unified_sales_document_invoice_number
  before insert or update of doc_number, invoice_status, issued_at, status, date
  on public.sales_documents
  for each row execute function public.enforce_sales_document_invoice_number();

create or replace function public.enforce_insurance_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registry public.invoice_number_registry%rowtype;
  v_is_official boolean;
  v_was_official boolean := false;
  v_issue_date date;
begin
  select * into v_registry
  from public.invoice_number_registry
  where tenant_id = new.tenant_id
    and source_table = 'insurance_invoices'
    and source_id = new.id;
  if found then
    new.invoice_number := v_registry.invoice_number;
    new.issued_at := coalesce(new.issued_at, v_registry.issued_at);
    return new;
  end if;

  if not public.unified_invoice_numbering_is_active(new.tenant_id) then
    return new;
  end if;

  v_is_official := lower(coalesce(new.status, 'draft')) not in ('draft', 'pending');
  if tg_op = 'UPDATE' then
    v_was_official := lower(coalesce(old.status, 'draft')) not in ('draft', 'pending');
  end if;
  if not v_is_official then
    if tg_op = 'INSERT' then
      new.invoice_number := '';
    end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and v_was_official then
    return new;
  end if;

  v_issue_date := coalesce(new.invoice_date, new.issued_at::date, current_date);
  new.issued_at := coalesce(new.issued_at, v_issue_date::timestamptz, clock_timestamp());
  select * into v_registry from public.allocate_invoice_number_internal(
    new.tenant_id, 'insurance_invoices', new.id, 'insurance',
    v_issue_date, new.issued_at, auth.uid()
  );
  new.invoice_number := v_registry.invoice_number;
  return new;
end;
$$;

-- Retire the old insurance-only sequence trigger without dropping its sequence
-- or changing any historical invoice number.
drop trigger if exists trg_ins_invoice_number on public.insurance_invoices;
drop trigger if exists trg_unified_insurance_invoice_number on public.insurance_invoices;
create trigger trg_unified_insurance_invoice_number
  before insert or update of invoice_number, status, invoice_date, issued_at
  on public.insurance_invoices
  for each row execute function public.enforce_insurance_invoice_number();

create or replace function public.audit_unified_invoice_terminal_status()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registry public.invoice_number_registry%rowtype;
  v_old_status text;
  v_new_status text;
  v_event_type text;
begin
  if tg_table_name = 'sales_documents' then
    if new.doc_type <> 'invoice' then return new; end if;
    v_old_status := case
      when lower(coalesce(old.invoice_status, '')) in ('cancelled', 'canceled', 'void', 'reversed', 'credited')
        then lower(old.invoice_status)
      when lower(coalesce(old.status, '')) in ('cancelled', 'canceled', 'void', 'reversed', 'credited')
        then lower(old.status)
      else lower(coalesce(old.invoice_status, old.status, ''))
    end;
    v_new_status := case
      when lower(coalesce(new.invoice_status, '')) in ('cancelled', 'canceled', 'void', 'reversed', 'credited')
        then lower(new.invoice_status)
      when lower(coalesce(new.status, '')) in ('cancelled', 'canceled', 'void', 'reversed', 'credited')
        then lower(new.status)
      else lower(coalesce(new.invoice_status, new.status, ''))
    end;
  else
    v_old_status := lower(coalesce(old.status, ''));
    v_new_status := lower(coalesce(new.status, ''));
  end if;

  if v_new_status = v_old_status then return new; end if;
  v_event_type := case
    when v_new_status in ('cancelled', 'canceled') then 'cancelled'
    when v_new_status = 'void' then 'void'
    when v_new_status in ('reversed', 'credited') then 'reversed'
    else null
  end;
  if v_event_type is null then return new; end if;

  select * into v_registry
  from public.invoice_number_registry
  where tenant_id = new.tenant_id
    and source_table = tg_table_name
    and source_id = new.id;
  if not found then return new; end if;

  insert into public.invoice_number_audit_events (
    tenant_id, registry_id, source_table, source_id, invoice_number,
    event_type, event_at, event_by, details
  ) values (
    new.tenant_id, v_registry.id, tg_table_name, new.id, v_registry.invoice_number,
    v_event_type, clock_timestamp(), auth.uid(),
    jsonb_build_object('previous_status', v_old_status, 'new_status', v_new_status)
  ) on conflict (tenant_id, source_table, source_id, event_type) do nothing;
  return new;
end;
$$;

drop trigger if exists trg_audit_unified_sales_invoice_status on public.sales_documents;
create trigger trg_audit_unified_sales_invoice_status
  after update of invoice_status, status on public.sales_documents
  for each row execute function public.audit_unified_invoice_terminal_status();

drop trigger if exists trg_audit_unified_insurance_invoice_status on public.insurance_invoices;
create trigger trg_audit_unified_insurance_invoice_status
  after update of status on public.insurance_invoices
  for each row execute function public.audit_unified_invoice_terminal_status();

revoke all on function public.audit_unified_invoice_terminal_status()
  from public, anon, authenticated;

create or replace function public.issue_sales_document_invoice(
  p_source_id uuid,
  p_issue_date date
)
returns table (source_id uuid, invoice_number text, issued_at timestamptz, invoice_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_row public.sales_documents%rowtype;
begin
  v_tenant_id := public.get_user_tenant_id();
  v_role := public.get_user_role()::text;
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'manager', 'insurance') then
    raise exception 'invoice issue permission required' using errcode = '42501';
  end if;
  if p_issue_date is null then
    raise exception 'invoice issue date is required' using errcode = '22004';
  end if;

  select * into v_row
  from public.sales_documents
  where id = p_source_id and tenant_id = v_tenant_id
  for update;
  if not found then
    raise exception 'sales invoice not found' using errcode = 'P0002';
  end if;
  if v_row.doc_type <> 'invoice' then
    raise exception 'source is not a sales invoice' using errcode = '22023';
  end if;

  update public.sales_documents as sd
  set date = p_issue_date,
      invoice_status = 'issued',
      issued_at = coalesce(sd.issued_at, p_issue_date::timestamptz),
      issued_by = coalesce(sd.issued_by, auth.uid()),
      status = case when sd.status = 'draft' then 'unpaid' else sd.status end
  where sd.id = p_source_id and sd.tenant_id = v_tenant_id
  returning sd.* into v_row;

  return query select v_row.id, v_row.doc_number, v_row.issued_at, v_row.invoice_status;
end;
$$;

revoke all on function public.issue_sales_document_invoice(uuid,date) from public, anon;
grant execute on function public.issue_sales_document_invoice(uuid,date) to authenticated, service_role;

create or replace function public.find_unified_invoice_number(p_invoice_number text)
returns table (
  invoice_number text,
  invoice_type text,
  source_table text,
  source_id uuid,
  issued_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select r.invoice_number, r.invoice_type, r.source_table, r.source_id, r.issued_at
  from public.invoice_number_registry r
  where auth.uid() is not null
    and r.tenant_id = public.get_user_tenant_id()
    and r.invoice_number = upper(trim(p_invoice_number))
  limit 1;
$$;

revoke all on function public.find_unified_invoice_number(text) from public, anon;
grant execute on function public.find_unified_invoice_number(text) to authenticated, service_role;

-- Trigger functions are internal implementation details.
revoke all on function public.enforce_sales_document_invoice_number() from public, anon, authenticated;
revoke all on function public.enforce_insurance_invoice_number() from public, anon, authenticated;

comment on table public.invoice_number_registry is
  'Central immutable registry for future official cash and insurance invoice numbers.';
comment on table public.invoice_number_audit_events is
  'Immutable audit events for allocation and terminal status changes of future unified invoices.';
comment on function public.activate_unified_invoice_numbering(smallint,bigint,smallint) is
  'Explicit per-tenant cutover. Does not inspect or renumber historical invoices.';
