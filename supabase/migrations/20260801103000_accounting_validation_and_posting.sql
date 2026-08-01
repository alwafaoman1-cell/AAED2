-- Validation, immutable posting, atomic numbering, reversal, and audit.

create or replace function public.accounting_set_updated_at()
returns trigger language plpgsql security invoker set search_path = pg_catalog as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'accounting_accounts','accounting_fiscal_years','accounting_periods',
    'accounting_cost_centers','accounting_account_mappings','accounting_posting_rules',
    'accounting_journal_entries','accounting_role_permissions'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_updated_at', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.accounting_set_updated_at()', t || '_updated_at', t);
  end loop;
end $$;

create or replace function public.accounting_prevent_account_cycle()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_cycle boolean;
begin
  if new.parent_id is null then
    new.level := 1;
    return new;
  end if;
  with recursive ancestors as (
    select a.id, a.parent_id, 1 as depth
    from public.accounting_accounts a
    where a.id = new.parent_id and a.tenant_id = new.tenant_id
    union all
    select a.id, a.parent_id, p.depth + 1
    from public.accounting_accounts a
    join ancestors p on a.id = p.parent_id
    where a.tenant_id = new.tenant_id and p.depth < 20
  )
  select exists(select 1 from ancestors where id = new.id) into v_cycle;
  if v_cycle then raise exception 'ACCOUNTING_ACCOUNT_TREE_CYCLE'; end if;
  select a.level + 1 into new.level from public.accounting_accounts a
  where a.id = new.parent_id and a.tenant_id = new.tenant_id;
  if new.level is null or new.level > 20 then raise exception 'ACCOUNTING_ACCOUNT_LEVEL_INVALID'; end if;
  return new;
end;
$$;

drop trigger if exists accounting_accounts_cycle_guard on public.accounting_accounts;
create trigger accounting_accounts_cycle_guard before insert or update of parent_id
on public.accounting_accounts for each row execute function public.accounting_prevent_account_cycle();

create or replace function public.accounting_prevent_cost_center_cycle()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_cycle boolean;
begin
  if new.parent_id is null then return new; end if;
  with recursive ancestors as (
    select c.id, c.parent_id, 1 as depth from public.accounting_cost_centers c
    where c.id = new.parent_id and c.tenant_id = new.tenant_id
    union all
    select c.id, c.parent_id, p.depth + 1 from public.accounting_cost_centers c
    join ancestors p on c.id = p.parent_id
    where c.tenant_id = new.tenant_id and p.depth < 20
  ) select exists(select 1 from ancestors where id = new.id) into v_cycle;
  if v_cycle then raise exception 'ACCOUNTING_COST_CENTER_TREE_CYCLE'; end if;
  return new;
end;
$$;

drop trigger if exists accounting_cost_centers_cycle_guard on public.accounting_cost_centers;
create trigger accounting_cost_centers_cycle_guard before insert or update of parent_id
on public.accounting_cost_centers for each row execute function public.accounting_prevent_cost_center_cycle();

create or replace function public.accounting_validate_fiscal_year_overlap()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if exists (
    select 1 from public.accounting_fiscal_years y
    where y.tenant_id = new.tenant_id and y.id <> new.id
      and daterange(y.start_date, y.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then raise exception 'ACCOUNTING_FISCAL_YEAR_OVERLAP'; end if;
  return new;
end;
$$;

drop trigger if exists accounting_fiscal_year_overlap_guard on public.accounting_fiscal_years;
create trigger accounting_fiscal_year_overlap_guard before insert or update of start_date, end_date
on public.accounting_fiscal_years for each row execute function public.accounting_validate_fiscal_year_overlap();

create or replace function public.accounting_validate_period()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_year public.accounting_fiscal_years%rowtype;
begin
  select * into v_year from public.accounting_fiscal_years
  where id = new.fiscal_year_id and tenant_id = new.tenant_id;
  if not found or new.start_date < v_year.start_date or new.end_date > v_year.end_date then
    raise exception 'ACCOUNTING_PERIOD_OUTSIDE_FISCAL_YEAR';
  end if;
  if exists (
    select 1 from public.accounting_periods p
    where p.tenant_id = new.tenant_id and p.fiscal_year_id = new.fiscal_year_id and p.id <> new.id
      and daterange(p.start_date, p.end_date, '[]') && daterange(new.start_date, new.end_date, '[]')
  ) then raise exception 'ACCOUNTING_PERIOD_OVERLAP'; end if;
  return new;
end;
$$;

drop trigger if exists accounting_period_validation_guard on public.accounting_periods;
create trigger accounting_period_validation_guard before insert or update of fiscal_year_id, start_date, end_date
on public.accounting_periods for each row execute function public.accounting_validate_period();

create or replace function public.accounting_validate_journal_header()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_year public.accounting_fiscal_years%rowtype; v_period public.accounting_periods%rowtype;
begin
  select * into v_year from public.accounting_fiscal_years where id = new.fiscal_year_id and tenant_id = new.tenant_id;
  select * into v_period from public.accounting_periods where id = new.accounting_period_id and tenant_id = new.tenant_id;
  if not found or v_period.fiscal_year_id <> new.fiscal_year_id then raise exception 'ACCOUNTING_PERIOD_YEAR_MISMATCH'; end if;
  if new.accounting_date not between v_year.start_date and v_year.end_date
     or new.accounting_date not between v_period.start_date and v_period.end_date then
    raise exception 'ACCOUNTING_DATE_OUTSIDE_PERIOD';
  end if;
  if tg_op = 'UPDATE' then
    if old.tenant_id <> new.tenant_id then raise exception 'ACCOUNTING_TENANT_IMMUTABLE'; end if;
    if old.status in ('posted','reversed','void') and coalesce(current_setting('app.accounting_transition', true),'') <> 'on' then
      raise exception 'ACCOUNTING_POSTED_ENTRY_IMMUTABLE';
    end if;
    if old.status <> new.status and coalesce(current_setting('app.accounting_transition', true),'') <> 'on' then
      raise exception 'ACCOUNTING_STATUS_TRANSITION_REQUIRES_RPC';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_journal_header_guard on public.accounting_journal_entries;
create trigger accounting_journal_header_guard before insert or update
on public.accounting_journal_entries for each row execute function public.accounting_validate_journal_header();

create or replace function public.accounting_validate_journal_line()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_entry public.accounting_journal_entries%rowtype; v_account public.accounting_accounts%rowtype;
begin
  select * into v_entry from public.accounting_journal_entries
  where id = new.journal_entry_id and tenant_id = new.tenant_id;
  if not found then raise exception 'ACCOUNTING_ENTRY_NOT_FOUND'; end if;
  if v_entry.status <> 'draft' then raise exception 'ACCOUNTING_LINES_REQUIRE_DRAFT_ENTRY'; end if;
  select * into v_account from public.accounting_accounts where id = new.account_id and tenant_id = new.tenant_id;
  if not found then raise exception 'ACCOUNTING_ACCOUNT_NOT_FOUND'; end if;
  if not v_account.is_active then raise exception 'ACCOUNTING_ACCOUNT_INACTIVE'; end if;
  if not v_account.is_postable then raise exception 'ACCOUNTING_ACCOUNT_NOT_POSTABLE'; end if;
  if v_account.requires_cost_center and new.cost_center_id is null then raise exception 'ACCOUNTING_COST_CENTER_REQUIRED'; end if;
  return new;
end;
$$;

create or replace function public.accounting_guard_journal_line_delete()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
declare v_status text;
begin
  select status into v_status from public.accounting_journal_entries
  where id = old.journal_entry_id and tenant_id = old.tenant_id;
  if v_status <> 'draft' then raise exception 'ACCOUNTING_POSTED_LINES_IMMUTABLE'; end if;
  return old;
end;
$$;

drop trigger if exists accounting_journal_line_guard on public.accounting_journal_lines;
create trigger accounting_journal_line_guard before insert or update on public.accounting_journal_lines
for each row execute function public.accounting_validate_journal_line();
drop trigger if exists accounting_journal_line_delete_guard on public.accounting_journal_lines;
create trigger accounting_journal_line_delete_guard before delete on public.accounting_journal_lines
for each row execute function public.accounting_guard_journal_line_delete();

create or replace function public.accounting_validate_line_references()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  if new.claim_id is not null and not exists(
    select 1 from public.insurance_claims x where x.id=new.claim_id and x.tenant_id=new.tenant_id
  ) then raise exception 'ACCOUNTING_CROSS_TENANT_CLAIM_REFERENCE'; end if;
  if new.work_order_id is not null and not exists(
    select 1 from public.job_orders x where x.id=new.work_order_id and x.tenant_id=new.tenant_id
  ) then raise exception 'ACCOUNTING_CROSS_TENANT_WORK_ORDER_REFERENCE'; end if;
  if new.vehicle_id is not null and not exists(
    select 1 from public.vehicles x where x.id=new.vehicle_id and x.tenant_id=new.tenant_id
  ) then raise exception 'ACCOUNTING_CROSS_TENANT_VEHICLE_REFERENCE'; end if;
  if new.expense_id is not null and not exists(
    select 1 from public.expenses x where x.id=new.expense_id and x.tenant_id=new.tenant_id
  ) then raise exception 'ACCOUNTING_CROSS_TENANT_EXPENSE_REFERENCE'; end if;
  if new.invoice_id is not null and not (
    exists(select 1 from public.sales_documents x where x.id=new.invoice_id and x.tenant_id=new.tenant_id)
    or exists(select 1 from public.invoices x where x.id=new.invoice_id and x.tenant_id=new.tenant_id)
    or exists(select 1 from public.insurance_invoices x where x.id=new.invoice_id and x.tenant_id=new.tenant_id)
  ) then raise exception 'ACCOUNTING_CROSS_TENANT_INVOICE_REFERENCE'; end if;
  if new.payment_id is not null and not (
    exists(select 1 from public.sales_payments x where x.id=new.payment_id and x.tenant_id=new.tenant_id)
    or exists(select 1 from public.claim_payments x where x.id=new.payment_id and x.tenant_id=new.tenant_id)
    or exists(select 1 from public.supplier_payments x where x.id=new.payment_id and x.tenant_id=new.tenant_id)
  ) then raise exception 'ACCOUNTING_CROSS_TENANT_PAYMENT_REFERENCE'; end if;
  return new;
end;
$$;

drop trigger if exists accounting_journal_line_reference_guard on public.accounting_journal_lines;
create trigger accounting_journal_line_reference_guard before insert or update on public.accounting_journal_lines
for each row execute function public.accounting_validate_line_references();

create or replace function public.accounting_guard_hard_delete()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if tg_table_name = 'accounting_journal_entries' and old.status <> 'draft' then
    raise exception 'ACCOUNTING_NON_DRAFT_ENTRY_CANNOT_BE_DELETED';
  elsif tg_table_name = 'accounting_accounts' then
    if old.is_system or exists(select 1 from public.accounting_journal_lines l where l.account_id = old.id) then
      raise exception 'ACCOUNTING_USED_ACCOUNT_CANNOT_BE_DELETED';
    end if;
  end if;
  return old;
end;
$$;

drop trigger if exists accounting_journal_delete_guard on public.accounting_journal_entries;
create trigger accounting_journal_delete_guard before delete on public.accounting_journal_entries
for each row execute function public.accounting_guard_hard_delete();
drop trigger if exists accounting_account_delete_guard on public.accounting_accounts;
create trigger accounting_account_delete_guard before delete on public.accounting_accounts
for each row execute function public.accounting_guard_hard_delete();

create or replace function public.accounting_guard_used_account_changes()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public as $$
begin
  if exists(select 1 from public.accounting_journal_lines l where l.account_id = old.id)
     and (old.code, old.account_type, old.normal_balance, old.tenant_id)
         is distinct from (new.code, new.account_type, new.normal_balance, new.tenant_id) then
    raise exception 'ACCOUNTING_HISTORICAL_ACCOUNT_FIELDS_IMMUTABLE';
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_used_account_change_guard on public.accounting_accounts;
create trigger accounting_used_account_change_guard before update on public.accounting_accounts
for each row execute function public.accounting_guard_used_account_changes();

create or replace function public.next_accounting_journal_number(p_fiscal_year_id uuid)
returns text
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare v_tenant uuid; v_year integer; v_value bigint; v_prefix text;
begin
  v_tenant := public.get_user_tenant_id();
  if v_tenant is null or not (
    public.accounting_has_permission('accounting.create_journal')
    or public.accounting_has_permission('accounting.reverse_journal')
  ) then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  select extract(year from start_date)::integer into v_year from public.accounting_fiscal_years
  where id = p_fiscal_year_id and tenant_id = v_tenant;
  if v_year is null then raise exception 'ACCOUNTING_FISCAL_YEAR_NOT_FOUND'; end if;
  insert into public.accounting_journal_number_sequences(tenant_id, fiscal_year_id, prefix, next_value)
  values (v_tenant, p_fiscal_year_id, 'JE', 2)
  on conflict (tenant_id, fiscal_year_id) do update
    set next_value = public.accounting_journal_number_sequences.next_value + 1, updated_at = now()
  returning prefix, next_value - 1 into v_prefix, v_value;
  return v_prefix || '-' || v_year::text || '-' || lpad(v_value::text, 6, '0');
end;
$$;

create or replace function public.accounting_assert_entry_ready(p_entry_id uuid, p_required_status text)
returns public.accounting_journal_entries
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_entry public.accounting_journal_entries%rowtype; v_debit numeric(18,3); v_credit numeric(18,3);
begin
  select * into v_entry from public.accounting_journal_entries
  where id = p_entry_id and tenant_id = public.get_user_tenant_id() for update;
  if not found or v_entry.status <> p_required_status then raise exception 'ACCOUNTING_ENTRY_STATUS_INVALID'; end if;
  if not exists(select 1 from public.accounting_fiscal_years y where y.id=v_entry.fiscal_year_id and y.tenant_id=v_entry.tenant_id and y.status='open')
     or not exists(select 1 from public.accounting_periods p where p.id=v_entry.accounting_period_id and p.tenant_id=v_entry.tenant_id and p.status='open') then
    raise exception 'ACCOUNTING_PERIOD_NOT_OPEN';
  end if;
  select coalesce(sum(debit),0)::numeric(18,3), coalesce(sum(credit),0)::numeric(18,3)
    into v_debit, v_credit from public.accounting_journal_lines
    where journal_entry_id=v_entry.id and tenant_id=v_entry.tenant_id;
  if v_debit = 0 or v_debit <> v_credit then raise exception 'ACCOUNTING_ENTRY_UNBALANCED'; end if;
  if exists(
    select 1 from public.accounting_journal_lines l join public.accounting_accounts a
      on a.id=l.account_id and a.tenant_id=l.tenant_id
    where l.journal_entry_id=v_entry.id and (not a.is_active or not a.is_postable or (a.requires_cost_center and l.cost_center_id is null))
  ) then raise exception 'ACCOUNTING_ENTRY_HAS_INVALID_ACCOUNT'; end if;
  if exists(
    select 1 from public.accounting_source_links s where s.journal_entry_id=v_entry.id
      and not public.is_accounting_source_eligible(s.tenant_id,s.source_type,s.source_id)
  ) then raise exception 'ACCOUNTING_ENTRY_HAS_INELIGIBLE_SOURCE'; end if;
  return v_entry;
end;
$$;

create or replace function public.create_accounting_journal_entry(
  p_fiscal_year_id uuid,
  p_accounting_period_id uuid,
  p_accounting_date date,
  p_document_date date default null,
  p_entry_type text default 'manual',
  p_description_ar text default null,
  p_description_en text default null,
  p_reference text default null,
  p_source_type text default null,
  p_source_identifier text default null
)
returns public.accounting_journal_entries
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_entry public.accounting_journal_entries%rowtype; v_tenant uuid; v_number text;
begin
  if not public.accounting_has_permission('accounting.create_journal') then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  v_tenant := public.get_user_tenant_id();
  v_number := public.next_accounting_journal_number(p_fiscal_year_id);
  insert into public.accounting_journal_entries(
    tenant_id,entry_number,accounting_date,document_date,fiscal_year_id,accounting_period_id,
    entry_type,description_ar,description_en,reference,currency,exchange_rate,status,
    source_type,source_identifier,created_by
  ) values (
    v_tenant,v_number,p_accounting_date,p_document_date,p_fiscal_year_id,p_accounting_period_id,
    p_entry_type,p_description_ar,p_description_en,p_reference,'OMR',1.000000,'draft',
    p_source_type,p_source_identifier,auth.uid()
  ) returning * into v_entry;
  return v_entry;
end;
$$;

create or replace function public.approve_accounting_journal_entry(p_entry_id uuid)
returns public.accounting_journal_entries
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_entry public.accounting_journal_entries%rowtype;
begin
  if not public.accounting_has_permission('accounting.approve_journal') then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  v_entry := public.accounting_assert_entry_ready(p_entry_id,'draft');
  perform set_config('app.accounting_transition','on',true);
  update public.accounting_journal_entries set status='approved', approved_at=now(), approved_by=auth.uid(), updated_by=auth.uid()
  where id=v_entry.id and tenant_id=v_entry.tenant_id returning * into v_entry;
  return v_entry;
end;
$$;

create or replace function public.post_accounting_journal_entry(p_entry_id uuid)
returns public.accounting_journal_entries
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_entry public.accounting_journal_entries%rowtype;
begin
  if not public.accounting_has_permission('accounting.post_journal') then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  v_entry := public.accounting_assert_entry_ready(p_entry_id,'approved');
  perform set_config('app.accounting_transition','on',true);
  update public.accounting_journal_entries set status='posted', posted_at=now(), posted_by=auth.uid(), updated_by=auth.uid()
  where id=v_entry.id and tenant_id=v_entry.tenant_id and status='approved' returning * into v_entry;
  if not found then raise exception 'ACCOUNTING_DUPLICATE_POSTING'; end if;
  return v_entry;
end;
$$;

create or replace function public.reverse_accounting_journal_entry(p_entry_id uuid, p_reversal_date date, p_reason text)
returns public.accounting_journal_entries
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_original public.accounting_journal_entries%rowtype; v_reversal public.accounting_journal_entries%rowtype; v_period uuid; v_number text;
begin
  if not public.accounting_has_permission('accounting.reverse_journal') then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  if btrim(coalesce(p_reason,''))='' then raise exception 'ACCOUNTING_REVERSAL_REASON_REQUIRED'; end if;
  select * into v_original from public.accounting_journal_entries
  where id=p_entry_id and tenant_id=public.get_user_tenant_id() and status='posted' for update;
  if not found then raise exception 'ACCOUNTING_POSTED_ENTRY_NOT_FOUND'; end if;
  if exists(select 1 from public.accounting_journal_entries r where r.reversed_entry_id=v_original.id and r.tenant_id=v_original.tenant_id and r.status='posted')
    then raise exception 'ACCOUNTING_ENTRY_ALREADY_REVERSED'; end if;
  select id into v_period from public.accounting_periods
  where tenant_id=v_original.tenant_id and fiscal_year_id=v_original.fiscal_year_id and status='open'
    and p_reversal_date between start_date and end_date;
  if v_period is null then raise exception 'ACCOUNTING_REVERSAL_PERIOD_NOT_OPEN'; end if;
  v_number := public.next_accounting_journal_number(v_original.fiscal_year_id);
  insert into public.accounting_journal_entries(
    tenant_id,entry_number,accounting_date,document_date,fiscal_year_id,accounting_period_id,
    entry_type,description_ar,description_en,reference,currency,exchange_rate,status,
    source_type,source_identifier,reversed_entry_id,reversal_reason,created_by
  ) values (
    v_original.tenant_id,v_number,p_reversal_date,p_reversal_date,v_original.fiscal_year_id,v_period,
    'reversal','عكس القيد '||v_original.entry_number,'Reversal of '||v_original.entry_number,
    v_original.reference,v_original.currency,v_original.exchange_rate,'draft','reversal',v_original.id::text,
    v_original.id,p_reason,auth.uid()
  ) returning * into v_reversal;
  insert into public.accounting_journal_lines(
    tenant_id,journal_entry_id,account_id,line_number,description,debit,credit,cost_center_id,
    party_type,party_id,claim_id,work_order_id,vehicle_id,invoice_id,expense_id,payment_id,
    reconciliation_reference,created_by
  ) select tenant_id,v_reversal.id,account_id,line_number,description,credit,debit,cost_center_id,
    party_type,party_id,claim_id,work_order_id,vehicle_id,invoice_id,expense_id,payment_id,
    reconciliation_reference,auth.uid()
  from public.accounting_journal_lines where journal_entry_id=v_original.id and tenant_id=v_original.tenant_id;
  insert into public.accounting_source_links(tenant_id,journal_entry_id,source_type,source_id,source_number_snapshot,source_status_snapshot,linked_by,is_primary)
  values(v_original.tenant_id,v_reversal.id,'reversal',v_original.id,v_original.entry_number,v_original.status,auth.uid(),true);
  perform set_config('app.accounting_transition','on',true);
  update public.accounting_journal_entries set status='approved',approved_at=now(),approved_by=auth.uid() where id=v_reversal.id;
  v_reversal := public.accounting_assert_entry_ready(v_reversal.id,'approved');
  update public.accounting_journal_entries set status='posted',posted_at=now(),posted_by=auth.uid(),updated_by=auth.uid()
  where id=v_reversal.id returning * into v_reversal;
  return v_reversal;
end;
$$;

create or replace function public.accounting_write_audit()
returns trigger language plpgsql security definer set search_path = pg_catalog, public as $$
declare v_tenant uuid; v_entity uuid; v_action text; v_before jsonb; v_after jsonb;
begin
  v_before := case when tg_op='INSERT' then null else to_jsonb(old) end;
  v_after := case when tg_op='DELETE' then null else to_jsonb(new) end;
  v_tenant := coalesce((v_after->>'tenant_id')::uuid,(v_before->>'tenant_id')::uuid);
  v_entity := coalesce(nullif(v_after->>'id','')::uuid,nullif(v_before->>'id','')::uuid);
  v_action := lower(tg_op)||':'||tg_table_name;
  if tg_table_name='accounting_journal_entries' then
    if tg_op='INSERT' then v_action := 'journal.create';
    elsif old.status is distinct from new.status then
      v_action := case new.status
        when 'approved' then 'journal.approve'
        when 'posted' then case when new.entry_type='reversal' then 'journal.reverse' else 'journal.post' end
        when 'void' then 'journal.void'
        else 'journal.status_change'
      end;
    else v_action := 'journal.update_draft'; end if;
  elsif tg_table_name='accounting_accounts' then
    if tg_op='INSERT' then v_action := 'account.create';
    elsif old.is_active and not new.is_active then v_action := 'account.deactivate';
    elsif not old.is_active and new.is_active then v_action := 'account.activate';
    else v_action := 'account.update'; end if;
  elsif tg_table_name in ('accounting_periods','accounting_fiscal_years') and tg_op='UPDATE' and old.status is distinct from new.status then
    v_action := case when tg_table_name='accounting_fiscal_years' then 'fiscal_year.' else 'period.' end
      || case new.status when 'open' then 'reopen' when 'closed' then 'close' else 'lock' end;
  elsif tg_table_name='accounting_account_mappings' then
    v_action := case when tg_op='INSERT' then 'mapping.create' else 'mapping.change' end;
  elsif tg_table_name='accounting_opening_balances' then
    v_action := 'opening_balance.'||lower(tg_op);
  end if;
  insert into public.accounting_audit_logs(tenant_id,user_id,action,entity_type,entity_id,before_snapshot,after_snapshot,reason)
  values(v_tenant,auth.uid(),v_action,tg_table_name,v_entity,v_before,v_after,nullif(current_setting('app.accounting_reason',true),''));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

create or replace function public.set_accounting_period_status(
  p_period_id uuid,
  p_status text,
  p_reason text default null
)
returns public.accounting_periods
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_period public.accounting_periods%rowtype;
begin
  if not public.accounting_has_permission('accounting.manage_periods') then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  if p_status not in ('open','closed','locked') then raise exception 'ACCOUNTING_PERIOD_STATUS_INVALID'; end if;
  select * into v_period from public.accounting_periods
  where id=p_period_id and tenant_id=public.get_user_tenant_id() for update;
  if not found then raise exception 'ACCOUNTING_PERIOD_NOT_FOUND'; end if;
  if v_period.status='locked' and p_status='open' and btrim(coalesce(p_reason,''))='' then
    raise exception 'ACCOUNTING_PERIOD_REOPEN_REASON_REQUIRED';
  end if;
  perform set_config('app.accounting_reason',coalesce(p_reason,''),true);
  update public.accounting_periods set
    status=p_status,
    closed_at=case when p_status in ('closed','locked') then now() else closed_at end,
    closed_by=case when p_status in ('closed','locked') then auth.uid() else closed_by end,
    reopened_at=case when p_status='open' then now() else reopened_at end,
    reopened_by=case when p_status='open' then auth.uid() else reopened_by end,
    reopen_reason=case when p_status='open' then p_reason else reopen_reason end,
    updated_by=auth.uid()
  where id=v_period.id returning * into v_period;
  return v_period;
end;
$$;

create or replace function public.set_accounting_fiscal_year_status(
  p_fiscal_year_id uuid,
  p_status text,
  p_reason text default null
)
returns public.accounting_fiscal_years
language plpgsql volatile security definer set search_path = pg_catalog, public as $$
declare v_year public.accounting_fiscal_years%rowtype;
begin
  if not public.accounting_has_permission('accounting.manage_fiscal_years') then raise exception 'ACCOUNTING_PERMISSION_DENIED'; end if;
  if p_status not in ('open','closed','locked') then raise exception 'ACCOUNTING_FISCAL_YEAR_STATUS_INVALID'; end if;
  select * into v_year from public.accounting_fiscal_years
  where id=p_fiscal_year_id and tenant_id=public.get_user_tenant_id() for update;
  if not found then raise exception 'ACCOUNTING_FISCAL_YEAR_NOT_FOUND'; end if;
  if v_year.status='locked' and p_status='open' and btrim(coalesce(p_reason,''))='' then
    raise exception 'ACCOUNTING_FISCAL_YEAR_REOPEN_REASON_REQUIRED';
  end if;
  if p_status in ('closed','locked') and exists(
    select 1 from public.accounting_periods p
    where p.tenant_id=v_year.tenant_id and p.fiscal_year_id=v_year.id and p.status='open'
  ) then raise exception 'ACCOUNTING_FISCAL_YEAR_HAS_OPEN_PERIODS'; end if;
  perform set_config('app.accounting_reason',coalesce(p_reason,''),true);
  update public.accounting_fiscal_years set
    status=p_status,
    closed_at=case when p_status in ('closed','locked') then now() else closed_at end,
    closed_by=case when p_status in ('closed','locked') then auth.uid() else closed_by end,
    reopened_at=case when p_status='open' then now() else reopened_at end,
    reopened_by=case when p_status='open' then auth.uid() else reopened_by end,
    reopen_reason=case when p_status='open' then p_reason else reopen_reason end,
    updated_by=auth.uid()
  where id=v_year.id returning * into v_year;
  return v_year;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'accounting_accounts','accounting_fiscal_years','accounting_periods','accounting_cost_centers',
    'accounting_journal_entries','accounting_journal_lines','accounting_source_links',
    'accounting_account_mappings','accounting_posting_rules','accounting_opening_balances'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_audit', t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_write_audit()', t || '_audit', t);
  end loop;
end $$;

revoke all on function public.next_accounting_journal_number(uuid) from public, anon;
revoke all on function public.accounting_assert_entry_ready(uuid,text) from public, anon, authenticated;
revoke all on function public.approve_accounting_journal_entry(uuid) from public, anon;
revoke all on function public.create_accounting_journal_entry(uuid,uuid,date,date,text,text,text,text,text,text) from public, anon;
revoke all on function public.post_accounting_journal_entry(uuid) from public, anon;
revoke all on function public.reverse_accounting_journal_entry(uuid,date,text) from public, anon;
revoke all on function public.set_accounting_period_status(uuid,text,text) from public, anon;
revoke all on function public.set_accounting_fiscal_year_status(uuid,text,text) from public, anon;
revoke all on function public.accounting_set_updated_at() from public, anon, authenticated;
revoke all on function public.accounting_prevent_account_cycle() from public, anon, authenticated;
revoke all on function public.accounting_prevent_cost_center_cycle() from public, anon, authenticated;
revoke all on function public.accounting_validate_fiscal_year_overlap() from public, anon, authenticated;
revoke all on function public.accounting_validate_period() from public, anon, authenticated;
revoke all on function public.accounting_validate_journal_header() from public, anon, authenticated;
revoke all on function public.accounting_validate_journal_line() from public, anon, authenticated;
revoke all on function public.accounting_guard_journal_line_delete() from public, anon, authenticated;
revoke all on function public.accounting_validate_line_references() from public, anon, authenticated;
revoke all on function public.accounting_guard_hard_delete() from public, anon, authenticated;
revoke all on function public.accounting_guard_used_account_changes() from public, anon, authenticated;
revoke all on function public.accounting_write_audit() from public, anon, authenticated;
grant execute on function public.next_accounting_journal_number(uuid) to authenticated;
grant execute on function public.approve_accounting_journal_entry(uuid) to authenticated;
grant execute on function public.create_accounting_journal_entry(uuid,uuid,date,date,text,text,text,text,text,text) to authenticated;
grant execute on function public.post_accounting_journal_entry(uuid) to authenticated;
grant execute on function public.reverse_accounting_journal_entry(uuid,date,text) to authenticated;
grant execute on function public.set_accounting_period_status(uuid,text,text) to authenticated;
grant execute on function public.set_accounting_fiscal_year_status(uuid,text,text) to authenticated;
