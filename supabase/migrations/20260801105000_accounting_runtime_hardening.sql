-- Runtime hardening discovered during Phase 1B validation.
-- Non-destructive: strengthens validation and replaces accounting RPCs only.

create or replace function public.accounting_validate_journal_header()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_year public.accounting_fiscal_years%rowtype;
  v_period public.accounting_periods%rowtype;
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
    if old.status in ('posted','reversed','void')
       and coalesce(current_setting('app.accounting_transition', true),'') <> 'on' then
      raise exception 'ACCOUNTING_POSTED_ENTRY_IMMUTABLE';
    end if;
    if old.status <> new.status
       and coalesce(current_setting('app.accounting_transition', true),'') <> 'on' then
      raise exception 'ACCOUNTING_STATUS_TRANSITION_REQUIRES_RPC';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.resolve_accounting_account_mapping(
  p_mapping_key text,
  p_business_type text default null,
  p_department_id uuid default null,
  p_cost_center_id uuid default null,
  p_as_of date default current_date
)
returns uuid
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_account_id uuid;
begin
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null
     or not public.accounting_has_permission('accounting.view_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;

  select m.account_id
    into v_account_id
  from public.accounting_account_mappings m
  join public.accounting_accounts a
    on a.tenant_id = m.tenant_id and a.id = m.account_id
  where m.tenant_id = v_tenant
    and m.mapping_key = p_mapping_key
    and m.status = 'active'
    and a.is_active
    and (m.effective_from is null or m.effective_from <= p_as_of)
    and (m.effective_to is null or m.effective_to >= p_as_of)
    and (m.business_type is null or m.business_type = p_business_type)
    and (m.department_id is null or m.department_id = p_department_id)
    and (m.cost_center_id is null or m.cost_center_id = p_cost_center_id)
  order by
    ((m.business_type is not null)::int
      + (m.department_id is not null)::int
      + (m.cost_center_id is not null)::int) desc,
    m.priority asc,
    m.created_at asc
  limit 1;

  if v_account_id is null then
    raise exception 'ACCOUNTING_MAPPING_NOT_FOUND';
  end if;
  return v_account_id;
end;
$$;

create or replace function public.reverse_accounting_journal_entry(
  p_entry_id uuid,
  p_reversal_date date,
  p_reason text
)
returns public.accounting_journal_entries
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_original public.accounting_journal_entries%rowtype;
  v_reversal public.accounting_journal_entries%rowtype;
  v_period uuid;
  v_number text;
begin
  if not public.accounting_has_permission('accounting.reverse_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then
    raise exception 'ACCOUNTING_REVERSAL_REASON_REQUIRED';
  end if;

  select * into v_original
  from public.accounting_journal_entries
  where id = p_entry_id
    and tenant_id = public.get_user_tenant_id()
    and status = 'posted'
  for update;
  if not found then
    raise exception 'ACCOUNTING_POSTED_ENTRY_NOT_FOUND';
  end if;
  if exists (
    select 1
    from public.accounting_journal_entries r
    where r.reversed_entry_id = v_original.id
      and r.tenant_id = v_original.tenant_id
      and r.status = 'posted'
  ) then
    raise exception 'ACCOUNTING_ENTRY_ALREADY_REVERSED';
  end if;

  select id into v_period
  from public.accounting_periods
  where tenant_id = v_original.tenant_id
    and fiscal_year_id = v_original.fiscal_year_id
    and status = 'open'
    and p_reversal_date between start_date and end_date;
  if v_period is null then
    raise exception 'ACCOUNTING_REVERSAL_PERIOD_NOT_OPEN';
  end if;

  v_number := public.next_accounting_journal_number(v_original.fiscal_year_id);
  insert into public.accounting_journal_entries(
    tenant_id, entry_number, accounting_date, document_date,
    fiscal_year_id, accounting_period_id, entry_type,
    description_ar, description_en, reference, currency, exchange_rate,
    status, source_type, source_identifier, reversed_entry_id,
    reversal_reason, created_by
  ) values (
    v_original.tenant_id, v_number, p_reversal_date, p_reversal_date,
    v_original.fiscal_year_id, v_period, 'reversal',
    'عكس القيد ' || v_original.entry_number,
    'Reversal of ' || v_original.entry_number,
    v_original.reference, v_original.currency, v_original.exchange_rate,
    'draft', 'reversal', v_original.id::text, v_original.id,
    p_reason, auth.uid()
  ) returning * into v_reversal;

  insert into public.accounting_journal_lines(
    tenant_id, journal_entry_id, account_id, line_number, description,
    debit, credit, cost_center_id, party_type, party_id, claim_id,
    work_order_id, vehicle_id, invoice_id, expense_id, payment_id,
    reconciliation_reference, created_by
  )
  select tenant_id, v_reversal.id, account_id, line_number, description,
    credit, debit, cost_center_id, party_type, party_id, claim_id,
    work_order_id, vehicle_id, invoice_id, expense_id, payment_id,
    reconciliation_reference, auth.uid()
  from public.accounting_journal_lines
  where journal_entry_id = v_original.id
    and tenant_id = v_original.tenant_id;

  insert into public.accounting_source_links(
    tenant_id, journal_entry_id, source_type, source_id,
    source_number_snapshot, source_status_snapshot, linked_by, is_primary
  ) values (
    v_original.tenant_id, v_reversal.id, 'reversal', v_original.id,
    v_original.entry_number, v_original.status, auth.uid(), true
  );

  perform set_config('app.accounting_transition', 'on', true);
  update public.accounting_journal_entries
  set status = 'approved', approved_at = now(), approved_by = auth.uid()
  where id = v_reversal.id;

  v_reversal := public.accounting_assert_entry_ready(v_reversal.id, 'approved');
  update public.accounting_journal_entries
  set status = 'posted', posted_at = now(), posted_by = auth.uid(), updated_by = auth.uid()
  where id = v_reversal.id
  returning * into v_reversal;

  update public.accounting_journal_entries
  set status = 'reversed', updated_by = auth.uid()
  where id = v_original.id and status = 'posted';

  return v_reversal;
end;
$$;

revoke all on function public.resolve_accounting_account_mapping(text,text,uuid,uuid,date)
  from public, anon;
grant execute on function public.resolve_accounting_account_mapping(text,text,uuid,uuid,date)
  to authenticated;

revoke all on function public.accounting_validate_journal_header()
  from public, anon, authenticated;
revoke all on function public.reverse_accounting_journal_entry(uuid,date,text)
  from public, anon;
grant execute on function public.reverse_accounting_journal_entry(uuid,date,text)
  to authenticated;
