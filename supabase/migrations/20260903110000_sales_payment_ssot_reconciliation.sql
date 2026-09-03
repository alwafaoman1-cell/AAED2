-- Make sales_payments the only source of truth for cash-invoice payments.
-- Also provides an explicit, tenant-scoped repair path for legacy payments
-- that exist only inside sales_documents.metadata and therefore have no
-- receipt row to delete.

create or replace function public.delete_sales_payment_or_reconcile(
  p_document_id uuid,
  p_payment_reference text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_payment_id uuid;
  v_invoice public.sales_documents%rowtype;
  v_entry_id uuid;
  v_deleted integer := 0;
  v_reversed integer := 0;
  v_paid numeric := 0;
  v_last_payment_date timestamptz;
begin
  if v_tenant_id is null
     or lower(coalesce(public.get_user_role()::text, '')) not in ('admin', 'manager') then
    raise exception 'SALES_PAYMENT_DELETE_PERMISSION_DENIED';
  end if;

  select d.*
    into v_invoice
    from public.sales_documents d
   where d.id = p_document_id
     and d.tenant_id = v_tenant_id
   for update;
  if not found then
    raise exception 'SALES_DOCUMENT_NOT_FOUND';
  end if;

  if coalesce(p_payment_reference, '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    v_payment_id := p_payment_reference::uuid;
  end if;

  if v_payment_id is not null then
    -- Posted accounting records remain immutable. Reverse the payment entry
    -- before deleting its operational source row.
    for v_entry_id in
      select distinct e.id
        from public.accounting_source_links l
        join public.accounting_journal_entries e
          on e.tenant_id = l.tenant_id
         and e.id = l.journal_entry_id
       where l.tenant_id = v_tenant_id
         and l.source_type = 'sales_payment'
         and l.source_id = v_payment_id
         and l.is_primary
         and e.status = 'posted'
    loop
      perform public.reverse_accounting_journal_entry(
        v_entry_id,
        current_date,
        'Sales payment deleted from invoice'
      );
      v_reversed := v_reversed + 1;
    end loop;

    delete from public.accounting_receipts r
     where r.tenant_id = v_tenant_id
       and r.payment_id = v_payment_id;

    delete from public.sales_payments p
     where p.tenant_id = v_tenant_id
       and p.sales_document_id = p_document_id
       and p.id = v_payment_id;
    get diagnostics v_deleted = row_count;
  end if;

  select coalesce(sum(p.amount), 0), max(p.date::timestamptz)
    into v_paid, v_last_payment_date
    from public.sales_payments p
   where p.tenant_id = v_tenant_id
     and p.sales_document_id = p_document_id;

  update public.sales_documents d
     set metadata = jsonb_set(coalesce(d.metadata, '{}'::jsonb), '{payments}', '[]'::jsonb, true),
         paid_amount = v_paid,
         balance_due = greatest(coalesce(d.total, 0) - v_paid, 0),
         last_payment_date = v_last_payment_date,
         status = case
           when lower(coalesce(d.status, '')) = 'cancelled' then d.status
           when v_paid >= coalesce(d.total, 0) and coalesce(d.total, 0) > 0 then 'paid'
           when v_paid > 0 then 'partial'
           when lower(coalesce(d.invoice_status, '')) = 'issued' then 'unpaid'
           else d.status
         end,
         updated_at = now()
   where d.id = p_document_id
     and d.tenant_id = v_tenant_id;

  return jsonb_build_object(
    'document_id', p_document_id,
    'payment_deleted', v_deleted > 0,
    'legacy_metadata_reconciled', v_deleted = 0,
    'reversed_entries', v_reversed,
    'paid_amount', v_paid,
    'balance_due', greatest(coalesce(v_invoice.total, 0) - v_paid, 0)
  );
end;
$$;

revoke all on function public.delete_sales_payment_or_reconcile(uuid, text)
  from public, anon;
grant execute on function public.delete_sales_payment_or_reconcile(uuid, text)
  to authenticated;

comment on function public.delete_sales_payment_or_reconcile(uuid, text) is
  'Atomically deletes an actual sales payment or removes a legacy metadata-only ghost payment, then recalculates the invoice from sales_payments.';
