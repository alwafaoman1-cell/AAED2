-- Phase 4: standalone accounting reports foundation (Development rollout first).
-- Read-only reporting: no source mutation, no backfill and no automatic posting.

alter table public.accounting_role_permissions
  drop constraint if exists accounting_role_permissions_allowed_key;
alter table public.accounting_role_permissions
  add constraint accounting_role_permissions_allowed_key check (permission_key in (
    'accounting.manage_accounts','accounting.manage_fiscal_years','accounting.manage_periods',
    'accounting.manage_cost_centers','accounting.create_journal','accounting.approve_journal',
    'accounting.post_journal','accounting.reverse_journal','accounting.view_journal',
    'accounting.manage_mappings','accounting.manage_opening_balances','accounting.admin',
    'accounting_reports.view','accounting_reports.journal','accounting_reports.ledger',
    'accounting_reports.trial_balance','accounting_reports.income_statement',
    'accounting_reports.balance_sheet','accounting_reports.cash_flow',
    'accounting_reports.receivables','accounting_reports.payables','accounting_reports.cash_bank',
    'accounting_reports.revenue','accounting_reports.expenses','accounting_reports.vat',
    'accounting_reports.vehicle_profit_loss','accounting_reports.cost_centers',
    'accounting_reports.audit','accounting_reports.export_excel','accounting_reports.export_pdf',
    'accounting_reports.print','accounting_reports.saved_views','accounting_reports.admin'
  ));

create table if not exists public.accounting_report_saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  report_key text not null,
  name text not null,
  filters jsonb not null default '{}'::jsonb,
  columns jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint accounting_report_saved_views_name unique (tenant_id,user_id,report_key,name)
);

alter table public.accounting_report_saved_views enable row level security;
grant select,insert,update,delete on public.accounting_report_saved_views to authenticated;
drop policy if exists accounting_report_saved_views_own on public.accounting_report_saved_views;
create policy accounting_report_saved_views_own on public.accounting_report_saved_views
  for all to authenticated
  using (
    tenant_id=public.get_user_tenant_id() and user_id=auth.uid()
    and public.accounting_has_permission('accounting_reports.saved_views')
  )
  with check (
    tenant_id=public.get_user_tenant_id() and user_id=auth.uid()
    and public.accounting_has_permission('accounting_reports.saved_views')
  );

create or replace function public.accounting_report_record_eligible(
  p_tenant_id uuid, p_status text, p_deleted_at timestamptz default null,
  p_archived_at timestamptz default null, p_is_archived boolean default false
) returns boolean language sql stable set search_path=pg_catalog,public as $$
  select p_tenant_id=public.get_user_tenant_id()
    and p_deleted_at is null and p_archived_at is null and not coalesce(p_is_archived,false)
    and lower(coalesce(p_status,'')) not in
      ('cancelled','canceled','void','deleted','failed','bounced','reversed','archived');
$$;
revoke all on function public.accounting_report_record_eligible(uuid,text,timestamptz,timestamptz,boolean) from public,anon;
grant execute on function public.accounting_report_record_eligible(uuid,text,timestamptz,timestamptz,boolean) to authenticated;

create or replace function public.accounting_report_permission(p_report_key text)
returns text language sql immutable set search_path=pg_catalog,public as $$
  select case
    when p_report_key in ('journal','journal-detail') then 'accounting_reports.journal'
    when p_report_key in ('general-ledger','account-statement') then 'accounting_reports.ledger'
    when p_report_key='trial-balance' then 'accounting_reports.trial_balance'
    when p_report_key='income-statement' then 'accounting_reports.income_statement'
    when p_report_key='balance-sheet' then 'accounting_reports.balance_sheet'
    when p_report_key='cash-flow' then 'accounting_reports.cash_flow'
    when p_report_key in ('receivables','insurance-receivables','customer-receivables','receivables-aging') then 'accounting_reports.receivables'
    when p_report_key in ('payables','supplier-statement','payables-aging') then 'accounting_reports.payables'
    when p_report_key in ('cashbook','bank-ledger','cash-bank-summary') then 'accounting_reports.cash_bank'
    when p_report_key='revenue' then 'accounting_reports.revenue'
    when p_report_key='expenses' then 'accounting_reports.expenses'
    when p_report_key in ('vat','vat-output','vat-input') then 'accounting_reports.vat'
    when p_report_key in ('vehicle-profit-loss','vehicle-profit-loss-detail') then 'accounting_reports.vehicle_profit_loss'
    when p_report_key='cost-centers' then 'accounting_reports.cost_centers'
    when p_report_key in ('audit-exceptions','unposted-documents') then 'accounting_reports.audit'
    else 'accounting_reports.view' end;
$$;

create or replace function public.accounting_report_rpc(
  p_report_key text,
  p_from date default null,
  p_to date default null,
  p_page integer default 1,
  p_page_size integer default 50,
  p_search text default null,
  p_filters jsonb default '{}'::jsonb,
  p_sort text default 'date',
  p_direction text default 'desc'
) returns jsonb
language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.get_user_tenant_id();
  v_permission text:=public.accounting_report_permission(p_report_key);
  v_rows jsonb:='[]'::jsonb;
  v_total bigint:=0;
  v_debit numeric:=0;
  v_credit numeric:=0;
  v_offset integer:=greatest(coalesce(p_page,1)-1,0)*least(greatest(coalesce(p_page_size,50),1),500);
  v_limit integer:=least(greatest(coalesce(p_page_size,50),1),500);
begin
  if auth.uid() is null or v_tenant is null then raise exception 'ACCOUNTING_REPORT_AUTH_REQUIRED'; end if;
  if not public.accounting_has_permission(v_permission)
     and not public.accounting_has_permission('accounting_reports.admin') then
    raise exception 'ACCOUNTING_REPORT_PERMISSION_DENIED';
  end if;
  if p_report_key not in (
    'journal','journal-detail','general-ledger','account-statement','trial-balance',
    'income-statement','balance-sheet','cash-flow','receivables','insurance-receivables',
    'customer-receivables','receivables-aging','payables','supplier-statement','payables-aging',
    'cashbook','bank-ledger','cash-bank-summary','revenue','expenses','vat','vat-output',
    'vat-input','vehicle-profit-loss','vehicle-profit-loss-detail','cost-centers',
    'audit-exceptions','unposted-documents'
  ) then raise exception 'ACCOUNTING_REPORT_UNKNOWN'; end if;

  if p_report_key='journal' then
    with q as (
      select e.id,e.entry_number,e.accounting_date as date,e.document_date,e.reference,e.source_type,
             e.status,coalesce(e.description_en,e.description_ar,'') description,
             coalesce(sum(l.debit),0)::numeric debit,coalesce(sum(l.credit),0)::numeric credit
      from public.accounting_journal_entries e
      join public.accounting_journal_lines l on l.tenant_id=e.tenant_id and l.journal_entry_id=e.id
      where e.tenant_id=v_tenant and e.status='posted'
        and (p_from is null or e.accounting_date>=p_from) and (p_to is null or e.accounting_date<=p_to)
        and (nullif(p_filters->>'entry_id','') is null or e.id=(p_filters->>'entry_id')::uuid)
        and (p_search is null or e.entry_number ilike '%'||p_search||'%' or coalesce(e.reference,'') ilike '%'||p_search||'%')
      group by e.id
    ), counted as (select *,count(*) over() full_count from q)
    select coalesce(jsonb_agg(to_jsonb(x)-'full_count'),'[]'),coalesce(max(full_count),0),coalesce(sum(debit),0),coalesce(sum(credit),0)
      into v_rows,v_total,v_debit,v_credit from (select * from counted order by date desc,entry_number desc offset v_offset limit v_limit) x;
  elsif p_report_key='unposted-documents' then
    with q as (
      select e.id,e.entry_number,e.accounting_date as date,e.reference,e.source_type,e.status,
             coalesce(e.description_en,e.description_ar,'') description,0::numeric debit,0::numeric credit
      from public.accounting_journal_entries e where e.tenant_id=v_tenant and e.status<>'posted'
        and (p_from is null or e.accounting_date>=p_from) and (p_to is null or e.accounting_date<=p_to)
    ), counted as (select *,count(*) over() full_count from q)
    select coalesce(jsonb_agg(to_jsonb(x)-'full_count'),'[]'),coalesce(max(full_count),0),0,0
      into v_rows,v_total,v_debit,v_credit from (select * from counted order by date desc offset v_offset limit v_limit) x;
  elsif p_report_key='audit-exceptions' then
    with q as (
      select a.id,a.created_at::date date,a.action as entry_number,a.entity_type as account_code,
             coalesce(a.reason,'') description,0::numeric debit,0::numeric credit,'review'::text status
      from public.accounting_audit_logs a where a.tenant_id=v_tenant
        and (p_from is null or a.created_at::date>=p_from) and (p_to is null or a.created_at::date<=p_to)
        and (a.reason is not null or a.action ilike '%denied%' or a.action ilike '%failed%')
    ), counted as (select *,count(*) over() full_count from q)
    select coalesce(jsonb_agg(to_jsonb(x)-'full_count'),'[]'),coalesce(max(full_count),0),0,0
      into v_rows,v_total,v_debit,v_credit from (select * from counted order by date desc offset v_offset limit v_limit) x;
  else
    with q0 as (
      select l.id,l.journal_entry_id,e.entry_number,e.accounting_date as date,e.document_date,
        a.id account_id,a.code account_code,a.name_ar,a.name_en,a.account_type,a.normal_balance,
        l.description,l.debit::numeric,l.credit::numeric,(l.debit-l.credit)::numeric balance,
        l.party_id,l.party_type,l.vehicle_id,l.work_order_id,l.claim_id,l.invoice_id,l.payment_id,l.expense_id,
        l.cost_center_id,cc.code cost_center_code,cc.name_ar cost_center_name_ar,cc.name_en cost_center_name_en,
        e.source_type,e.reference,e.status
      from public.accounting_journal_entries e
      join public.accounting_journal_lines l on l.tenant_id=e.tenant_id and l.journal_entry_id=e.id
      join public.accounting_accounts a on a.tenant_id=l.tenant_id and a.id=l.account_id and a.is_active
      left join public.accounting_cost_centers cc on cc.tenant_id=l.tenant_id and cc.id=l.cost_center_id
      where e.tenant_id=v_tenant and e.status='posted'
        and (p_from is null or e.accounting_date>=p_from) and (p_to is null or e.accounting_date<=p_to)
        and (nullif(p_filters->>'account_id','') is null or a.id=(p_filters->>'account_id')::uuid)
        and (nullif(p_filters->>'cost_center_id','') is null or l.cost_center_id=(p_filters->>'cost_center_id')::uuid)
        and (nullif(p_filters->>'work_order_id','') is null or l.work_order_id=(p_filters->>'work_order_id')::uuid)
        and (p_search is null or a.code ilike '%'||p_search||'%' or a.name_ar ilike '%'||p_search||'%' or a.name_en ilike '%'||p_search||'%')
        and case
          when p_report_key='income-statement' then a.account_type in ('revenue','cost_of_revenue','expense')
          when p_report_key='balance-sheet' then a.account_type in ('asset','liability','equity')
          when p_report_key='revenue' then a.account_type='revenue'
          when p_report_key='expenses' then a.account_type in ('cost_of_revenue','expense')
          when p_report_key in ('receivables','receivables-aging') then a.code like '12%'
          when p_report_key='insurance-receivables' then a.code like '121%'
          when p_report_key='customer-receivables' then a.code like '122%'
          when p_report_key in ('payables','supplier-statement','payables-aging') then a.code like '21%'
          when p_report_key='cashbook' then a.code like '111%'
          when p_report_key='bank-ledger' then a.code like '112%'
          when p_report_key in ('cash-bank-summary','cash-flow') then a.code like '11%'
          when p_report_key='vat-output' then a.code like '220%'
          when p_report_key='vat-input' then lower(a.name_en) like '%vat%input%' or a.code like '14%'
          when p_report_key='vat' then lower(a.name_en) like '%vat%' or a.code like '220%'
          when p_report_key in ('vehicle-profit-loss','vehicle-profit-loss-detail') then l.vehicle_id is not null or l.work_order_id is not null
          when p_report_key='cost-centers' then l.cost_center_id is not null
          else true end
    ), grouped as (
      select min(id) id,min(date) date,account_id,account_code,name_ar,name_en,account_type,
        min(cost_center_code) cost_center_code,min(cost_center_name_ar) cost_center_name_ar,
        min(cost_center_name_en) cost_center_name_en,vehicle_id,work_order_id,party_id,party_type,
        sum(debit)::numeric debit,sum(credit)::numeric credit,
        case when account_type in ('liability','equity','revenue') then sum(credit-debit) else sum(debit-credit) end::numeric balance,
        case when account_type='revenue' then sum(credit-debit) else 0 end::numeric revenue,
        case when account_type in ('cost_of_revenue','expense') then sum(debit-credit) else 0 end::numeric cost,
        case when account_type='revenue' then sum(credit-debit)
             when account_type in ('cost_of_revenue','expense') then -sum(debit-credit) else 0 end::numeric profit,
        'posted'::text status
      from q0
      group by account_id,account_code,name_ar,name_en,account_type,vehicle_id,work_order_id,party_id,party_type
    ), counted as (select *,count(*) over() full_count from grouped)
    select coalesce(jsonb_agg(to_jsonb(x)-'full_count'),'[]'),coalesce(max(full_count),0),coalesce(sum(debit),0),coalesce(sum(credit),0)
      into v_rows,v_total,v_debit,v_credit from (select * from counted order by account_code offset v_offset limit v_limit) x;
  end if;

  return jsonb_build_object(
    'reportKey',p_report_key,'basis','posted_journal','available',true,'rows',coalesce(v_rows,'[]'::jsonb),
    'aggregates',jsonb_build_object('debit',coalesce(v_debit,0),'credit',coalesce(v_credit,0),'balance',coalesce(v_debit-v_credit,0),'rows',v_total),
    'pagination',jsonb_build_object('page',greatest(coalesce(p_page,1),1),'pageSize',v_limit,'totalRows',v_total,'totalPages',ceil(v_total::numeric/v_limit)::integer),
    'dataQuality',jsonb_build_object('status',case when v_total=0 then 'not_configured' else 'ready' end,'excludedRecordsApplied',true),
    'generatedAt',now()
  );
end; $$;

revoke all on function public.accounting_report_rpc(text,date,date,integer,integer,text,jsonb,text,text) from public,anon;
grant execute on function public.accounting_report_rpc(text,date,date,integer,integer,text,jsonb,text,text) to authenticated;

create index if not exists accounting_journal_entries_report_posted_idx
  on public.accounting_journal_entries(tenant_id,accounting_date desc,id) where status='posted';
create index if not exists accounting_journal_lines_report_account_idx
  on public.accounting_journal_lines(tenant_id,account_id,journal_entry_id);
create index if not exists accounting_journal_lines_report_vehicle_idx
  on public.accounting_journal_lines(tenant_id,vehicle_id,work_order_id) where vehicle_id is not null or work_order_id is not null;
create index if not exists accounting_audit_logs_report_exception_idx
  on public.accounting_audit_logs(tenant_id,created_at desc) where reason is not null;
