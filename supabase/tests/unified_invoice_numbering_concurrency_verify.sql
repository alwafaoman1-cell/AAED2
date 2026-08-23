select jsonb_build_object(
  'total', count(*),
  'unique_numbers', count(distinct invoice_number),
  'minimum', min(invoice_number),
  'maximum', max(invoice_number),
  'duplicates', count(*) - count(distinct invoice_number),
  'missing_sequence_values', 20 - count(distinct sequence_number),
  'cash', count(*) filter (where invoice_type = 'cash'),
  'insurance', count(*) filter (where invoice_type = 'insurance'),
  'next_value', (
    select next_value from public.invoice_number_sequences
    where tenant_id = 'fa000000-0000-4000-8000-000000000001' and invoice_year = 2026
  ),
  'accepted', count(*) = 20
    and count(distinct invoice_number) = 20
    and min(sequence_number) = 140
    and max(sequence_number) = 159
    and count(distinct sequence_number) = 20
    and count(*) filter (where invoice_type = 'cash') = 10
    and count(*) filter (where invoice_type = 'insurance') = 10
    and (select next_value from public.invoice_number_sequences
         where tenant_id = 'fa000000-0000-4000-8000-000000000001' and invoice_year = 2026) = 160
) as unified_invoice_numbering_concurrency
from public.invoice_number_registry
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and invoice_year = 2026;
