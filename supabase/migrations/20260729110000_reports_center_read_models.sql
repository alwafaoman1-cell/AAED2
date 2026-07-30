-- Reports & Exports Center read model.
-- Local-only in this stage. Non-destructive and does not modify operational rows.
-- Financial rules:
--   * Estimates and insurance approvals are informational, never revenue.
--   * Revenue is issued invoice subtotal (VAT excluded).
--   * Paid is sourced from successful recorded payments.
--   * Gross profit excludes VAT and uses actual direct expenses only.

create table if not exists public.report_saved_views (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  report_key text not null,
  filters jsonb not null default '{}'::jsonb,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, user_id, name)
);

alter table public.report_saved_views enable row level security;

drop policy if exists "Tenant users read report saved views" on public.report_saved_views;
create policy "Tenant users read report saved views"
on public.report_saved_views for select to authenticated
using (
  tenant_id = public.get_user_tenant_id()
  and (user_id = auth.uid() or is_shared)
);

drop policy if exists "Users create own report saved views" on public.report_saved_views;
create policy "Users create own report saved views"
on public.report_saved_views for insert to authenticated
with check (
  tenant_id = public.get_user_tenant_id()
  and user_id = auth.uid()
);

drop policy if exists "Users update own report saved views" on public.report_saved_views;
create policy "Users update own report saved views"
on public.report_saved_views for update to authenticated
using (tenant_id = public.get_user_tenant_id() and user_id = auth.uid())
with check (tenant_id = public.get_user_tenant_id() and user_id = auth.uid());

drop policy if exists "Users delete own report saved views" on public.report_saved_views;
create policy "Users delete own report saved views"
on public.report_saved_views for delete to authenticated
using (tenant_id = public.get_user_tenant_id() and user_id = auth.uid());

create index if not exists report_saved_views_tenant_user_idx
  on public.report_saved_views (tenant_id, user_id, updated_at desc);

create or replace function public.reports_center_summary_rpc(
  p_tenant_id uuid,
  p_from_date date default null,
  p_to_date date default null,
  p_business_type text default 'all',
  p_insurance_company_id uuid default null
)
returns jsonb
language sql
security invoker
stable
set search_path = public
as $$
with
authorized as (
  select p_tenant_id as tenant_id
  where p_tenant_id = public.get_user_tenant_id()
    and p_business_type in ('all', 'insurance', 'cash')
),
claims as (
  select c.*
  from public.insurance_claims c
  join authorized a on a.tenant_id = c.tenant_id
  where p_business_type in ('all', 'insurance')
    and (p_from_date is null or c.created_at::date >= p_from_date)
    and (p_to_date is null or c.created_at::date <= p_to_date)
    and c.status::text not in ('rejected', 'cancelled', 'deleted')
    and (p_insurance_company_id is null or c.insurance_company_id = p_insurance_company_id)
),
work_orders as (
  select jo.*
  from public.job_orders jo
  join authorized a on a.tenant_id = jo.tenant_id
  where (p_from_date is null or jo.created_at::date >= p_from_date)
    and (p_to_date is null or jo.created_at::date <= p_to_date)
    and jo.archived_at is null
    and jo.deleted_at is null
    and (
      p_business_type = 'all'
      or (p_business_type = 'insurance' and jo.claim_id is not null)
      or (p_business_type = 'cash' and jo.claim_id is null)
    )
),
estimate_totals as (
  select coalesce(sum(e.subtotal), 0)::numeric as estimate_total
  from public.estimates e
  join authorized a on a.tenant_id = e.tenant_id
  where (p_from_date is null or e.estimate_date >= p_from_date)
    and (p_to_date is null or e.estimate_date <= p_to_date)
    and e.status not in ('rejected', 'archived')
    and (
      p_business_type = 'all'
      or (p_business_type = 'insurance' and e.estimate_type in ('insurance', 'supplementary'))
      or (p_business_type = 'cash' and e.estimate_type = 'independent')
    )
),
insurance_invoice_rows as (
  select
    i.tenant_id,
    i.id,
    i.claim_id,
    i.invoice_date as invoice_date,
    i.due_date,
    i.subtotal,
    i.vat,
    i.total
  from public.insurance_invoices i
  join authorized a on a.tenant_id = i.tenant_id
  where p_business_type in ('all', 'insurance')
    and (p_from_date is null or i.invoice_date >= p_from_date)
    and (p_to_date is null or i.invoice_date <= p_to_date)
    and lower(coalesce(i.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
    and (p_insurance_company_id is null or i.insurance_company_id = p_insurance_company_id)
),
cash_invoice_rows as (
  select
    s.id,
    s.date as invoice_date,
    s.due_date,
    s.subtotal,
    s.tax_total as vat,
    s.total
  from public.sales_documents s
  join authorized a on a.tenant_id = s.tenant_id
  where p_business_type in ('all', 'cash')
    and s.doc_type = 'invoice'
    and (p_from_date is null or s.date >= p_from_date)
    and (p_to_date is null or s.date <= p_to_date)
    and lower(coalesce(s.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
    and s.deleted_at is null
    and s.archived_at is null
),
insurance_payments as (
  select coalesce(sum(p.amount), 0)::numeric as paid
  from public.claim_payments p
  join (
    select distinct tenant_id, claim_id
    from insurance_invoice_rows
    where claim_id is not null
  ) i on i.tenant_id = p.tenant_id and i.claim_id = p.claim_id
  where lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')
    and (p_from_date is null or p.payment_date >= p_from_date)
    and (p_to_date is null or p.payment_date <= p_to_date)
),
cash_payments as (
  select coalesce(sum(p.amount), 0)::numeric as paid
  from public.sales_payments p
  join cash_invoice_rows i on i.id = p.sales_document_id
  where (p_from_date is null or p.date >= p_from_date)
    and (p_to_date is null or p.date <= p_to_date)
),
invoice_totals as (
  select
    coalesce(sum(subtotal), 0)::numeric as subtotal,
    coalesce(sum(vat), 0)::numeric as vat,
    coalesce(sum(total), 0)::numeric as total,
    count(*) filter (where due_date < current_date)::integer as overdue
  from (
    select subtotal, vat, total, due_date from insurance_invoice_rows
    union all
    select subtotal, vat, total, due_date from cash_invoice_rows
  ) issued
),
expense_rows as (
  select
    e.*,
    coalesce(
      nullif(nullif(to_jsonb(e)->>'subtotal', '')::numeric, 0),
      e.amount,
      0
    )::numeric as actual_subtotal,
    lower(
      coalesce(e.expense_type, '') || ' ' ||
      coalesce(e.category_name, '') || ' ' ||
      coalesce(e.description, '')
    ) as classifier,
    case
      when nullif(to_jsonb(e)->>'claim_id', '') is not null
        or nullif(e.meta->>'claimId', '') is not null
        or jo.claim_id is not null
        then 'insurance'
      when jo.id is not null
        or nullif(to_jsonb(e)->>'vehicle_id', '') is not null
        or nullif(e.meta->>'vehicleId', '') is not null
        then 'cash'
      else 'unassigned'
    end as business_type
  from public.expenses e
  join authorized a on a.tenant_id = e.tenant_id
  left join public.job_orders jo
    on jo.tenant_id = e.tenant_id
   and (jo.id::text = e.linked_work_order_id or jo.order_number = e.linked_work_order_id)
  where (p_from_date is null or e.date >= p_from_date)
    and (p_to_date is null or e.date <= p_to_date)
    and e.deleted_at is null
    and e.archived_at is null
),
expense_totals as (
  select
    coalesce(sum(actual_subtotal), 0)::numeric as expenses,
    coalesce(sum(actual_subtotal) filter (where classifier ~ '(part|spare|قطع|غيار)'), 0)::numeric as parts,
    coalesce(sum(actual_subtotal) filter (where classifier ~ '(labou?r|wage|عمال|أجر|اجور|أجور)'), 0)::numeric as labor,
    coalesce(sum(actual_subtotal) filter (where classifier ~ '(transport|tow|نقل|سطح|سحب)'), 0)::numeric as transport,
    coalesce(sum(actual_subtotal) filter (
      where coalesce(nullif(to_jsonb(expense_rows)->>'expense_type', ''), '') <> 'workshop_general'
        and (
          nullif(to_jsonb(expense_rows)->>'claim_id', '') is not null
          or nullif(meta->>'claimId', '') is not null
          or linked_work_order_id is not null
          or nullif(to_jsonb(expense_rows)->>'vehicle_id', '') is not null
          or nullif(meta->>'vehicleId', '') is not null
        )
    ), 0)::numeric as direct_costs
  from expense_rows
  where p_business_type = 'all' or business_type = p_business_type
),
operational as (
  select
    count(*)::integer as work_orders_count,
    count(*) filter (
      where lower(status::text) not in ('delivered', 'closed', 'cancelled', 'تم التسليم', 'مغلق', 'ملغي')
    )::integer as vehicles_in_workshop,
    count(*) filter (
      where lower(status::text) in ('delivered', 'closed', 'تم التسليم', 'مغلق')
    )::integer as delivered_vehicles,
    coalesce(avg(
      case
        when received_at is not null then
          greatest(
            0,
            extract(epoch from (
              coalesce(
                nullif(to_jsonb(work_orders)->>'vehicle_delivered_at', '')::timestamptz,
                completed_at,
                now()
              ) - received_at
            )) / 86400
          )
      end
    ), 0)::numeric as average_workshop_days
  from work_orders
),
completed_without_invoice as (
  select count(*)::integer as count
  from work_orders jo
  where lower(jo.status::text) in ('completed', 'delivered', 'closed', 'مكتمل', 'تم التسليم', 'مغلق')
    and not exists (
      select 1
      from public.sales_documents s
      where s.tenant_id = jo.tenant_id
        and s.doc_type = 'invoice'
        and lower(coalesce(s.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
        and (s.work_order_id = jo.id::text or s.work_order_id = jo.order_number)
    )
    and not exists (
      select 1
      from public.insurance_invoices i
      where i.tenant_id = jo.tenant_id
        and lower(coalesce(i.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
        and i.claim_id = jo.claim_id
    )
)
select jsonb_build_object(
  'claims_count', (select count(*) from claims),
  'work_orders_count', (select work_orders_count from operational),
  'vehicles_in_workshop', (select vehicles_in_workshop from operational),
  'delivered_vehicles', (select delivered_vehicles from operational),
  'estimate_total', round((select estimate_total from estimate_totals), 3),
  'approved_total', round(coalesce((select sum(approved_amount) from claims), 0), 3),
  'invoice_subtotal', round((select subtotal from invoice_totals), 3),
  'vat', round((select vat from invoice_totals), 3),
  'invoice_total', round((select total from invoice_totals), 3),
  'paid', round(
    (case when p_business_type in ('all', 'insurance') then (select paid from insurance_payments) else 0 end) +
    (case when p_business_type in ('all', 'cash') then (select paid from cash_payments) else 0 end),
    3
  ),
  'outstanding', round(greatest(
    (select total from invoice_totals) -
    (
      (case when p_business_type in ('all', 'insurance') then (select paid from insurance_payments) else 0 end) +
      (case when p_business_type in ('all', 'cash') then (select paid from cash_payments) else 0 end)
    ),
    0
  ), 3),
  'expenses', round((select expenses from expense_totals), 3),
  'parts_cost', round((select parts from expense_totals), 3),
  'labor_cost', round((select labor from expense_totals), 3),
  'transport_cost', round((select transport from expense_totals), 3),
  'gross_profit', round((select subtotal from invoice_totals) - (select direct_costs from expense_totals), 3),
  'gross_margin', round(
    case
      when (select subtotal from invoice_totals) > 0
      then (((select subtotal from invoice_totals) - (select direct_costs from expense_totals)) / (select subtotal from invoice_totals)) * 100
      else 0
    end,
    3
  ),
  'average_workshop_days', round((select average_workshop_days from operational), 1),
  'overdue_invoices', (select overdue from invoice_totals),
  'claims_awaiting_collection', (
    select count(*)
    from (
      select
        i.tenant_id,
        i.claim_id,
        sum(i.total)::numeric as invoice_total
      from insurance_invoice_rows i
      where i.claim_id is not null
      group by i.tenant_id, i.claim_id
    ) i
    where i.invoice_total > 0
      and i.invoice_total > coalesce((
        select sum(p.amount)
        from public.claim_payments p
        where p.tenant_id = i.tenant_id
          and p.claim_id = i.claim_id
          and lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')
      ), 0)
  ),
  'completed_without_invoice', (select count from completed_without_invoice)
);
$$;

revoke all on function public.reports_center_summary_rpc(uuid, date, date, text, uuid) from public;
grant execute on function public.reports_center_summary_rpc(uuid, date, date, text, uuid) to authenticated;
