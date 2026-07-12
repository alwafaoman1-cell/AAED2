-- Insurance invoice visible issue date.
-- Non destructive: keeps issued_at as record issue timestamp and adds invoice_date for accounting/reporting display.

alter table public.insurance_invoices
  add column if not exists invoice_date date;

update public.insurance_invoices
set invoice_date = coalesce(invoice_date, issued_at::date, created_at::date, current_date)
where invoice_date is null;

alter table public.insurance_invoices
  alter column invoice_date set default current_date;

create index if not exists idx_insurance_invoices_invoice_date
  on public.insurance_invoices(tenant_id, invoice_date);
