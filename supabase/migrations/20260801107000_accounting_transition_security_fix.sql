-- Replace the user-settable transition GUC with a trusted function-owner boundary.
-- Accounting status transitions remain available only through SECURITY DEFINER RPCs.

create or replace function public.accounting_validate_journal_header()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_year public.accounting_fiscal_years%rowtype;
  v_period public.accounting_periods%rowtype;
  v_trusted_transition boolean := current_user in ('postgres', 'supabase_admin');
begin
  select * into v_year
  from public.accounting_fiscal_years
  where id = new.fiscal_year_id and tenant_id = new.tenant_id;
  if not found then
    raise exception 'ACCOUNTING_FISCAL_YEAR_NOT_FOUND';
  end if;

  select * into v_period
  from public.accounting_periods
  where id = new.accounting_period_id and tenant_id = new.tenant_id;
  if not found or v_period.fiscal_year_id <> new.fiscal_year_id then
    raise exception 'ACCOUNTING_PERIOD_YEAR_MISMATCH';
  end if;

  if new.accounting_date not between v_year.start_date and v_year.end_date
     or new.accounting_date not between v_period.start_date and v_period.end_date then
    raise exception 'ACCOUNTING_DATE_OUTSIDE_PERIOD';
  end if;

  if tg_op = 'INSERT' then
    if new.status <> 'draft' then
      raise exception 'ACCOUNTING_DIRECT_NON_DRAFT_INSERT_FORBIDDEN';
    end if;
  else
    if old.tenant_id <> new.tenant_id then
      raise exception 'ACCOUNTING_TENANT_IMMUTABLE';
    end if;
    if old.status in ('posted', 'reversed', 'void') and not v_trusted_transition then
      raise exception 'ACCOUNTING_POSTED_ENTRY_IMMUTABLE';
    end if;
    if old.status <> new.status and not v_trusted_transition then
      raise exception 'ACCOUNTING_STATUS_TRANSITION_REQUIRES_RPC';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.accounting_validate_journal_header()
  from public, anon, authenticated;
