begin;

-- Remove an interrupted previous development-only fixture safely.
drop function if exists public.uin_concurrency_issue(uuid, text);
alter table public.invoice_number_registry disable trigger trg_invoice_number_registry_immutable;
delete from public.sales_documents
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and id::text like 'fa100000-0000-4000-8000-%';
delete from public.insurance_invoices
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and id::text like 'fa200000-0000-4000-8000-%';
delete from public.invoice_number_audit_events
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and (source_id::text like 'fa100000-0000-4000-8000-%'
    or source_id::text like 'fa200000-0000-4000-8000-%');
delete from public.invoice_number_registry
where tenant_id = 'fa000000-0000-4000-8000-000000000001'
  and (source_id::text like 'fa100000-0000-4000-8000-%'
    or source_id::text like 'fa200000-0000-4000-8000-%');
delete from public.invoice_number_sequences
where tenant_id = 'fa000000-0000-4000-8000-000000000001';
delete from public.invoice_numbering_settings
where tenant_id = 'fa000000-0000-4000-8000-000000000001';
delete from public.tenants
where id = 'fa000000-0000-4000-8000-000000000001'
  and slug = 'uin-concurrency-runtime';
alter table public.invoice_number_registry enable trigger trg_invoice_number_registry_immutable;

insert into public.tenants(id, name, slug)
values ('fa000000-0000-4000-8000-000000000001', 'Unified Invoice Concurrency', 'uin-concurrency-runtime');

insert into public.invoice_numbering_settings(
  tenant_id, prefix, padding, activated_at, cutover_year, first_sequence
) values (
  'fa000000-0000-4000-8000-000000000001', 'INV', 6, now(), 2026, 140
);
insert into public.invoice_number_sequences(tenant_id, invoice_year, next_value)
values ('fa000000-0000-4000-8000-000000000001', 2026, 140);

insert into public.sales_documents(
  id, tenant_id, doc_number, doc_type, date, subtotal, tax_total, total, status, invoice_status
)
select
  ('fa100000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'fa000000-0000-4000-8000-000000000001', '', 'invoice', '2026-08-23',
  100 + n, (100 + n) * .05, (100 + n) * 1.05, 'draft', 'draft'
from generate_series(1, 10) n;

insert into public.insurance_invoices(
  id, tenant_id, claim_id, invoice_number, insurance_company_name,
  invoice_date, subtotal, vat, total, status
)
select
  ('fa200000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  'fa000000-0000-4000-8000-000000000001',
  ('fa300000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '', 'Concurrency Insurer', '2026-08-23',
  200 + n, (200 + n) * .05, (200 + n) * 1.05, 'draft'
from generate_series(1, 10) n;

create or replace function public.uin_concurrency_issue(p_source_id uuid, p_source_table text)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_number text;
begin
  perform pg_sleep(1);
  if p_source_table = 'sales_documents' then
    update public.sales_documents
    set invoice_status = 'issued', issued_at = '2026-08-23T08:00:00Z', status = 'unpaid'
    where id = p_source_id
    returning doc_number into v_number;
  elsif p_source_table = 'insurance_invoices' then
    update public.insurance_invoices
    set status = 'issued', issued_at = '2026-08-23T08:00:00Z'
    where id = p_source_id
    returning invoice_number into v_number;
  else
    raise exception 'unsupported source';
  end if;
  return v_number;
end;
$$;

revoke all on function public.uin_concurrency_issue(uuid, text) from public, anon, authenticated;

commit;
