-- Temporary, admin-only correction window for issued cash and insurance invoice
-- numbers. This migration changes no existing number and leaves issuance counters
-- untouched. Corrections are atomic and keep every retired number searchable.
alter table public.invoice_numbering_settings
  add column if not exists correction_enabled_until timestamptz;

create table if not exists public.invoice_number_correction_access_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  action text not null check (action in ('enabled', 'disabled')),
  enabled_until timestamptz,
  reason text not null check (length(btrim(reason)) >= 4),
  changed_by uuid not null,
  changed_at timestamptz not null default clock_timestamp()
);
create index if not exists invoice_number_correction_access_audit_tenant_at
  on public.invoice_number_correction_access_audit (tenant_id, changed_at desc);
alter table public.invoice_number_correction_access_audit enable row level security;
revoke all on public.invoice_number_correction_access_audit from public, anon, authenticated;
grant select on public.invoice_number_correction_access_audit to authenticated;
grant all on public.invoice_number_correction_access_audit to service_role;
create policy invoice_number_correction_access_admin_read
  on public.invoice_number_correction_access_audit for select to authenticated
  using (tenant_id = public.get_user_tenant_id()
    and public.get_user_role()::text = 'admin');

create or replace function public.set_invoice_number_correction_window(
  p_minutes integer, p_reason text
) returns timestamptz
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_until timestamptz;
  v_reason text := btrim(coalesce(p_reason, ''));
begin
  if auth.uid() is null or v_tenant is null
     or public.get_user_role()::text is distinct from 'admin' then
    raise exception 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_minutes is null or p_minutes not between 0 and 60 or length(v_reason) < 4 then
    raise exception 'INVOICE_NUMBER_CORRECTION_WINDOW_INPUT_INVALID' using errcode = '22023';
  end if;
  v_until := case when p_minutes = 0 then null
    else clock_timestamp() + make_interval(mins => p_minutes) end;
  update public.invoice_numbering_settings s
    set correction_enabled_until = v_until, updated_at = clock_timestamp()
    where s.tenant_id = v_tenant;
  if not found then
    raise exception 'INVOICE_NUMBERING_NOT_ACTIVE' using errcode = '55000';
  end if;
  insert into public.invoice_number_correction_access_audit
    (tenant_id, action, enabled_until, reason, changed_by)
  values (v_tenant, case when p_minutes = 0 then 'disabled' else 'enabled' end,
    v_until, v_reason, auth.uid());
  return v_until;
end;
$$;
revoke all on function public.set_invoice_number_correction_window(integer,text)
  from public, anon, authenticated;
grant execute on function public.set_invoice_number_correction_window(integer,text)
  to authenticated;

-- Keep terminal events unique, while permitting a full history of corrections.
alter table public.invoice_number_audit_events
  drop constraint invoice_number_audit_event_once_key;
create unique index invoice_number_audit_event_terminal_once_key
  on public.invoice_number_audit_events (tenant_id, source_table, source_id, event_type)
  where event_type <> 'renumbered';

create or replace function public.audit_unified_invoice_terminal_status()
returns trigger language plpgsql security definer
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
      when lower(coalesce(old.invoice_status, '')) in ('cancelled','canceled','void','reversed','credited')
        then lower(old.invoice_status)
      when lower(coalesce(old.status, '')) in ('cancelled','canceled','void','reversed','credited')
        then lower(old.status)
      else lower(coalesce(old.invoice_status, old.status, '')) end;
    v_new_status := case
      when lower(coalesce(new.invoice_status, '')) in ('cancelled','canceled','void','reversed','credited')
        then lower(new.invoice_status)
      when lower(coalesce(new.status, '')) in ('cancelled','canceled','void','reversed','credited')
        then lower(new.status)
      else lower(coalesce(new.invoice_status, new.status, '')) end;
  else
    v_old_status := lower(coalesce(old.status, ''));
    v_new_status := lower(coalesce(new.status, ''));
  end if;
  if v_new_status = v_old_status then return new; end if;
  v_event_type := case
    when v_new_status in ('cancelled','canceled') then 'cancelled'
    when v_new_status = 'void' then 'void'
    when v_new_status in ('reversed','credited') then 'reversed'
    else null end;
  if v_event_type is null then return new; end if;
  select * into v_registry from public.invoice_number_registry r
  where r.tenant_id = new.tenant_id and r.source_table = tg_table_name
    and r.source_id = new.id;
  if not found then return new; end if;
  insert into public.invoice_number_audit_events
    (tenant_id, registry_id, source_table, source_id, invoice_number,
     event_type, event_at, event_by, details)
  values (new.tenant_id, v_registry.id, tg_table_name, new.id,
    v_registry.invoice_number, v_event_type, clock_timestamp(), auth.uid(),
    jsonb_build_object('previous_status',v_old_status,'new_status',v_new_status))
  on conflict do nothing;
  return new;
end;
$$;

-- The registry is immutable to all ordinary writes. Only the scoped,
-- admin-checked correction RPC below can change its number/sequence fields.
create or replace function public.prevent_invoice_number_registry_mutation()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'UPDATE'
     and auth.uid() is not null
     and public.get_user_role()::text = 'admin'
     and old.tenant_id = public.get_user_tenant_id()
     and current_setting('app.invoice_number_correction_registry_id', true) = old.id::text
     and to_jsonb(new) - 'invoice_number' - 'sequence_number'
       = to_jsonb(old) - 'invoice_number' - 'sequence_number' then
    return new;
  end if;
  raise exception 'official invoice number registry records are immutable' using errcode = '55000';
end;
$$;

create or replace function public.guard_issued_cash_invoice_content()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.doc_type = 'invoice'
     and (old.issued_at is not null or old.invoice_status in ('issued','credited'))
     and new.doc_number is distinct from old.doc_number
     and not (
       current_setting('app.invoice_number_correction_source_id', true) = old.id::text
       and auth.uid() is not null
       and public.get_user_role()::text = 'admin'
       and old.tenant_id = public.get_user_tenant_id()
     ) then
    raise exception 'ISSUED_CASH_INVOICE_NUMBER_IMMUTABLE' using errcode = '42501';
  end if;
  if old.doc_type = 'invoice'
     and (old.invoice_status in ('issued','credited') or old.issued_at is not null)
     and current_setting('app.issued_cash_invoice_revision', true) is distinct from 'allowed'
     and (new.issued_at, new.customer_id, new.customer_name, new.customer_phone,
          new.date, new.due_date, new.items, new.subtotal, new.discount_total,
          new.tax_total, new.total, new.notes, new.vehicle_plate,
          new.vehicle_make, new.vehicle_model, new.metadata->'customerAddress',
          new.metadata->'customerTaxNo', new.metadata->'currency',
          new.metadata->'terms', new.metadata->'vehicle', new.metadata->'customField',
          new.metadata->'paymentTerms', new.metadata->'headerLines')
       is distinct from
         (old.issued_at, old.customer_id, old.customer_name, old.customer_phone,
          old.date, old.due_date, old.items, old.subtotal, old.discount_total,
          old.tax_total, old.total, old.notes, old.vehicle_plate,
          old.vehicle_make, old.vehicle_model, old.metadata->'customerAddress',
          old.metadata->'customerTaxNo', old.metadata->'currency',
          old.metadata->'terms', old.metadata->'vehicle', old.metadata->'customField',
          old.metadata->'paymentTerms', old.metadata->'headerLines') then
    raise exception 'ISSUED_CASH_INVOICE_REVISION_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

create or replace function public.correct_issued_invoice_number(
  p_source_table text, p_invoice_id uuid, p_expected_old_number text,
  p_new_number text, p_reason text
) returns table (source_table text, source_id uuid, invoice_number text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_settings public.invoice_numbering_settings%rowtype;
  v_registry public.invoice_number_registry%rowtype;
  v_sale public.sales_documents%rowtype;
  v_insurance public.insurance_invoices%rowtype;
  v_old text := upper(btrim(coalesce(p_expected_old_number, '')));
  v_new text := upper(btrim(coalesce(p_new_number, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_year smallint;
  v_sequence bigint;
  v_next bigint;
  v_long_number text;
  v_date date;
  v_saved text;
begin
  if auth.uid() is null or v_tenant is null
     or public.get_user_role()::text is distinct from 'admin' then
    raise exception 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_source_table not in ('sales_documents','insurance_invoices')
     or p_invoice_id is null or v_old = '' or v_new = ''
     or length(v_reason) < 4 then
    raise exception 'INVOICE_NUMBER_CORRECTION_INPUT_REQUIRED' using errcode = '22023';
  end if;

  -- A share lock serializes corrections with closing the temporary window.
  select * into v_settings from public.invoice_numbering_settings s
  where s.tenant_id = v_tenant for share;
  if not found or v_settings.correction_enabled_until is null
     or v_settings.correction_enabled_until <= clock_timestamp() then
    raise exception 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED' using errcode = '55000';
  end if;

  if p_source_table = 'sales_documents' then
    select * into v_sale from public.sales_documents d
      where d.id = p_invoice_id and d.tenant_id = v_tenant for update;
    if not found then raise exception 'INVOICE_NUMBER_CORRECTION_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_sale.doc_type <> 'invoice' or v_sale.invoice_status <> 'issued'
       or v_sale.deleted_at is not null or v_sale.archived_at is not null
       or v_sale.pdf_snapshot_url is not null or v_sale.invoice_hash is not null
       or v_sale.invoice_snapshot_json is not null
       or v_sale.status in ('cancelled','canceled','void','deleted') then
      raise exception 'INVOICE_NUMBER_CORRECTION_FINALIZED' using errcode = '55000';
    end if;
    if upper(btrim(v_sale.doc_number)) is distinct from v_old then
      raise exception 'INVOICE_NUMBER_CHANGED_RELOAD' using errcode = '40001';
    end if;
    v_date := v_sale.date;
  else
    select * into v_insurance from public.insurance_invoices i
      where i.id = p_invoice_id and i.tenant_id = v_tenant for update;
    if not found then raise exception 'INVOICE_NUMBER_CORRECTION_NOT_FOUND' using errcode = 'P0002'; end if;
    if lower(coalesce(v_insurance.status, '')) not in ('issued','partial','paid','overdue') then
      raise exception 'INVOICE_NUMBER_CORRECTION_FINALIZED' using errcode = '55000';
    end if;
    if upper(btrim(v_insurance.invoice_number)) is distinct from v_old then
      raise exception 'INVOICE_NUMBER_CHANGED_RELOAD' using errcode = '40001';
    end if;
    v_date := coalesce(v_insurance.invoice_date, v_insurance.issued_at::date,
      v_insurance.created_at::date);
  end if;

  select * into v_registry from public.invoice_number_registry r
    where r.tenant_id = v_tenant and r.source_table = p_source_table
      and r.source_id = p_invoice_id for update;
  if not found or upper(v_registry.invoice_number) is distinct from v_old then
    raise exception 'INVOICE_NUMBER_CHANGED_RELOAD' using errcode = '40001';
  end if;
  v_year := v_registry.invoice_year;
  if extract(year from v_date)::smallint is distinct from v_year then
    raise exception 'INVOICE_NUMBER_YEAR_OR_FORMAT_INVALID' using errcode = '22023';
  end if;
  if v_new !~ ('^' || v_settings.prefix || '-[0-9]{2}-[0-9]{6,12}$')
     or split_part(v_new, '-', 2) <> right(v_year::text, 2) then
    raise exception 'INVOICE_NUMBER_YEAR_OR_FORMAT_INVALID' using errcode = '22023';
  end if;
  v_sequence := split_part(v_new, '-', 3)::bigint;
  if v_sequence < 1 or v_sequence = v_registry.sequence_number
     or v_new <> v_settings.prefix || '-' || right(v_year::text, 2) || '-'
       || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0') then
    raise exception 'INVOICE_NUMBER_CORRECTION_INVALID_TARGET' using errcode = '22023';
  end if;
  v_long_number := v_settings.prefix || '-' || v_year::text || '-'
    || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0');

  select s.next_value into v_next from public.invoice_number_sequences s
    where s.tenant_id = v_tenant and s.invoice_year = v_year for update;
  if not found or v_sequence >= v_next then
    raise exception 'INVOICE_NUMBER_NOT_AN_EARLIER_GAP' using errcode = '22023';
  end if;
  if exists (
    select 1 from public.accounting_source_links l
    join public.accounting_journal_entries e
      on e.tenant_id = l.tenant_id and e.id = l.journal_entry_id
    where l.tenant_id = v_tenant and l.source_id = p_invoice_id
      and l.source_type in ('sales_invoice','insurance_invoice')
      and e.status::text <> 'reversed'
  ) then
    raise exception 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED' using errcode = '55000';
  end if;
  if exists (select 1 from public.accounting_periods ap
    where ap.tenant_id = v_tenant and ap.status in ('closed','locked')
      and v_date between ap.start_date and ap.end_date) then
    raise exception 'INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED' using errcode = '55000';
  end if;

  -- Audit entries reserve retired numbers; the source checks include historical
  -- cash, insurance and legacy invoices, including cancelled rows.
  if exists (select 1 from public.invoice_number_registry r
      where r.tenant_id = v_tenant and (r.invoice_number in (v_new,v_long_number)
        or (r.invoice_year = v_year and r.sequence_number = v_sequence)))
     or exists (select 1 from public.invoice_number_audit_events a
      where a.tenant_id = v_tenant and (upper(a.invoice_number) in (v_new,v_long_number)
        or upper(a.details->>'old_invoice_number') in (v_new,v_long_number)))
     or exists (select 1 from public.sales_documents d
      where d.tenant_id = v_tenant and upper(btrim(d.doc_number)) in (v_new,v_long_number))
     or exists (select 1 from public.insurance_invoices i
      where i.tenant_id = v_tenant and upper(btrim(i.invoice_number)) in (v_new,v_long_number))
     or exists (select 1 from public.invoices i
      where i.tenant_id = v_tenant and upper(btrim(i.invoice_number)) in (v_new,v_long_number)) then
    raise exception 'INVOICE_NUMBER_ALREADY_USED' using errcode = '23505';
  end if;

  perform set_config('app.invoice_number_correction_registry_id', v_registry.id::text, true);
  update public.invoice_number_registry r
    set invoice_number = v_new, sequence_number = v_sequence
    where r.id = v_registry.id and r.tenant_id = v_tenant;
  perform set_config('app.invoice_number_correction_registry_id', '', true);

  if p_source_table = 'sales_documents' then
    perform set_config('app.invoice_number_correction_source_id', p_invoice_id::text, true);
    update public.sales_documents d set doc_number = v_new
      where d.id = p_invoice_id and d.tenant_id = v_tenant
      returning d.doc_number into v_saved;
    perform set_config('app.invoice_number_correction_source_id', '', true);
  else
    update public.insurance_invoices i set invoice_number = v_new
      where i.id = p_invoice_id and i.tenant_id = v_tenant
      returning i.invoice_number into v_saved;
  end if;
  if v_saved is distinct from v_new then
    raise exception 'INVOICE_NUMBER_CORRECTION_NOT_PERSISTED' using errcode = '55000';
  end if;
  insert into public.invoice_number_audit_events
    (tenant_id, registry_id, source_table, source_id, invoice_number,
     event_type, event_by, details)
  values (v_tenant, v_registry.id, p_source_table, p_invoice_id, v_old,
    'renumbered', auth.uid(), jsonb_build_object(
      'old_invoice_number', v_old, 'new_invoice_number', v_new,
      'reason', v_reason, 'correction_mode', 'temporary_admin_window'));
  return query select p_source_table, p_invoice_id, v_saved;
end;
$$;
revoke all on function public.correct_issued_invoice_number(text,uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.correct_issued_invoice_number(text,uuid,text,text,text)
  to authenticated;

comment on function public.correct_issued_invoice_number(text,uuid,text,text,text) is
  'Admin-only correction of an issued cash or insurance invoice to an unused earlier number, inside an audited temporary window. Refuses finalized/accounting-posted invoices.';
