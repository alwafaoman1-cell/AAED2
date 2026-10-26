-- A posted historical insurance invoice may acquire its existing sequence's
-- official display format without rewriting the immutable journal snapshot.
-- Applying this migration changes no invoice, payment, journal, or registry row.
-- Applied selectively by Supabase MCP as Development 20261025144615 and
-- Production 20261025145220. Do not run a blanket db push to reconcile them.
create or replace function public.guard_historical_insurance_number_window()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_date date;
  v_has_accounting_link boolean;
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

    select exists (
      select 1 from public.accounting_source_links l
      where l.tenant_id = old.tenant_id and l.source_id = old.id
    ) into v_has_accounting_link;

    if v_has_accounting_link and not (
      -- The audited historical correction RPC inserts this exact registry row
      -- before updating the invoice. Client roles cannot insert registry rows.
      exists (
        select 1 from public.invoice_number_registry r
        where r.tenant_id = old.tenant_id
          and r.source_table = 'insurance_invoices'
          and r.source_id = old.id
          and r.invoice_type = 'insurance'
          and r.invoice_number = new.invoice_number
          and r.invoice_year = extract(year from coalesce(
            old.invoice_date, old.issued_at::date, old.created_at::date))::smallint
          and r.sequence_number = nullif(ltrim(old.invoice_number, '0'), '')::bigint
      )
      -- Every existing link must really be the posted insurance source and
      -- must retain the old number as an immutable accounting snapshot.
      and not exists (
        select 1 from public.accounting_source_links l
        left join public.accounting_journal_entries e
          on e.id = l.journal_entry_id and e.tenant_id = l.tenant_id
        where l.tenant_id = old.tenant_id and l.source_id = old.id
          and (l.source_type is distinct from 'insurance_invoice'
            or l.source_number_snapshot is distinct from old.invoice_number
            or e.status is distinct from 'posted')
      )
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

revoke all on function public.guard_historical_insurance_number_window()
  from public, anon, authenticated;

comment on function public.guard_historical_insurance_number_window() is
  'Allows only audited same-sequence format corrections for posted historical insurance invoices; preserves posted ledger snapshots and all financial values.';
