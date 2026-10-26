-- Issued insurance invoices are financial records. The repository contains a
-- legacy cleanup trigger that would delete linked claim payments/receipts if
-- installed; never permit that path to run. A future void/reversal workflow must
-- preserve the original invoice, its number, and its payment history.
create or replace function public.prevent_insurance_invoice_hard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception using
    errcode = '23514',
    message = 'INSURANCE_INVOICE_HARD_DELETE_FORBIDDEN';
end;
$$;

revoke all on function public.prevent_insurance_invoice_hard_delete()
  from public, anon, authenticated;

-- Name sorts before any legacy receipt-cleanup BEFORE DELETE trigger if present.
-- An exception also rolls back every operation in the transaction.
drop trigger if exists trg_00_guard_insurance_invoice_delete on public.insurance_invoices;
create trigger trg_00_guard_insurance_invoice_delete
before delete on public.insurance_invoices
for each row execute function public.prevent_insurance_invoice_hard_delete();
