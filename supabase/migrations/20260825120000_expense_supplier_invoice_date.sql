-- Additive expense document metadata. This does not backfill or reclassify any
-- historical expense and does not alter amount, VAT, work-order, or posting data.
alter table public.expenses
  add column if not exists supplier_invoice_date date;

create index if not exists idx_expenses_tenant_supplier_invoice_date
  on public.expenses (tenant_id, supplier_invoice_date desc)
  where deleted_at is null;

comment on column public.expenses.supplier_invoice_date is
  'Supplier invoice date entered on the expense document; null for legacy rows when unknown.';
