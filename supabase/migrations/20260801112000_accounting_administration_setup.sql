-- Phase 3: tenant-safe accounting administration setup.
-- This migration is intentionally non-destructive and does not seed tenant data.

alter table public.accounting_accounts
  add column if not exists notes text;

create table if not exists public.accounting_opening_balance_batches (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  fiscal_year_id uuid not null,
  batch_number text not null,
  description text,
  status text not null default 'draft' check (status in ('draft','approved','posted','void')),
  approved_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  posted_at timestamptz,
  posted_by uuid references auth.users(id) on delete set null,
  posting_journal_entry_id uuid,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_opening_balance_batches_key unique (tenant_id, batch_number),
  constraint accounting_opening_balance_batches_tenant_id_id_key unique (tenant_id, id),
  constraint accounting_opening_balance_batches_year_fk foreign key (tenant_id, fiscal_year_id)
    references public.accounting_fiscal_years(tenant_id, id) on delete restrict,
  constraint accounting_opening_balance_batches_journal_fk foreign key (tenant_id, posting_journal_entry_id)
    references public.accounting_journal_entries(tenant_id, id) on delete restrict
);

alter table public.accounting_opening_balances
  add column if not exists batch_id uuid,
  add column if not exists line_description text;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname='accounting_opening_balances_batch_fk'
  ) then
    alter table public.accounting_opening_balances
      add constraint accounting_opening_balances_batch_fk foreign key (tenant_id, batch_id)
      references public.accounting_opening_balance_batches(tenant_id, id) on delete restrict;
  end if;
end $$;

create table if not exists public.accounting_cash_bank_accounts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  name_ar text not null,
  name_en text not null,
  account_kind text not null check (account_kind in ('cash','bank')),
  accounting_account_id uuid not null,
  bank_name text,
  reference_suffix text,
  currency text not null default 'OMR' check (currency='OMR'),
  is_active boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_cash_bank_accounts_names_check check (btrim(name_ar)<>'' and btrim(name_en)<>''),
  constraint accounting_cash_bank_accounts_reference_check check (reference_suffix is null or length(reference_suffix)<=8),
  constraint accounting_cash_bank_accounts_tenant_id_id_key unique (tenant_id,id),
  constraint accounting_cash_bank_accounts_name_key unique (tenant_id,name_en),
  constraint accounting_cash_bank_accounts_ledger_fk foreign key (tenant_id,accounting_account_id)
    references public.accounting_accounts(tenant_id,id) on delete restrict
);

create unique index if not exists accounting_cash_bank_default_kind_idx
  on public.accounting_cash_bank_accounts(tenant_id,account_kind)
  where is_default and is_active;

create table if not exists public.accounting_payment_method_mappings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  payment_method text not null,
  cash_bank_account_id uuid not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null,
  constraint accounting_payment_method_mappings_key unique (tenant_id,payment_method),
  constraint accounting_payment_method_mappings_account_fk foreign key (tenant_id,cash_bank_account_id)
    references public.accounting_cash_bank_accounts(tenant_id,id) on delete restrict
);

create index if not exists accounting_opening_balance_batches_year_idx
  on public.accounting_opening_balance_batches(tenant_id,fiscal_year_id,status);
create index if not exists accounting_opening_balances_batch_idx
  on public.accounting_opening_balances(tenant_id,batch_id);
create index if not exists accounting_cash_bank_accounts_kind_idx
  on public.accounting_cash_bank_accounts(tenant_id,account_kind,is_active);

alter table public.accounting_opening_balance_batches enable row level security;
alter table public.accounting_cash_bank_accounts enable row level security;
alter table public.accounting_payment_method_mappings enable row level security;

grant select,insert,update on public.accounting_opening_balance_batches to authenticated;
grant select,insert,update on public.accounting_cash_bank_accounts to authenticated;
grant select,insert,update on public.accounting_payment_method_mappings to authenticated;
revoke all on public.accounting_opening_balance_batches from anon, public;
revoke all on public.accounting_cash_bank_accounts from anon, public;
revoke all on public.accounting_payment_method_mappings from anon, public;

create policy accounting_opening_balance_batches_read on public.accounting_opening_balance_batches
  for select to authenticated using (
    tenant_id=public.get_user_tenant_id() and
    (public.accounting_has_permission('accounting.manage_opening_balances') or public.accounting_has_permission('accounting.view_journal'))
  );
create policy accounting_opening_balance_batches_manage on public.accounting_opening_balance_batches
  for all to authenticated using (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_opening_balances')
  ) with check (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_opening_balances')
  );
create policy accounting_cash_bank_accounts_read on public.accounting_cash_bank_accounts
  for select to authenticated using (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal')
  );
create policy accounting_cash_bank_accounts_manage on public.accounting_cash_bank_accounts
  for all to authenticated using (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings')
  ) with check (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings')
  );
create policy accounting_payment_method_mappings_read on public.accounting_payment_method_mappings
  for select to authenticated using (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.view_journal')
  );
create policy accounting_payment_method_mappings_manage on public.accounting_payment_method_mappings
  for all to authenticated using (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings')
  ) with check (
    tenant_id=public.get_user_tenant_id() and public.accounting_has_permission('accounting.manage_mappings')
  );

create or replace function public.accounting_validate_mapping_overlap()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.status='active' and exists (
    select 1 from public.accounting_account_mappings m
    where m.tenant_id=new.tenant_id and m.mapping_key=new.mapping_key and m.id<>new.id
      and coalesce(m.business_type,'')=coalesce(new.business_type,'')
      and coalesce(m.department_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(new.department_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and coalesce(m.cost_center_id,'00000000-0000-0000-0000-000000000000'::uuid)=coalesce(new.cost_center_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and m.priority=new.priority and m.status='active'
      and daterange(coalesce(m.effective_from,'-infinity'::date),coalesce(m.effective_to,'infinity'::date),'[]') &&
          daterange(coalesce(new.effective_from,'-infinity'::date),coalesce(new.effective_to,'infinity'::date),'[]')
  ) then raise exception 'ACCOUNTING_MAPPING_EFFECTIVE_RANGE_OVERLAP'; end if;
  if not exists (
    select 1 from public.accounting_accounts a where a.id=new.account_id and a.tenant_id=new.tenant_id
      and a.is_active and a.is_postable
  ) then raise exception 'ACCOUNTING_MAPPING_ACCOUNT_NOT_POSTABLE'; end if;
  return new;
end;
$$;
drop trigger if exists accounting_account_mappings_overlap_guard on public.accounting_account_mappings;
create trigger accounting_account_mappings_overlap_guard before insert or update
  on public.accounting_account_mappings for each row execute function public.accounting_validate_mapping_overlap();

create or replace function public.accounting_defer_posting_rule_activation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.is_active and (tg_op='INSERT' or old.is_active is distinct from true) then
    raise exception 'ACCOUNTING_POSTING_RULE_ACTIVATION_DEFERRED_PHASE_3';
  end if;
  return new;
end;
$$;
drop trigger if exists accounting_posting_rules_phase3_activation_guard on public.accounting_posting_rules;
create trigger accounting_posting_rules_phase3_activation_guard before insert or update of is_active
  on public.accounting_posting_rules for each row execute function public.accounting_defer_posting_rule_activation();

create or replace function public.accounting_approve_opening_balance_batch(p_batch_id uuid)
returns public.accounting_opening_balance_batches
language plpgsql volatile security definer set search_path=pg_catalog,public as $$
declare v_batch public.accounting_opening_balance_batches%rowtype; v_debit numeric(18,3); v_credit numeric(18,3);
begin
  if not public.accounting_has_permission('accounting.manage_opening_balances') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;
  select * into v_batch from public.accounting_opening_balance_batches
   where id=p_batch_id and tenant_id=public.get_user_tenant_id() for update;
  if not found then raise exception 'ACCOUNTING_OPENING_BATCH_NOT_FOUND'; end if;
  if v_batch.status<>'draft' then raise exception 'ACCOUNTING_OPENING_BATCH_NOT_DRAFT'; end if;
  select coalesce(sum(debit),0),coalesce(sum(credit),0) into v_debit,v_credit
    from public.accounting_opening_balances where tenant_id=v_batch.tenant_id and batch_id=v_batch.id;
  if v_debit=0 or v_debit<>v_credit then raise exception 'ACCOUNTING_OPENING_BATCH_UNBALANCED'; end if;
  update public.accounting_opening_balance_batches set status='approved',approved_at=now(),approved_by=auth.uid(),updated_by=auth.uid()
   where id=v_batch.id returning * into v_batch;
  update public.accounting_opening_balances set status='approved',approved_at=now(),approved_by=auth.uid()
   where tenant_id=v_batch.tenant_id and batch_id=v_batch.id and status='draft';
  return v_batch;
end;
$$;

create or replace function public.accounting_setup_readiness()
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid; v_permissions boolean; v_required text[] := array[
  'insurance_receivable','cash_customer_receivable','insurance_revenue','cash_revenue',
  'output_vat','input_vat','cash','bank','supplier_payable','operating_expense'
];
begin
  v_tenant:=public.get_user_tenant_id();
  if v_tenant is null then raise exception 'ACCOUNTING_TENANT_REQUIRED'; end if;
  v_permissions:=public.accounting_has_permission('accounting.view_journal') or public.accounting_has_permission('accounting.admin');
  return jsonb_build_object(
    'schema_available',true,
    'accounts',(select count(*) from public.accounting_accounts where tenant_id=v_tenant and is_active),
    'postable_accounts',(select count(*) from public.accounting_accounts where tenant_id=v_tenant and is_active and is_postable),
    'fiscal_years',(select count(*) from public.accounting_fiscal_years where tenant_id=v_tenant),
    'open_periods',(select count(*) from public.accounting_periods where tenant_id=v_tenant and status='open'),
    'cost_centers',(select count(*) from public.accounting_cost_centers where tenant_id=v_tenant and is_active),
    'mappings',(select count(*) from public.accounting_account_mappings where tenant_id=v_tenant and status='active'),
    'missing_mappings',(select coalesce(jsonb_agg(k), '[]'::jsonb) from unnest(v_required) k where not exists(
      select 1 from public.accounting_account_mappings m where m.tenant_id=v_tenant and m.mapping_key=k and m.status='active'
    )),
    'posting_rules',(select count(*) from public.accounting_posting_rules where tenant_id=v_tenant),
    'active_posting_rules',(select count(*) from public.accounting_posting_rules where tenant_id=v_tenant and is_active),
    'cash_accounts',(select count(*) from public.accounting_cash_bank_accounts where tenant_id=v_tenant and account_kind='cash' and is_active),
    'bank_accounts',(select count(*) from public.accounting_cash_bank_accounts where tenant_id=v_tenant and account_kind='bank' and is_active),
    'opening_batches',(select count(*) from public.accounting_opening_balance_batches where tenant_id=v_tenant),
    'permissions',v_permissions,
    'tenant_isolation',true,
    'auto_posting',false
  );
end;
$$;

do $$ declare t text; begin
  foreach t in array array['accounting_opening_balance_batches','accounting_cash_bank_accounts','accounting_payment_method_mappings'] loop
    execute format('drop trigger if exists %I on public.%I',t||'_updated_at',t);
    execute format('create trigger %I before update on public.%I for each row execute function public.accounting_set_updated_at()',t||'_updated_at',t);
    execute format('drop trigger if exists %I on public.%I',t||'_audit',t);
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.accounting_write_audit()',t||'_audit',t);
  end loop;
end $$;

revoke all on function public.accounting_validate_mapping_overlap() from public,anon,authenticated;
revoke all on function public.accounting_defer_posting_rule_activation() from public,anon,authenticated;
revoke all on function public.accounting_approve_opening_balance_batch(uuid) from public,anon;
revoke all on function public.accounting_setup_readiness() from public,anon;
grant execute on function public.accounting_approve_opening_balance_batch(uuid) to authenticated;
grant execute on function public.accounting_setup_readiness() to authenticated;

comment on table public.accounting_cash_bank_accounts is 'Tenant-scoped setup metadata only; never stores full bank credentials.';
comment on function public.accounting_setup_readiness() is 'Read-only Phase 3 readiness summary. It never enables posting.';
