-- Complete the safety checks for the pre-cutover numeric insurance path.
-- No existing invoice is changed by this migration.
create or replace function public.guard_historical_insurance_number_window()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_date date;
begin
  if old.invoice_number ~ '^[0-9]+$'
     and new.invoice_number is distinct from old.invoice_number then
    if auth.uid() is null
       or public.get_user_role()::text is distinct from 'admin'
       or old.tenant_id is distinct from public.get_user_tenant_id() then
      raise exception 'INVOICE_NUMBER_CORRECTION_PERMISSION_DENIED'
        using errcode = '42501';
    end if;
    if not exists (
      select 1 from public.invoice_numbering_settings s
      where s.tenant_id = old.tenant_id
        and s.correction_enabled_until > clock_timestamp()
    ) then
      raise exception 'INVOICE_NUMBER_CORRECTION_WINDOW_CLOSED'
        using errcode = '55000';
    end if;
    if lower(coalesce(old.status, '')) not in ('issued','partial','paid','overdue')
       or old.pdf_url is not null then
      raise exception 'INVOICE_NUMBER_CORRECTION_FINALIZED'
        using errcode = '55000';
    end if;
    if exists (
      select 1 from public.accounting_source_links l
      where l.tenant_id = old.tenant_id and l.source_id = old.id
    ) then
      raise exception 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED'
        using errcode = '55000';
    end if;
    v_date := coalesce(old.invoice_date, old.issued_at::date, old.created_at::date);
    if exists (
      select 1 from public.accounting_periods ap
      where ap.tenant_id = old.tenant_id and ap.status in ('closed','locked')
        and v_date between ap.start_date and ap.end_date
    ) then
      raise exception 'INVOICE_NUMBER_CORRECTION_PERIOD_CLOSED'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
