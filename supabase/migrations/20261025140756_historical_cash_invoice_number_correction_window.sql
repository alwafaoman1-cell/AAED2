-- Correct a pre-cutover numeric cash invoice into the same year/sequence.
-- This is opt-in, admin-only and audited; applying the migration changes no
-- existing invoice or issuance counter.
create or replace function public.correct_historical_cash_invoice_number(
  p_invoice_id uuid, p_expected_old_number text,
  p_new_number text, p_reason text
) returns table (invoice_id uuid, invoice_number text)
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_sale public.sales_documents%rowtype;
  v_settings public.invoice_numbering_settings%rowtype;
  v_registry public.invoice_number_registry%rowtype;
  v_old text := btrim(coalesce(p_expected_old_number, ''));
  v_new text := upper(btrim(coalesce(p_new_number, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_year smallint;
  v_sequence bigint;
  v_next bigint;
  v_long text;
  v_saved text;
begin
  if auth.uid() is null or v_tenant is null
     or public.get_user_role()::text is distinct from 'admin' then
    raise exception 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_invoice_id is null or v_old !~ '^[0-9]{1,12}$'
     or ltrim(v_old, '0') = '' or v_new = '' or length(v_reason) < 4 then
    raise exception 'INVOICE_NUMBER_CORRECTION_INPUT_REQUIRED' using errcode = '22023';
  end if;
  select * into v_settings from public.invoice_numbering_settings s
    where s.tenant_id = v_tenant for share;
  if not found or v_settings.correction_enabled_until is null
     or v_settings.correction_enabled_until <= clock_timestamp() then
    raise exception 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED' using errcode = '55000';
  end if;
  select * into v_sale from public.sales_documents d
    where d.id = p_invoice_id and d.tenant_id = v_tenant for update;
  if not found then raise exception 'INVOICE_NUMBER_CORRECTION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_sale.doc_type <> 'invoice' or v_sale.invoice_status <> 'issued'
     or v_sale.issued_at is null or v_sale.created_at >= v_settings.activated_at
     or v_sale.deleted_at is not null or v_sale.archived_at is not null
     or v_sale.pdf_snapshot_url is not null or v_sale.invoice_hash is not null
     or v_sale.invoice_snapshot_json is not null
     or v_sale.status in ('cancelled','canceled','void','deleted') then
    raise exception 'INVOICE_NUMBER_CORRECTION_FINALIZED' using errcode = '55000';
  end if;
  if btrim(v_sale.doc_number) is distinct from v_old then
    raise exception 'INVOICE_NUMBER_CHANGED_RELOAD' using errcode = '40001';
  end if;
  if exists (select 1 from public.invoice_number_registry r
      where r.tenant_id = v_tenant and r.source_table = 'sales_documents'
        and r.source_id = p_invoice_id) then
    raise exception 'OFFICIAL_INVOICE_NUMBER_IMMUTABLE' using errcode = '55000';
  end if;
  v_year := extract(year from v_sale.date)::smallint;
  v_sequence := ltrim(v_old, '0')::bigint;
  if v_new !~ ('^' || v_settings.prefix || '-[0-9]{2}-[0-9]{6,12}$')
     or v_new <> v_settings.prefix || '-' || right(v_year::text, 2)
       || '-' || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0') then
    raise exception 'INVOICE_NUMBER_MUST_PRESERVE_LEGACY_SEQUENCE' using errcode = '22023';
  end if;
  v_long := v_settings.prefix || '-' || v_year::text || '-'
    || lpad(v_sequence::text, greatest(v_settings.padding, 6), '0');
  select s.next_value into v_next from public.invoice_number_sequences s
    where s.tenant_id = v_tenant and s.invoice_year = v_year for update;
  if not found or v_sequence >= v_next then
    raise exception 'INVOICE_NUMBER_NOT_AN_EARLIER_GAP' using errcode = '22023';
  end if;
  if exists (select 1 from public.accounting_source_links l
      where l.tenant_id = v_tenant and l.source_id = p_invoice_id) then
    raise exception 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED' using errcode = '55000';
  end if;
  if exists (select 1 from public.accounting_periods ap
      where ap.tenant_id = v_tenant and ap.status in ('closed','locked')
        and v_sale.date between ap.start_date and ap.end_date) then
    raise exception 'INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED' using errcode = '55000';
  end if;

  -- The retired bare number must have exactly one source to remain searchable.
  if exists (select 1 from public.sales_documents d where d.tenant_id = v_tenant
      and d.id <> p_invoice_id and d.doc_type = 'invoice'
      and upper(btrim(d.doc_number)) = upper(v_old))
     or exists (select 1 from public.insurance_invoices i where i.tenant_id = v_tenant
      and upper(btrim(i.invoice_number)) = upper(v_old))
     or exists (select 1 from public.invoices i where i.tenant_id = v_tenant
      and upper(btrim(i.invoice_number)) = upper(v_old)) then
    raise exception 'HISTORICAL_INVOICE_NUMBER_AMBIGUOUS' using errcode = '23505';
  end if;
  if exists (select 1 from public.invoice_number_registry r
      where r.tenant_id = v_tenant and (r.invoice_number in (v_new,v_long)
        or (r.invoice_year = v_year and r.sequence_number = v_sequence)))
     or exists (select 1 from public.invoice_number_audit_events a
      where a.tenant_id = v_tenant and (upper(a.invoice_number) in (v_new,v_long)
        or upper(a.details->>'old_invoice_number') in (v_new,v_long)))
     or exists (select 1 from public.sales_documents d
      where d.tenant_id = v_tenant and d.id <> p_invoice_id
        and upper(btrim(d.doc_number)) in (v_new,v_long))
     or exists (select 1 from public.insurance_invoices i
      where i.tenant_id = v_tenant and upper(btrim(i.invoice_number)) in (v_new,v_long))
     or exists (select 1 from public.invoices i
      where i.tenant_id = v_tenant and upper(btrim(i.invoice_number)) in (v_new,v_long)) then
    raise exception 'INVOICE_NUMBER_ALREADY_USED' using errcode = '23505';
  end if;

  insert into public.invoice_number_registry
    (tenant_id, invoice_year, sequence_number, invoice_number, invoice_type,
     source_table, source_id, issued_at, issued_by)
  values (v_tenant, v_year, v_sequence, v_new, 'cash', 'sales_documents',
    p_invoice_id, v_sale.issued_at, auth.uid()) returning * into v_registry;
  perform set_config('app.invoice_number_correction_source_id', p_invoice_id::text, true);
  update public.sales_documents d set doc_number = v_new
    where d.id = p_invoice_id and d.tenant_id = v_tenant
    returning d.doc_number into v_saved;
  perform set_config('app.invoice_number_correction_source_id', '', true);
  if v_saved is distinct from v_new then
    raise exception 'INVOICE_NUMBER_CORRECTION_NOT_PERSISTED' using errcode = '55000';
  end if;
  insert into public.invoice_number_audit_events
    (tenant_id, registry_id, source_table, source_id, invoice_number,
     event_type, event_by, details)
  values
    (v_tenant, v_registry.id, 'sales_documents', p_invoice_id, v_new,
      'allocated', auth.uid(), jsonb_build_object('allocation_mode','historical_correction')),
    (v_tenant, v_registry.id, 'sales_documents', p_invoice_id, v_new,
      'renumbered', auth.uid(), jsonb_build_object('old_invoice_number',v_old,
        'new_invoice_number',v_new,'reason',v_reason));
  return query select p_invoice_id, v_saved;
end;
$$;
revoke all on function public.correct_historical_cash_invoice_number(uuid,text,text,text)
  from public, anon, authenticated;
grant execute on function public.correct_historical_cash_invoice_number(uuid,text,text,text)
  to authenticated;
