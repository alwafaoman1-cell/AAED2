-- A new cash invoice may consume an unused earlier number in the active
-- tenant/year series. The sequence counter and existing invoices are untouched.
-- No historical data is backfilled by this migration.
create or replace function public.issue_sales_document_invoice_with_number(
  p_source_id uuid,
  p_issue_date date,
  p_requested_number text
)
returns table (source_id uuid, invoice_number text, issued_at timestamptz, invoice_status text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_role text := public.get_user_role()::text;
  v_row public.sales_documents%rowtype;
  v_settings public.invoice_numbering_settings%rowtype;
  v_registry public.invoice_number_registry%rowtype;
  v_requested text := upper(btrim(coalesce(p_requested_number, '')));
  v_year smallint;
  v_sequence bigint;
  v_next_value bigint;
  v_long_number text;
  v_issued_at timestamptz := clock_timestamp();
begin
  if auth.uid() is null or v_tenant_id is null or v_role not in ('admin', 'manager') then
    raise exception 'MANUAL_INVOICE_NUMBER_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_source_id is null or p_issue_date is null or v_requested = '' then
    raise exception 'MANUAL_INVOICE_NUMBER_INPUT_REQUIRED' using errcode = '22023';
  end if;

  select * into v_row from public.sales_documents
  where id = p_source_id and tenant_id = v_tenant_id for update;
  if not found then raise exception 'SALES_INVOICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_row.doc_type <> 'invoice' then
    raise exception 'MANUAL_NUMBER_CASH_INVOICES_ONLY' using errcode = '22023';
  end if;

  select * into v_registry from public.invoice_number_registry as registry
  where registry.tenant_id = v_tenant_id and registry.source_table = 'sales_documents'
    and registry.source_id = p_source_id;
  if found then
    if v_registry.invoice_number <> v_requested then
      raise exception 'INVOICE_ALREADY_ISSUED_WITH_DIFFERENT_NUMBER' using errcode = '23505';
    end if;
    return query select v_row.id, v_registry.invoice_number, v_row.issued_at, v_row.invoice_status;
    return;
  end if;
  if coalesce(v_row.invoice_status, 'draft') <> 'draft' or v_row.issued_at is not null
     or nullif(btrim(coalesce(v_row.doc_number, '')), '') is not null then
    raise exception 'MANUAL_NUMBER_REQUIRES_UNNUMBERED_DRAFT' using errcode = '55000';
  end if;

  select * into v_settings from public.invoice_numbering_settings
  where tenant_id = v_tenant_id and activated_at <= clock_timestamp();
  if not found or v_row.created_at < v_settings.activated_at then
    raise exception 'MANUAL_NUMBER_REQUIRES_POST_CUTOVER_DRAFT' using errcode = '55000';
  end if;

  v_year := extract(year from p_issue_date)::smallint;
  if v_requested !~ ('^' || v_settings.prefix || '-[0-9]{2}-[0-9]{6,}$')
     or split_part(v_requested, '-', 2) <> right(v_year::text, 2) then
    raise exception 'MANUAL_NUMBER_YEAR_OR_FORMAT_INVALID' using errcode = '22023';
  end if;
  v_sequence := split_part(v_requested, '-', 3)::bigint;
  if v_sequence < 1 or v_requested <> v_settings.prefix || '-' || right(v_year::text, 2)
      || '-' || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0') then
    raise exception 'MANUAL_NUMBER_FORMAT_INVALID' using errcode = '22023';
  end if;
  v_long_number := v_settings.prefix || '-' || v_year::text || '-'
    || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0');

  -- Lock the same year counter used by automatic allocation. A manual number
  -- may only fill a genuine past gap; it never changes next_value.
  select sequence.next_value into v_next_value from public.invoice_number_sequences as sequence
  where sequence.tenant_id = v_tenant_id and sequence.invoice_year = v_year for update;
  if not found or v_sequence >= v_next_value then
    raise exception 'MANUAL_NUMBER_NOT_AN_EARLIER_GAP' using errcode = '22023';
  end if;

  -- Check all customer-invoice sources, including cancelled/deleted rows and
  -- historical aliases. The registry UNIQUE constraints also protect races.
  if exists (select 1 from public.invoice_number_registry as registry
             where registry.tenant_id = v_tenant_id and (registry.invoice_number in (v_requested, v_long_number)
               or (registry.invoice_year = v_year and registry.sequence_number = v_sequence)))
     or exists (select 1 from public.invoice_number_audit_events as audit
                where audit.tenant_id = v_tenant_id and audit.invoice_number in (v_requested, v_long_number))
     or exists (select 1 from public.sales_documents as document
                where document.tenant_id = v_tenant_id and upper(btrim(document.doc_number)) in (v_requested, v_long_number))
     or exists (select 1 from public.insurance_invoices as insurance_invoice
                where insurance_invoice.tenant_id = v_tenant_id and upper(btrim(insurance_invoice.invoice_number)) in (v_requested, v_long_number))
     or exists (select 1 from public.invoices as legacy_invoice
                where legacy_invoice.tenant_id = v_tenant_id and upper(btrim(legacy_invoice.invoice_number)) in (v_requested, v_long_number)) then
    raise exception 'MANUAL_INVOICE_NUMBER_ALREADY_USED' using errcode = '23505';
  end if;

  insert into public.invoice_number_registry (
    tenant_id, invoice_year, sequence_number, invoice_number, invoice_type,
    source_table, source_id, issued_at, issued_by
  ) values (
    v_tenant_id, v_year, v_sequence, v_requested, 'cash',
    'sales_documents', p_source_id, v_issued_at, auth.uid()
  ) returning * into v_registry;

  insert into public.invoice_number_audit_events (
    tenant_id, registry_id, source_table, source_id, invoice_number,
    event_type, event_at, event_by, details
  ) values (
    v_tenant_id, v_registry.id, 'sales_documents', p_source_id, v_requested,
    'allocated', v_issued_at, auth.uid(), '{"allocation_mode":"manual_gap"}'::jsonb
  );

  update public.sales_documents as sd
  set date = p_issue_date,
      invoice_status = 'issued',
      issued_at = v_issued_at,
      issued_by = auth.uid(),
      locked_at = v_issued_at,
      locked_by = auth.uid(),
      status = 'unpaid'
  where sd.id = p_source_id and sd.tenant_id = v_tenant_id
  returning sd.* into v_row;

  return query select v_row.id, v_row.doc_number, v_row.issued_at, v_row.invoice_status;
end;
$$;

revoke all on function public.issue_sales_document_invoice_with_number(uuid,date,text)
  from public, anon, authenticated;
grant execute on function public.issue_sales_document_invoice_with_number(uuid,date,text)
  to authenticated, service_role;
