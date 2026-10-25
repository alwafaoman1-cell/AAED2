-- A pre-cutover numeric invoice reserves its own year/sequence even before
-- its format is corrected. Never let another issued invoice take that slot.
create or replace function public.guard_legacy_numeric_invoice_reservation()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.invoice_number is not distinct from old.invoice_number then
    return new;
  end if;
  if exists (
    select 1 from public.insurance_invoices i
    where i.tenant_id = old.tenant_id and i.id <> old.source_id
      and btrim(i.invoice_number) ~ '^[0-9]{1,12}$'
      and ltrim(btrim(i.invoice_number), '0') <> ''
      and ltrim(btrim(i.invoice_number), '0')::bigint = new.sequence_number
      and extract(year from coalesce(i.invoice_date,
        i.issued_at::date, i.created_at::date)) = new.invoice_year
  ) or exists (
    select 1 from public.sales_documents d
    where d.tenant_id = old.tenant_id and d.id <> old.source_id
      and d.doc_type = 'invoice'
      and btrim(d.doc_number) ~ '^[0-9]{1,12}$'
      and ltrim(btrim(d.doc_number), '0') <> ''
      and ltrim(btrim(d.doc_number), '0')::bigint = new.sequence_number
      and extract(year from coalesce(d.date, d.issued_at::date,
        d.created_at::date)) = new.invoice_year
  ) or exists (
    select 1 from public.invoices i
    where i.tenant_id = old.tenant_id and i.id <> old.source_id
      and btrim(i.invoice_number) ~ '^[0-9]{1,12}$'
      and ltrim(btrim(i.invoice_number), '0') <> ''
      and ltrim(btrim(i.invoice_number), '0')::bigint = new.sequence_number
      and extract(year from i.created_at) = new.invoice_year
  ) then
    raise exception 'INVOICE_NUMBER_ALREADY_USED' using errcode = '23505';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_legacy_numeric_invoice_reservation
  on public.invoice_number_registry;
create trigger trg_guard_legacy_numeric_invoice_reservation
  before update of invoice_number on public.invoice_number_registry
  for each row execute function public.guard_legacy_numeric_invoice_reservation();
revoke all on function public.guard_legacy_numeric_invoice_reservation()
  from public, anon, authenticated;
