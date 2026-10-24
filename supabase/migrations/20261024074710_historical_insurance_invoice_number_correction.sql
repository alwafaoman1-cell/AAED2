-- Explicit, audited correction of a single pre-cutover numeric insurance
-- invoice number. No invoice is changed by applying this migration.
-- Requires the short-year numbering migration (20260831100000).
create or replace function public.correct_historical_insurance_invoice_number(
  p_invoice_id uuid,
  p_expected_old_number text,
  p_new_number text,
  p_reason text
)
returns table (invoice_id uuid, invoice_number text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_invoice public.insurance_invoices%rowtype;
  v_settings public.invoice_numbering_settings%rowtype;
  v_registry public.invoice_number_registry%rowtype;
  v_requested text := upper(btrim(coalesce(p_new_number, '')));
  v_old_number text := btrim(coalesce(p_expected_old_number, ''));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_year smallint;
  v_sequence bigint;
  v_next_value bigint;
  v_long_number text;
  v_changed_number text;
begin
  if auth.uid() is null or v_tenant_id is null or public.get_user_role()::text <> 'admin' then
    raise exception 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_invoice_id is null or v_old_number = '' or v_requested = '' or length(v_reason) < 4 then
    raise exception 'INVOICE_NUMBER_CORRECTION_INPUT_REQUIRED' using errcode = '22023';
  end if;

  select * into v_invoice from public.insurance_invoices ii
  where ii.id = p_invoice_id and ii.tenant_id = v_tenant_id for update;
  if not found then
    raise exception 'INSURANCE_INVOICE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_invoice.invoice_number is distinct from v_old_number then
    raise exception 'INVOICE_NUMBER_CHANGED_RELOAD' using errcode = '40001';
  end if;

  select * into v_settings from public.invoice_numbering_settings s
  where s.tenant_id = v_tenant_id and s.activated_at <= clock_timestamp() for share;
  if not found or v_invoice.created_at >= v_settings.activated_at
     or v_old_number !~ '^[0-9]+$' or ltrim(v_old_number, '0') = '' then
    raise exception 'ONLY_PRE_CUTOVER_NUMERIC_INSURANCE_INVOICES' using errcode = '55000';
  end if;
  if exists (
    select 1 from public.invoice_number_registry r
    where r.tenant_id = v_tenant_id and r.source_table = 'insurance_invoices'
      and r.source_id = p_invoice_id
  ) then
    raise exception 'OFFICIAL_INVOICE_NUMBER_IMMUTABLE' using errcode = '55000';
  end if;

  v_year := extract(year from coalesce(v_invoice.invoice_date,
    v_invoice.issued_at::date, v_invoice.created_at::date))::smallint;
  if v_requested !~ ('^' || v_settings.prefix || '-[0-9]{2}-[0-9]{6,}$')
     or split_part(v_requested, '-', 2) <> right(v_year::text, 2) then
    raise exception 'INVOICE_NUMBER_YEAR_OR_FORMAT_INVALID' using errcode = '22023';
  end if;
  v_sequence := split_part(v_requested, '-', 3)::bigint;
  if v_sequence < 1
     or v_sequence <> ltrim(v_old_number, '0')::bigint
     or v_requested <> v_settings.prefix || '-' || right(v_year::text, 2) || '-'
       || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0') then
    raise exception 'INVOICE_NUMBER_MUST_PRESERVE_LEGACY_SEQUENCE' using errcode = '22023';
  end if;
  v_long_number := v_settings.prefix || '-' || v_year::text || '-'
    || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0');

  -- Serialize with automatic allocation and other manual-gap operations.
  -- Do not consume or move the active sequence counter.
  select s.next_value into v_next_value from public.invoice_number_sequences s
  where s.tenant_id = v_tenant_id and s.invoice_year = v_year for update;
  if not found or v_sequence >= v_next_value then
    raise exception 'INVOICE_NUMBER_NOT_AN_EARLIER_GAP' using errcode = '22023';
  end if;

  -- An old number must remain an unambiguous lookup alias after correction.
  if exists (select 1 from public.sales_documents sd
             where sd.tenant_id = v_tenant_id and sd.doc_type = 'invoice'
               and upper(btrim(sd.doc_number)) = upper(v_old_number))
     or exists (select 1 from public.insurance_invoices ii
                where ii.tenant_id = v_tenant_id and ii.id <> p_invoice_id
                  and upper(btrim(ii.invoice_number)) = upper(v_old_number))
     or exists (select 1 from public.invoices i
                where i.tenant_id = v_tenant_id
                  and upper(btrim(i.invoice_number)) = upper(v_old_number)) then
    raise exception 'HISTORICAL_INVOICE_NUMBER_AMBIGUOUS' using errcode = '23505';
  end if;

  if exists (select 1 from public.invoice_number_registry r
             where r.tenant_id = v_tenant_id
               and ((r.invoice_year = v_year and r.sequence_number = v_sequence)
                 or r.invoice_number in (v_requested, v_long_number)))
     or exists (select 1 from public.invoice_number_audit_events e
                where e.tenant_id = v_tenant_id
                  and (e.invoice_number in (v_requested, v_long_number)
                    or upper(e.details->>'old_invoice_number') in (v_requested, v_long_number)))
     or exists (select 1 from public.sales_documents sd
                where sd.tenant_id = v_tenant_id and sd.doc_type = 'invoice'
                  and upper(btrim(sd.doc_number)) in (v_requested, v_long_number))
     or exists (select 1 from public.insurance_invoices ii
                where ii.tenant_id = v_tenant_id and ii.id <> p_invoice_id
                  and upper(btrim(ii.invoice_number)) in (v_requested, v_long_number))
     or exists (select 1 from public.invoices i
                where i.tenant_id = v_tenant_id
                  and upper(btrim(i.invoice_number)) in (v_requested, v_long_number)) then
    raise exception 'INVOICE_NUMBER_ALREADY_USED' using errcode = '23505';
  end if;

  insert into public.invoice_number_registry (
    tenant_id, invoice_year, sequence_number, invoice_number, invoice_type,
    source_table, source_id, issued_at, issued_by
  ) values (
    v_tenant_id, v_year, v_sequence, v_requested, 'insurance',
    'insurance_invoices', p_invoice_id,
    coalesce(v_invoice.issued_at, v_invoice.created_at), auth.uid()
  ) returning * into v_registry;

  -- The existing BEFORE trigger now reads this registry row and permits the
  -- corrected number. All statements are one transaction; any failure rolls back.
  update public.insurance_invoices ii set invoice_number = v_requested
  where ii.id = p_invoice_id and ii.tenant_id = v_tenant_id
  returning ii.invoice_number into v_changed_number;
  if v_changed_number is distinct from v_requested then
    raise exception 'INVOICE_NUMBER_CORRECTION_NOT_PERSISTED' using errcode = '55000';
  end if;

  insert into public.invoice_number_audit_events (
    tenant_id, registry_id, source_table, source_id, invoice_number,
    event_type, event_by, details
  ) values
    (v_tenant_id, v_registry.id, 'insurance_invoices', p_invoice_id, v_requested,
      'allocated', auth.uid(), jsonb_build_object('allocation_mode', 'historical_correction')),
    (v_tenant_id, v_registry.id, 'insurance_invoices', p_invoice_id, v_requested,
      'renumbered', auth.uid(), jsonb_build_object(
        'old_invoice_number', v_old_number,
        'new_invoice_number', v_requested,
        'reason', v_reason
      ));

  return query select p_invoice_id, v_changed_number;
end;
$$;

revoke all on function public.correct_historical_insurance_invoice_number(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.correct_historical_insurance_invoice_number(uuid,text,text,text)
  to authenticated;

comment on function public.correct_historical_insurance_invoice_number(uuid,text,text,text) is
  'Admin-only, audited correction of a pre-cutover numeric insurance invoice to its same-sequence short-year number.';

-- Keep the former numeric number searchable after correction, as a historical
-- alias; never return another tenant's invoice.
create or replace function public.find_unified_invoice_number(p_invoice_number text)
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

  -- Prior registry numbers and explicitly corrected legacy numeric numbers
  -- continue to resolve to the current official number.
  if exists (
    select 1 from public.invoice_number_audit_events e
    join public.invoice_number_registry r on r.id = e.registry_id and r.tenant_id = e.tenant_id
    where e.tenant_id = v_tenant_id
      and ((e.event_type = 'allocated' and upper(e.invoice_number) = v_number)
        or (e.event_type = 'renumbered'
          and upper(e.details->>'old_invoice_number') = v_number))
  ) then
    return query
    select distinct r.source_table, r.source_id, r.invoice_number, r.invoice_type, r.tenant_id,
      false, r.issued_at::date,
      case when r.source_table = 'sales_documents'
        then '/sales/invoices/' || r.source_id::text
        else '/insurance/accounting?invoice=' || r.source_id::text end,
      false
    from public.invoice_number_audit_events e
    join public.invoice_number_registry r on r.id = e.registry_id and r.tenant_id = e.tenant_id
    where e.tenant_id = v_tenant_id
      and ((e.event_type = 'allocated' and upper(e.invoice_number) = v_number)
        or (e.event_type = 'renumbered'
          and upper(e.details->>'old_invoice_number') = v_number));
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
