-- Keep receipt vouchers consistent with their source invoices.
-- Receipt screens are projections of sales_payments and claim_payments, so an
-- invoice deletion must remove only the payments explicitly linked to it.

create or replace function public.cleanup_deleted_invoice_receipts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_table_name = 'insurance_invoices' then
    delete from public.accounting_receipts
     where tenant_id = old.tenant_id
       and (
         invoice_id = old.id
         or payment_id in (
           select id from public.claim_payments
            where tenant_id = old.tenant_id
              and offset_against_invoice_id = old.id
         )
       );

    delete from public.claim_payments
     where tenant_id = old.tenant_id
       and offset_against_invoice_id = old.id;
  elsif tg_table_name = 'sales_documents' then
    delete from public.accounting_receipts
     where tenant_id = old.tenant_id
       and (
         invoice_id = old.id
         or payment_id in (
           select id from public.sales_payments
            where tenant_id = old.tenant_id
              and sales_document_id = old.id
         )
       );
    -- sales_payments has ON DELETE CASCADE, retained here for schema-drift safety.
    delete from public.sales_payments
     where tenant_id = old.tenant_id
       and sales_document_id = old.id;
  end if;
  return old;
end;
$$;

revoke all on function public.cleanup_deleted_invoice_receipts() from public, anon, authenticated;

drop trigger if exists trg_cleanup_insurance_invoice_receipts on public.insurance_invoices;
create trigger trg_cleanup_insurance_invoice_receipts
before delete on public.insurance_invoices
for each row execute function public.cleanup_deleted_invoice_receipts();

drop trigger if exists trg_cleanup_sales_invoice_receipts on public.sales_documents;
create trigger trg_cleanup_sales_invoice_receipts
before delete on public.sales_documents
for each row execute function public.cleanup_deleted_invoice_receipts();

create or replace function public.cleanup_soft_deleted_sales_invoice_receipts()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  was_deleted boolean := coalesce((old.metadata ->> 'isDeleted')::boolean, false);
  is_deleted boolean := coalesce((new.metadata ->> 'isDeleted')::boolean, false);
begin
  if new.doc_type = 'invoice' and is_deleted and not was_deleted then
    delete from public.accounting_receipts
     where tenant_id = new.tenant_id
       and (
         invoice_id = new.id
         or payment_id in (
           select id from public.sales_payments
            where tenant_id = new.tenant_id
              and sales_document_id = new.id
         )
       );
    delete from public.sales_payments
     where tenant_id = new.tenant_id
       and sales_document_id = new.id;
  end if;
  return new;
end;
$$;

revoke all on function public.cleanup_soft_deleted_sales_invoice_receipts() from public, anon, authenticated;

drop trigger if exists trg_cleanup_soft_deleted_sales_invoice_receipts on public.sales_documents;
create trigger trg_cleanup_soft_deleted_sales_invoice_receipts
after update of status, metadata on public.sales_documents
for each row execute function public.cleanup_soft_deleted_sales_invoice_receipts();

-- Safely link historical claim payments only when the claim has exactly one
-- invoice. Ambiguous multi-invoice claims are intentionally left untouched.
with single_invoice_claims as (
  select tenant_id, claim_id, (array_agg(id))[1] as invoice_id
    from public.insurance_invoices
   group by tenant_id, claim_id
  having count(*) = 1
)
update public.claim_payments payment
   set offset_against_invoice_id = source.invoice_id
  from single_invoice_claims source
 where payment.tenant_id = source.tenant_id
   and payment.claim_id = source.claim_id
   and payment.offset_against_invoice_id is null;

create index if not exists idx_claim_payments_invoice_link
  on public.claim_payments (tenant_id, offset_against_invoice_id)
  where offset_against_invoice_id is not null;
