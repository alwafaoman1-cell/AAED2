-- Keep cash-sales invoice collection summaries derived exclusively from
-- public.sales_payments after INSERT, UPDATE, and DELETE.

create or replace function public.refresh_sales_doc_last_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_doc uuid := coalesce(new.sales_document_id, old.sales_document_id);
  v_paid numeric := 0;
  v_last timestamptz;
begin
  if v_doc is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(p.amount), 0), max(p.date::timestamptz)
    into v_paid, v_last
    from public.sales_payments p
   where p.sales_document_id = v_doc;

  update public.sales_documents d
     set paid_amount = v_paid,
         balance_due = greatest(coalesce(d.total, 0) - v_paid, 0),
         last_payment_date = v_last,
         metadata = jsonb_set(coalesce(d.metadata, '{}'::jsonb), '{payments}', '[]'::jsonb, true),
         status = case
           when lower(coalesce(d.status, '')) = 'cancelled' then d.status
           when d.doc_type <> 'invoice' then d.status
           when v_paid >= coalesce(d.total, 0) and coalesce(d.total, 0) > 0 then 'paid'
           when v_paid > 0 then 'partial'
           when lower(coalesce(d.invoice_status, '')) = 'issued' then 'unpaid'
           else 'draft'
         end,
         updated_at = now()
   where d.id = v_doc;

  return coalesce(new, old);
end;
$$;

revoke all on function public.refresh_sales_doc_last_payment()
  from public, anon, authenticated;

comment on function public.refresh_sales_doc_last_payment() is
  'Recalculates cash-sales invoice paid amount, balance, and collection status exclusively from sales_payments.';

create or replace function public.enforce_sales_invoice_payment_summary()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_paid numeric := 0;
begin
  if new.doc_type <> 'invoice' or lower(coalesce(new.status, '')) = 'cancelled' then
    return new;
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid
    from public.sales_payments p
   where p.sales_document_id = new.id;

  new.paid_amount := v_paid;
  new.balance_due := greatest(coalesce(new.total, 0) - v_paid, 0);
  new.status := case
    when v_paid >= coalesce(new.total, 0) and coalesce(new.total, 0) > 0 then 'paid'
    when v_paid > 0 then 'partial'
    when lower(coalesce(new.invoice_status, '')) = 'issued' then 'unpaid'
    else 'draft'
  end;
  return new;
end;
$$;

revoke all on function public.enforce_sales_invoice_payment_summary()
  from public, anon, authenticated;

drop trigger if exists trg_enforce_sales_invoice_payment_summary_insert
  on public.sales_documents;
create trigger trg_enforce_sales_invoice_payment_summary_insert
before insert on public.sales_documents
for each row execute function public.enforce_sales_invoice_payment_summary();

drop trigger if exists trg_enforce_sales_invoice_payment_summary_update
  on public.sales_documents;
create trigger trg_enforce_sales_invoice_payment_summary_update
before update of total, paid_amount, balance_due, status, invoice_status
on public.sales_documents
for each row execute function public.enforce_sales_invoice_payment_summary();

comment on function public.enforce_sales_invoice_payment_summary() is
  'Prevents stale client writes from marking a cash-sales invoice paid without authoritative sales_payments rows.';
