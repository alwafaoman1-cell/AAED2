-- Read-only cutover inventory. Run separately per environment and approve the
-- first unified sequence manually; this query never changes invoice records.
with invoice_numbers as (
  select
    'sales_documents'::text as source,
    tenant_id,
    nullif(btrim(doc_number), '') as invoice_number
  from public.sales_documents
  where doc_type = 'invoice'
  union all
  select
    'insurance_invoices'::text,
    tenant_id,
    nullif(btrim(invoice_number), '')
  from public.insurance_invoices
), classified as (
  select
    source,
    tenant_id,
    invoice_number,
    case
      when invoice_number is null then 'blank/draft'
      when invoice_number ~ '^INV-[0-9]{2}-[0-9]{6,}$' then 'INV-YY-NNNNNN'
      when invoice_number ~ '^INV-[0-9]{4}-[0-9]{6,}$' then 'INV-YYYY-NNNNNN (legacy official)'
      else 'legacy/other'
    end as existing_format,
    case
      when invoice_number ~ '^INV-[0-9]{2}-[0-9]{6,}$'
        then substring(invoice_number from '^INV-[0-9]{2}-([0-9]+)$')::bigint
      when invoice_number ~ '^INV-[0-9]{4}-[0-9]{6,}$'
        then substring(invoice_number from '^INV-[0-9]{4}-([0-9]+)$')::bigint
      else null
    end as relevant_sequence
  from invoice_numbers
)
select
  source,
  tenant_id,
  existing_format,
  count(*) as invoice_count,
  max(relevant_sequence) as highest_relevant_sequence
from classified
group by source, tenant_id, existing_format
order by tenant_id, source, existing_format;
