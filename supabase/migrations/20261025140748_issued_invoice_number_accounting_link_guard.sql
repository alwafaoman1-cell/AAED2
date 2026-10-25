-- A financial source may be linked under more than one historic source_type.
-- Guard the official registry row itself, so no correction path can miss one.
-- Even a reversed journal retains a numbered, immutable audit snapshot.
create or replace function public.guard_accounting_linked_invoice_registry_number()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  if new.invoice_number is distinct from old.invoice_number
     and exists (
       select 1 from public.accounting_source_links l
       where l.tenant_id = old.tenant_id and l.source_id = old.source_id
     ) then
    raise exception 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED'
      using errcode = '55000';
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_accounting_linked_invoice_registry_number
  on public.invoice_number_registry;
create trigger trg_guard_accounting_linked_invoice_registry_number
  before update of invoice_number on public.invoice_number_registry
  for each row execute function public.guard_accounting_linked_invoice_registry_number();
revoke all on function public.guard_accounting_linked_invoice_registry_number()
  from public, anon, authenticated;

-- The existing pre-cutover numeric insurance correction must obey the same
-- temporary window. This does not renumber any historical invoice by itself.
create or replace function public.guard_historical_insurance_number_window()
returns trigger language plpgsql security definer
set search_path = public, pg_temp
as $$
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
    if exists (
      select 1 from public.accounting_source_links l
      where l.tenant_id = old.tenant_id and l.source_id = old.id
    ) then
      raise exception 'INVOICE_NUMBER_CORRECTION_ACCOUNTING_POSTED'
        using errcode = '55000';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_guard_historical_insurance_number_window
  on public.insurance_invoices;
create trigger trg_guard_historical_insurance_number_window
  before update of invoice_number on public.insurance_invoices
  for each row execute function public.guard_historical_insurance_number_window();
revoke all on function public.guard_historical_insurance_number_window()
  from public, anon, authenticated;
