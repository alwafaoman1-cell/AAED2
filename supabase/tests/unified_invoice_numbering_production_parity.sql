-- Read-only production cutover snapshot.
-- Run immediately before and after the numbering migrations/activation and
-- compare every hash. This script returns aggregates only and exposes no PII.

with sales as (
  select
    count(*)::bigint as row_count,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'number', doc_number
    )::text, '|' order by id), '')) as numbers_hash,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'subtotal', subtotal,
      'tax', tax_total,
      'total', total,
      'paid', paid_amount,
      'balance', balance_due
    )::text, '|' order by id), '')) as amounts_hash,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'status', status,
      'invoice_status', to_jsonb(sales_documents)->>'invoice_status'
    )::text, '|' order by id), '')) as statuses_hash,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'date', date,
      'due_date', due_date,
      'issued_at', to_jsonb(sales_documents)->>'issued_at',
      'created_at', created_at,
      'updated_at', updated_at
    )::text, '|' order by id), '')) as dates_hash
  from public.sales_documents
  where doc_type = 'invoice'
), insurance as (
  select
    count(*)::bigint as row_count,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'number', invoice_number
    )::text, '|' order by id), '')) as numbers_hash,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'subtotal', subtotal,
      'vat', vat,
      'total', total,
      'paid', paid_amount
    )::text, '|' order by id), '')) as amounts_hash,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'status', status
    )::text, '|' order by id), '')) as statuses_hash,
    md5(coalesce(string_agg(jsonb_build_object(
      'id', id,
      'issued_at', issued_at,
      'due_date', due_date,
      'created_at', created_at,
      'updated_at', updated_at
    )::text, '|' order by id), '')) as dates_hash
  from public.insurance_invoices
)
select jsonb_build_object(
  'customer_invoice_count', sales.row_count + insurance.row_count,
  'sales', to_jsonb(sales),
  'insurance', to_jsonb(insurance)
) as unified_invoice_numbering_parity_snapshot
from sales cross join insurance;
