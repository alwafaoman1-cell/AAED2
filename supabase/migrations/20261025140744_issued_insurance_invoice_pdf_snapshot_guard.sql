-- An exported insurance PDF is a finalized record, not a live render.
-- Never allow its printed number to diverge from the database number.
create or replace function public.guard_insurance_invoice_pdf_snapshot_number()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.pdf_url is not null
     and new.invoice_number is distinct from old.invoice_number then
    raise exception 'INVOICE_NUMBER_CORRECTION_FINALIZED' using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_insurance_invoice_pdf_snapshot_number
  on public.insurance_invoices;
create trigger trg_guard_insurance_invoice_pdf_snapshot_number
  before update of invoice_number on public.insurance_invoices
  for each row execute function public.guard_insurance_invoice_pdf_snapshot_number();
revoke all on function public.guard_insurance_invoice_pdf_snapshot_number()
  from public, anon, authenticated;
