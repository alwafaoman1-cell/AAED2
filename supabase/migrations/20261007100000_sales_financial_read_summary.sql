-- Read-only cash-sales summary. Never copies invoice lines or payment records
-- into the browser and never includes insurance invoices.
create or replace function public.list_sales_documents_page_rpc(
  p_tenant_id uuid,
  p_doc_type text,
  p_page integer default 1,
  p_page_size integer default 30,
  p_status text default 'all',
  p_search text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with permitted as materialized (
  select p_tenant_id tenant_id
  where auth.uid() is not null
    and p_tenant_id = public.get_user_tenant_id()
), filtered as not materialized (
  select d.id, d.doc_number, d.doc_type, d.status, d.date, d.created_at,
    d.customer_name, d.customer_phone,
    d.metadata->>'customerAddress' customer_address,
    d.metadata->>'customerTaxNo' customer_tax_no,
    d.subtotal, d.tax_total, d.total, d.paid_amount, d.balance_due,
    d.last_payment_date
  from public.sales_documents d
  join permitted p on p.tenant_id = d.tenant_id
  where d.doc_type = p_doc_type
    and d.deleted_at is null
    and coalesce(d.metadata->>'isDeleted', 'false') <> 'true'
    and (coalesce(p_status, 'all') = 'all' or d.status = p_status)
    and (nullif(trim(p_search), '') is null or concat_ws(' ', d.doc_number,
      d.customer_name, d.customer_phone, d.metadata->>'customerTaxNo')
      ilike '%' || trim(p_search) || '%')
), page_rows as (
  select * from filtered order by doc_number desc nulls last, created_at desc, id desc
  limit least(greatest(coalesce(p_page_size, 30), 1), 100)
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 30), 1), 100)
)
select jsonb_build_object(
  'totalCount', (select count(*) from filtered),
  'items', coalesce((select jsonb_agg(to_jsonb(row) order by row.doc_number desc nulls last,
    row.created_at desc, row.id desc) from page_rows row), '[]'::jsonb)
);
$$;

revoke all on function public.list_sales_documents_page_rpc(uuid, text, integer, integer, text, text) from public, anon;
grant execute on function public.list_sales_documents_page_rpc(uuid, text, integer, integer, text, text) to authenticated;

create or replace function public.sales_financial_read_summary_rpc(
  p_tenant_id uuid,
  p_from date default null,
  p_to date default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with permitted as materialized (
  select p_tenant_id tenant_id
  where auth.uid() is not null
    and p_tenant_id = public.get_user_tenant_id()
), eligible as materialized (
  select d.date, d.subtotal, d.tax_total, d.total, d.paid_amount, d.balance_due
  from public.sales_documents d
  join permitted p on p.tenant_id = d.tenant_id
  where d.doc_type = 'invoice'
    and d.deleted_at is null
    and coalesce(d.metadata->>'isDeleted', 'false') <> 'true'
    and d.status not in ('draft', 'cancelled')
    and (p_from is null or d.date >= p_from)
    and (p_to is null or d.date <= p_to)
), totals as (
  select count(*) invoice_count,
    coalesce(sum(subtotal), 0) revenue,
    coalesce(sum(tax_total), 0) vat,
    coalesce(sum(total), 0) invoice_total,
    coalesce(sum(paid_amount), 0) paid,
    coalesce(sum(greatest(balance_due, 0)), 0) outstanding,
    count(*) filter (where balance_due > 0.001) unpaid_count,
    coalesce(sum(total) filter (where date = current_date), 0) today_total,
    coalesce(sum(total) filter (where date >= date_trunc('month', current_date)::date
      and date < (date_trunc('month', current_date) + interval '1 month')::date), 0) current_month_total,
    coalesce(sum(tax_total) filter (where date >= date_trunc('month', current_date)::date
      and date < (date_trunc('month', current_date) + interval '1 month')::date), 0) current_month_vat
  from eligible
), monthly as (
  select to_char(date_trunc('month', date), 'YYYY-MM') as "month",
    sum(subtotal) revenue, sum(tax_total) vat, sum(total) total,
    sum(paid_amount) paid, sum(greatest(balance_due, 0)) outstanding
  from eligible
  group by 1
)
select jsonb_build_object(
  'invoiceCount', invoice_count,
  'revenue', revenue,
  'vat', vat,
  'invoiceTotal', invoice_total,
  'paid', paid,
  'outstanding', outstanding,
  'unpaidCount', unpaid_count,
  'todayTotal', today_total,
  'currentMonthTotal', current_month_total,
  'currentMonthVat', current_month_vat,
  'monthly', coalesce((select jsonb_agg(to_jsonb(m) order by m."month") from monthly m), '[]'::jsonb)
)
from totals;
$$;

revoke all on function public.sales_financial_read_summary_rpc(uuid, date, date) from public, anon;
grant execute on function public.sales_financial_read_summary_rpc(uuid, date, date) to authenticated;

-- Customer receipts are paged independently of invoices. Invoice/payment
-- deletion triggers remain authoritative; this is a read-only projection.
create or replace function public.list_cash_sales_payments_page_rpc(
  p_tenant_id uuid,
  p_page integer default 1,
  p_page_size integer default 30,
  p_search text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with permitted as materialized (
  select p_tenant_id tenant_id
  where auth.uid() is not null
    and p_tenant_id = public.get_user_tenant_id()
), filtered as not materialized (
  select p.id, p.date, p.amount, p.method,
    d.id invoice_id, d.doc_number invoice_number, d.customer_name customer_name
  from public.sales_payments p
  join permitted a on a.tenant_id = p.tenant_id
  join public.sales_documents d on d.id = p.sales_document_id and d.tenant_id = p.tenant_id
  where d.doc_type = 'invoice'
    and d.deleted_at is null
    and coalesce(d.metadata->>'isDeleted', 'false') <> 'true'
    and (nullif(trim(p_search), '') is null or concat_ws(' ', p.method, p.reference,
      d.doc_number, d.customer_name) ilike '%' || trim(p_search) || '%')
), page_rows as (
  select * from filtered order by date desc, id desc
  limit least(greatest(coalesce(p_page_size, 30), 1), 100)
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 30), 1), 100)
)
select jsonb_build_object(
  'totalCount', (select count(*) from filtered),
  'items', coalesce((select jsonb_agg(to_jsonb(row) order by row.date desc, row.id desc)
    from page_rows row), '[]'::jsonb)
);
$$;

revoke all on function public.list_cash_sales_payments_page_rpc(uuid, integer, integer, text) from public, anon;
grant execute on function public.list_cash_sales_payments_page_rpc(uuid, integer, integer, text) to authenticated;

create index if not exists sales_documents_tenant_type_date_active_idx
on public.sales_documents (tenant_id, doc_type, date desc)
where deleted_at is null;

create index if not exists sales_documents_tenant_type_number_active_idx
on public.sales_documents (tenant_id, doc_type, doc_number desc, created_at desc, id desc)
where deleted_at is null;

create index if not exists sales_payments_tenant_date_page_idx
on public.sales_payments (tenant_id, date desc, id desc);
