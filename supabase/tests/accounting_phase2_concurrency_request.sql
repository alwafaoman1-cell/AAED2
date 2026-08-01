begin;
set local role authenticated;
select set_config('request.jwt.claims','{"sub":"e1000000-0000-4000-8000-000000000011","role":"authenticated"}',true);
select (public.post_accounting_source(
 'sales_invoice','e4400000-0000-4000-8000-000000000001','issue','2026-08-05','phase2-concurrent-same-key'
)).id as journal_entry_id;
commit;
