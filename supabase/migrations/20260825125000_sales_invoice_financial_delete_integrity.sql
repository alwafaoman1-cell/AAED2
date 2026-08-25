-- Keep cash-sales invoice deletion atomic across operational receipts and cloud accounting.
-- Posted accounting entries are reversed (never deleted) before source payments disappear.

create or replace function public.cleanup_sales_invoice_financial_links(
  p_tenant_id uuid,
  p_invoice_id uuid,
  p_reason text default 'Sales invoice deleted'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_entry_id uuid;
  v_payment_ids uuid[] := '{}'::uuid[];
  v_reversed integer := 0;
  v_receipts integer := 0;
  v_payments integer := 0;
begin
  select coalesce(array_agg(p.id), '{}'::uuid[])
    into v_payment_ids
    from public.sales_payments p
   where p.tenant_id = p_tenant_id
     and p.sales_document_id = p_invoice_id;

  -- Reverse customer-payment postings before deleting their operational source rows.
  for v_entry_id in
    select distinct e.id
      from public.accounting_source_links l
      join public.accounting_journal_entries e
        on e.tenant_id = l.tenant_id
       and e.id = l.journal_entry_id
     where l.tenant_id = p_tenant_id
       and l.source_type = 'sales_payment'
       and l.source_id = any(v_payment_ids)
       and l.is_primary
       and e.status = 'posted'
  loop
    perform public.reverse_accounting_journal_entry(
      v_entry_id,
      current_date,
      coalesce(nullif(btrim(p_reason), ''), 'Sales invoice deleted')
    );
    v_reversed := v_reversed + 1;
  end loop;

  -- Reverse the invoice posting itself. The original entry remains in the audit trail.
  for v_entry_id in
    select distinct e.id
      from public.accounting_source_links l
      join public.accounting_journal_entries e
        on e.tenant_id = l.tenant_id
       and e.id = l.journal_entry_id
     where l.tenant_id = p_tenant_id
       and l.source_type in ('sales_invoice', 'cash_invoice')
       and l.source_id = p_invoice_id
       and l.is_primary
       and e.status = 'posted'
  loop
    perform public.reverse_accounting_journal_entry(
      v_entry_id,
      current_date,
      coalesce(nullif(btrim(p_reason), ''), 'Sales invoice deleted')
    );
    v_reversed := v_reversed + 1;
  end loop;

  delete from public.accounting_receipts r
   where r.tenant_id = p_tenant_id
     and (
       r.invoice_id = p_invoice_id
       or r.payment_id = any(v_payment_ids)
     );
  get diagnostics v_receipts = row_count;

  delete from public.sales_payments p
   where p.tenant_id = p_tenant_id
     and p.sales_document_id = p_invoice_id;
  get diagnostics v_payments = row_count;

  return jsonb_build_object(
    'invoice_id', p_invoice_id,
    'reversed_entries', v_reversed,
    'deleted_receipts', v_receipts,
    'deleted_payments', v_payments
  );
end;
$$;

revoke all on function public.cleanup_sales_invoice_financial_links(uuid,uuid,text)
  from public, anon, authenticated;

create or replace function public.cleanup_deleted_sales_invoice_financials()
returns trigger
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_was_deleted boolean := false;
  v_is_deleted boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.doc_type = 'invoice' then
      perform public.cleanup_sales_invoice_financial_links(
        old.tenant_id,
        old.id,
        'Sales invoice hard deleted'
      );
    end if;
    return old;
  end if;

  v_was_deleted := old.deleted_at is not null
    or lower(coalesce(old.metadata ->> 'isDeleted', 'false')) in ('true', '1');
  v_is_deleted := new.deleted_at is not null
    or lower(coalesce(new.metadata ->> 'isDeleted', 'false')) in ('true', '1');

  if new.doc_type = 'invoice' and v_is_deleted and not v_was_deleted then
    perform public.cleanup_sales_invoice_financial_links(
      new.tenant_id,
      new.id,
      'Sales invoice moved to trash'
    );
  end if;
  return new;
end;
$$;

revoke all on function public.cleanup_deleted_sales_invoice_financials()
  from public, anon, authenticated;

drop trigger if exists trg_cleanup_sales_invoice_receipts on public.sales_documents;
drop trigger if exists trg_cleanup_soft_deleted_sales_invoice_receipts on public.sales_documents;
drop trigger if exists trg_cleanup_sales_invoice_financials_delete on public.sales_documents;
drop trigger if exists trg_cleanup_sales_invoice_financials_soft_delete on public.sales_documents;

create trigger trg_cleanup_sales_invoice_financials_delete
before delete on public.sales_documents
for each row execute function public.cleanup_deleted_sales_invoice_financials();

create trigger trg_cleanup_sales_invoice_financials_soft_delete
after update of status, invoice_status, metadata, deleted_at on public.sales_documents
for each row execute function public.cleanup_deleted_sales_invoice_financials();

-- Explicit tenant-scoped repair for invoices already deleted before these triggers existed.
-- It is intentionally not run automatically by this migration.
create or replace function public.repair_deleted_sales_invoice_financials()
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_invoice record;
  v_result jsonb;
  v_invoices integer := 0;
  v_reversed integer := 0;
  v_receipts integer := 0;
  v_payments integer := 0;
begin
  if v_tenant is null
     or lower(coalesce(public.get_user_role()::text, '')) not in ('admin', 'manager') then
    raise exception 'SALES_INVOICE_DELETE_PERMISSION_DENIED';
  end if;

  for v_invoice in
    select d.id
      from public.sales_documents d
     where d.tenant_id = v_tenant
       and d.doc_type = 'invoice'
       and (
         d.deleted_at is not null
         or lower(coalesce(d.metadata ->> 'isDeleted', 'false')) in ('true', '1')
       )
     order by d.created_at, d.id
     for update
  loop
    v_result := public.cleanup_sales_invoice_financial_links(
      v_tenant,
      v_invoice.id,
      'Repair deleted sales invoice financial links'
    );
    v_invoices := v_invoices + 1;
    v_reversed := v_reversed + coalesce((v_result ->> 'reversed_entries')::integer, 0);
    v_receipts := v_receipts + coalesce((v_result ->> 'deleted_receipts')::integer, 0);
    v_payments := v_payments + coalesce((v_result ->> 'deleted_payments')::integer, 0);
  end loop;

  return jsonb_build_object(
    'processed_invoices', v_invoices,
    'reversed_entries', v_reversed,
    'deleted_receipts', v_receipts,
    'deleted_payments', v_payments
  );
end;
$$;

revoke all on function public.repair_deleted_sales_invoice_financials()
  from public, anon;
grant execute on function public.repair_deleted_sales_invoice_financials()
  to authenticated;

comment on function public.repair_deleted_sales_invoice_financials() is
  'Admin/manager repair for receipt and accounting links left behind by explicitly deleted cash-sales invoices.';
