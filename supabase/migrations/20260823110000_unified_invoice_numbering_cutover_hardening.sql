-- Unified Invoice Numbering cutover hardening.
-- This migration intentionally does not update invoice rows, statuses, totals,
-- VAT, dates, or historical invoice numbers.

alter table public.invoice_numbering_settings
  add column if not exists start_year smallint generated always as (cutover_year) stored,
  add column if not exists starting_sequence bigint generated always as (first_sequence) stored,
  add column if not exists first_invoice_number text generated always as (
    prefix || '-' || cutover_year::text || '-' || lpad(first_sequence::text, greatest(padding, 6), '0')
  ) stored,
  add column if not exists numbering_format text not null default 'INV-YYYY-NNNNNN';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'invoice_numbering_settings_format_check'
      and conrelid = 'public.invoice_numbering_settings'::regclass
  ) then
    alter table public.invoice_numbering_settings
      add constraint invoice_numbering_settings_format_check
      check (numbering_format = 'INV-YYYY-NNNNNN');
  end if;
end;
$$;

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
  v_highest_sales bigint := 0;
  v_highest_insurance bigint := 0;
  v_highest_history bigint := 0;
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

  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text || ':invoice-numbering-activation', 0));

  if exists (select 1 from public.invoice_numbering_settings where tenant_id = v_tenant_id) then
    raise exception 'unified invoice numbering is already activated for this tenant' using errcode = '55000';
  end if;
  if not exists (select 1 from public.profiles p where p.tenant_id = v_tenant_id) then
    raise exception 'INVOICE_NUMBERING_TENANT_HAS_NO_USERS' using errcode = '55000';
  end if;

  select coalesce(max(substring(btrim(sd.doc_number)
      from '^INV-' || p_year::text || '-([0-9]+)$')::bigint), 0)
  into v_highest_sales
  from public.sales_documents sd
  where sd.tenant_id = v_tenant_id
    and sd.doc_type = 'invoice'
    and btrim(coalesce(sd.doc_number, '')) ~ ('^INV-' || p_year::text || '-[0-9]+$');

  select coalesce(max(
    case
      when btrim(ii.invoice_number) ~ '^[0-9]+$'
        then btrim(ii.invoice_number)::bigint
      when btrim(ii.invoice_number) ~ ('^INV-' || p_year::text || '-[0-9]+$')
        then substring(btrim(ii.invoice_number) from '^INV-' || p_year::text || '-([0-9]+)$')::bigint
      else null
    end
  ), 0)
  into v_highest_insurance
  from public.insurance_invoices ii
  where ii.tenant_id = v_tenant_id;

  v_highest_history := greatest(v_highest_sales, v_highest_insurance);
  if p_first_sequence <= v_highest_history then
    raise exception 'INVOICE_SEQUENCE_START_COLLIDES_WITH_HISTORY: start %, highest %',
      p_first_sequence, v_highest_history using errcode = '22023';
  end if;

  insert into public.invoice_numbering_settings (
    tenant_id, activated_at, activated_by, cutover_year, first_sequence, padding, numbering_format
  ) values (
    v_tenant_id, clock_timestamp(), auth.uid(), p_year, p_first_sequence, p_padding, 'INV-YYYY-NNNNNN'
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
  v_settings public.invoice_numbering_settings%rowtype;
  v_is_official boolean;
  v_was_official boolean := false;
  v_issue_date date;
  v_source_created_at timestamptz;
  v_existing_number text;
begin
  if new.doc_type <> 'invoice' then return new; end if;

  select * into v_registry
  from public.invoice_number_registry
  where tenant_id = new.tenant_id and source_table = 'sales_documents' and source_id = new.id;
  if found then
    new.doc_number := v_registry.invoice_number;
    if lower(coalesce(new.invoice_status, 'issued')) not in ('cancelled', 'canceled', 'credited') then
      new.invoice_status := 'issued';
    end if;
    new.issued_at := coalesce(new.issued_at, v_registry.issued_at);
    return new;
  end if;

  select * into v_settings
  from public.invoice_numbering_settings
  where tenant_id = new.tenant_id and activated_at <= clock_timestamp();
  if not found then return new; end if;

  v_source_created_at := case when tg_op = 'UPDATE' then old.created_at else new.created_at end;
  v_existing_number := case when tg_op = 'UPDATE' then old.doc_number else new.doc_number end;
  if v_source_created_at < v_settings.activated_at
     and nullif(btrim(coalesce(v_existing_number, '')), '') is not null then
    new.doc_number := v_existing_number;
    return new;
  end if;

  v_is_official := lower(coalesce(new.invoice_status, 'draft')) in ('issued', 'approved', 'finalized')
    or new.issued_at is not null;
  if tg_op = 'UPDATE' then
    v_was_official := lower(coalesce(old.invoice_status, 'draft')) in ('issued', 'approved', 'finalized')
      or old.issued_at is not null;
  end if;

  if not v_is_official then
    if tg_op = 'INSERT' then new.doc_number := ''; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and v_was_official then return new; end if;

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

create or replace function public.enforce_insurance_invoice_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_registry public.invoice_number_registry%rowtype;
  v_settings public.invoice_numbering_settings%rowtype;
  v_is_official boolean;
  v_was_official boolean := false;
  v_issue_date date;
  v_source_created_at timestamptz;
  v_existing_number text;
begin
  select * into v_registry
  from public.invoice_number_registry
  where tenant_id = new.tenant_id and source_table = 'insurance_invoices' and source_id = new.id;
  if found then
    new.invoice_number := v_registry.invoice_number;
    new.issued_at := coalesce(new.issued_at, v_registry.issued_at);
    return new;
  end if;

  select * into v_settings
  from public.invoice_numbering_settings
  where tenant_id = new.tenant_id and activated_at <= clock_timestamp();
  if not found then return new; end if;

  v_source_created_at := case when tg_op = 'UPDATE' then old.created_at else new.created_at end;
  v_existing_number := case when tg_op = 'UPDATE' then old.invoice_number else new.invoice_number end;
  if v_source_created_at < v_settings.activated_at
     and nullif(btrim(coalesce(v_existing_number, '')), '') is not null then
    new.invoice_number := v_existing_number;
    return new;
  end if;

  v_is_official := lower(coalesce(new.status, 'draft')) not in ('draft', 'pending');
  if tg_op = 'UPDATE' then
    v_was_official := lower(coalesce(old.status, 'draft')) not in ('draft', 'pending');
  end if;
  if not v_is_official then
    if tg_op = 'INSERT' then new.invoice_number := ''; end if;
    return new;
  end if;
  if tg_op = 'UPDATE' and v_was_official then return new; end if;

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
  v_settings public.invoice_numbering_settings%rowtype;
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

  select * into v_row from public.sales_documents
  where id = p_source_id and tenant_id = v_tenant_id for update;
  if not found then raise exception 'sales invoice not found' using errcode = 'P0002'; end if;
  if v_row.doc_type <> 'invoice' then
    raise exception 'source is not a sales invoice' using errcode = '22023';
  end if;

  select * into v_settings from public.invoice_numbering_settings
  where tenant_id = v_tenant_id and activated_at <= clock_timestamp();
  if found and v_row.created_at < v_settings.activated_at
     and nullif(btrim(coalesce(v_row.doc_number, '')), '') is not null then
    return query select v_row.id, v_row.doc_number, v_row.issued_at, v_row.invoice_status;
    return;
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

drop function if exists public.find_unified_invoice_number(text);
create function public.find_unified_invoice_number(p_invoice_number text)
returns table (
  source_type text,
  source_id uuid,
  invoice_number text,
  invoice_type text,
  tenant_id uuid,
  is_historical boolean,
  invoice_date date,
  route text,
  ambiguous_historical_number boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_number text := upper(btrim(coalesce(p_invoice_number, '')));
begin
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_number = '' then return; end if;

  if exists (
    select 1 from public.invoice_number_registry r
    where r.tenant_id = v_tenant_id and upper(r.invoice_number) = v_number
  ) then
    return query
    select r.source_table, r.source_id, r.invoice_number, r.invoice_type, r.tenant_id,
      false, r.issued_at::date,
      case when r.source_table = 'sales_documents'
        then '/sales/invoices/' || r.source_id::text
        else '/insurance/accounting?invoice=' || r.source_id::text end,
      false
    from public.invoice_number_registry r
    where r.tenant_id = v_tenant_id and upper(r.invoice_number) = v_number;
    return;
  end if;

  return query
  with historical as (
    select 'sales_documents'::text source_type, sd.id source_id, sd.doc_number invoice_number,
      'cash'::text invoice_type, sd.tenant_id, sd.date invoice_date,
      '/sales/invoices/' || sd.id::text route
    from public.sales_documents sd
    where sd.tenant_id = v_tenant_id and sd.doc_type = 'invoice'
      and upper(btrim(sd.doc_number)) = v_number
    union all
    select 'insurance_invoices', ii.id, ii.invoice_number, 'insurance', ii.tenant_id,
      coalesce(ii.invoice_date, ii.issued_at::date, ii.created_at::date),
      '/insurance/accounting?invoice=' || ii.id::text
    from public.insurance_invoices ii
    where ii.tenant_id = v_tenant_id and upper(btrim(ii.invoice_number)) = v_number
    union all
    select 'invoices', i.id, i.invoice_number, 'legacy', i.tenant_id, i.created_at::date,
      '/work-orders/' || i.job_order_id::text
    from public.invoices i
    where i.tenant_id = v_tenant_id and upper(btrim(i.invoice_number)) = v_number
  ), counted as (
    select h.*, count(*) over () > 1 as is_ambiguous from historical h
  )
  select c.source_type, c.source_id, c.invoice_number, c.invoice_type, c.tenant_id,
    true, c.invoice_date, c.route, c.is_ambiguous
  from counted c
  order by c.invoice_date desc nulls last, c.source_type, c.source_id;
end;
$$;

revoke all on function public.find_unified_invoice_number(text) from public, anon;
grant execute on function public.find_unified_invoice_number(text) to authenticated, service_role;

comment on table public.invoices is
  'Legacy / dormant customer invoice source. Do not use for new invoices. If reactivated, official issuance must use the unified invoice allocator.';
comment on function public.activate_unified_invoice_numbering(smallint,bigint,smallint) is
  'Per-tenant cutover with historical maximum guard. Never renumbers historical invoices.';
comment on function public.find_unified_invoice_number(text) is
  'Tenant-isolated lookup: unified registry first, then historical sales, insurance and dormant legacy invoice sources.';
