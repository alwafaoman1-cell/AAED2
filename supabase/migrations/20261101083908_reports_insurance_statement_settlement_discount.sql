-- Settlement discounts are a non-cash credit on the insurer statement.
-- Cash receipts remain cash only; balances include the approved adjustment.
-- This preserves the existing view columns, security-invoker options and RPC signature.
create or replace view public.reports_insurance_statement_facts_v1
with (security_invoker = true)
as
with transactions as (
  select
    i.tenant_id,
    i.id as record_id,
    i.invoice_date as report_date,
    i.invoice_number as reference,
    i.claim_number,
    'invoice'::text as transaction_type,
    i.party_name,
    i.vehicle_name,
    i.plate,
    i.status,
    i.subtotal,
    i.vat,
    i.total::numeric as debit,
    0::numeric as credit,
    i.due_date,
    i.insurance_company_id,
    i.customer_id,
    i.vehicle_id,
    i.claim_id,
    i.work_order_id,
    0::integer as source_rank
  from public.reports_invoice_facts_v1 i
  where i.source_type = 'insurance_invoice'

  union all

  select
    p.tenant_id,
    p.id,
    p.payment_date,
    p.payment_number,
    p.claim_number,
    'payment'::text,
    p.party_name,
    null::text,
    null::text,
    p.status,
    0::numeric,
    0::numeric,
    0::numeric,
    p.amount::numeric,
    null::date,
    p.insurance_company_id,
    p.customer_id,
    p.vehicle_id,
    p.claim_id,
    p.work_order_id,
    1::integer
  from public.reports_payment_facts_v1 p
  where p.business_type = 'insurance'

  union all

  select
    p.tenant_id,
    md5(p.id::text || ':settlement_discount')::uuid as record_id,
    p.payment_date,
    p.payment_number,
    p.claim_number,
    'settlement_discount'::text,
    p.party_name,
    null::text,
    null::text,
    p.status,
    0::numeric,
    0::numeric,
    0::numeric,
    cp.settlement_discount_amount::numeric,
    null::date,
    p.insurance_company_id,
    p.customer_id,
    p.vehicle_id,
    p.claim_id,
    p.work_order_id,
    2::integer
  from public.reports_payment_facts_v1 p
  join public.claim_payments cp
    on cp.tenant_id = p.tenant_id and cp.id = p.id
  where p.business_type = 'insurance'
    and cp.status::text = 'cleared'
    and cp.settlement_discount_amount > 0
)
select
  t.*,
  sum(t.debit - t.credit) over (
    partition by t.tenant_id, t.insurance_company_id
    order by t.report_date, t.source_rank, t.reference, t.record_id
    rows between unbounded preceding and current row
  )::numeric as running_balance
from transactions t;

create or replace view public.reports_center_rows_v1
with (security_invoker = true)
as
select
  'claims_register'::text as report_key,
  c.tenant_id,
  c.id as record_id,
  c.created_at::date as report_date,
  c.claim_number as reference,
  null::text as secondary_reference,
  'insurance'::text as business_type,
  coalesce(ic.name, c.insurance_company) as party_name,
  concat_ws(' ', nullif(c.vehicle_make, ''), nullif(c.vehicle_model, '')) as vehicle_name,
  c.vehicle_plate as plate,
  c.status::text as status,
  coalesce(c.estimated_amount, 0)::numeric as estimate_amount,
  coalesce(c.approved_amount, 0)::numeric as approved_amount,
  coalesce(fin.invoice_subtotal, 0)::numeric as invoice_subtotal,
  coalesce(fin.vat, 0)::numeric as vat,
  coalesce(fin.invoice_total, 0)::numeric as invoice_total,
  coalesce(fin.paid, 0)::numeric as paid,
  coalesce(fin.outstanding, 0)::numeric as outstanding,
  coalesce(cost.actual_cost, 0)::numeric as actual_cost,
  (coalesce(fin.invoice_subtotal, 0) - coalesce(cost.actual_cost, 0))::numeric as gross_profit,
  greatest(
    0,
    floor(extract(epoch from (
      coalesce(c.vehicle_delivered_at, c.delivered_at, now())
      - coalesce(c.vehicle_received_at, c.workshop_arrival_date, c.received_at, c.created_at)
    )) / 86400)
  )::integer as workshop_days,
  fin.due_date,
  c.insurance_company_id,
  c.customer_id,
  c.vehicle_id,
  c.id as claim_id,
  c.job_order_id as work_order_id,
  jsonb_build_object(
    'incidentDate', c.incident_date,
    'estimateDate', c.estimate_date,
    'vin', c.vehicle_vin,
    'customerName', cu.name,
    'deliveredAt', coalesce(c.vehicle_delivered_at, c.delivered_at)
  ) as extra
from public.insurance_claims c
left join public.insurance_companies ic
  on ic.tenant_id = c.tenant_id
 and ic.id = c.insurance_company_id
left join public.customers cu
  on cu.tenant_id = c.tenant_id
 and cu.id = c.customer_id
left join lateral (
  select
    coalesce(sum(i.subtotal), 0)::numeric as invoice_subtotal,
    coalesce(sum(i.vat), 0)::numeric as vat,
    coalesce(sum(i.total), 0)::numeric as invoice_total,
    coalesce(sum(i.paid), 0)::numeric as paid,
    coalesce(sum(i.outstanding), 0)::numeric as outstanding,
    min(i.due_date) as due_date
  from public.reports_invoice_facts_v1 i
  where i.tenant_id = c.tenant_id
    and i.source_type = 'insurance_invoice'
    and i.claim_id = c.id
) fin on true
left join lateral (
  select coalesce(sum(e.subtotal), 0)::numeric as actual_cost
  from public.reports_expense_facts_v1 e
  where e.tenant_id = c.tenant_id
    and e.deleted_at is null
    and e.archived_at is null
    and (
      e.claim_id = c.id
      or (c.job_order_id is not null and e.work_order_id = c.job_order_id)
    )
) cost on true
where c.status::text not in ('rejected', 'cancelled', 'deleted')

union all

select
  'work_orders', w.tenant_id, w.id, w.created_at::date, w.order_number, w.claim_number,
  w.business_type, w.customer_name, w.vehicle_name, w.plate, w.status,
  0, 0,
  coalesce(fin.invoice_subtotal, 0),
  coalesce(fin.vat, 0),
  coalesce(fin.invoice_total, 0),
  coalesce(fin.paid, 0),
  coalesce(fin.outstanding, 0),
  coalesce(cost.actual_cost, 0),
  coalesce(fin.invoice_subtotal, 0) - coalesce(cost.actual_cost, 0),
  w.workshop_days, fin.due_date,
  w.insurance_company_id, w.customer_id, w.vehicle_id, w.claim_id, w.id,
  jsonb_build_object(
    'receivedAt', w.received_at,
    'deliveredAt', w.delivered_at,
    'vin', w.vin,
    'technicianId', (
      select j.technician_id
      from public.job_orders j
      where j.tenant_id = w.tenant_id and j.id = w.id
    ),
    'workshopLocation', (
      select coalesce(to_jsonb(j)->>'vehicle_location_section', to_jsonb(j)->>'vehicle_location_bay')
      from public.job_orders j
      where j.tenant_id = w.tenant_id and j.id = w.id
    )
  )
from public.reports_work_order_facts_v1 w
left join lateral (
  select
    coalesce(sum(i.subtotal), 0)::numeric as invoice_subtotal,
    coalesce(sum(i.vat), 0)::numeric as vat,
    coalesce(sum(i.total), 0)::numeric as invoice_total,
    coalesce(sum(i.paid), 0)::numeric as paid,
    coalesce(sum(i.outstanding), 0)::numeric as outstanding,
    min(i.due_date) as due_date
  from public.reports_invoice_facts_v1 i
  where i.tenant_id = w.tenant_id
    and i.work_order_id = w.id
) fin on true
left join lateral (
  select coalesce(sum(e.subtotal), 0)::numeric as actual_cost
  from public.reports_expense_facts_v1 e
  where e.tenant_id = w.tenant_id
    and e.deleted_at is null
    and e.archived_at is null
    and e.work_order_id = w.id
) cost on true
where w.deleted_at is null

union all

select
  'invoices', i.tenant_id, i.id, i.invoice_date, i.invoice_number, i.claim_number,
  i.business_type, i.party_name, i.vehicle_name, i.plate, i.status,
  0, 0, i.subtotal, i.vat, i.total, i.paid, i.outstanding, 0, 0, null, i.due_date,
  i.insurance_company_id, i.customer_id, i.vehicle_id, i.claim_id, i.work_order_id,
  jsonb_build_object('sourceType', i.source_type)
from public.reports_invoice_facts_v1 i

union all

select
  'payments', p.tenant_id, p.id, p.payment_date, p.payment_number, p.claim_number,
  p.business_type, p.party_name, null, null, p.status,
  0, 0, 0, 0, 0, p.amount, 0, 0, 0, null, null,
  p.insurance_company_id, p.customer_id, p.vehicle_id, p.claim_id, p.work_order_id,
  jsonb_build_object('method', p.payment_method, 'invoiceId', p.invoice_id)
from public.reports_payment_facts_v1 p

union all

select
  'expenses', e.tenant_id, e.id, e.date, e.voucher_number, e.category_name,
  e.business_type, e.beneficiary, null, null, e.expense_type,
  0, 0, e.subtotal, e.vat, e.total, 0, 0, e.subtotal, -e.subtotal, null, null,
  null, null, e.vehicle_id, e.claim_id, e.work_order_id,
  jsonb_build_object('paymentMethod', e.payment_method, 'description', e.description, 'supplierId', e.supplier_id)
from public.reports_expense_facts_v1 e
where e.deleted_at is null and e.archived_at is null

union all

select
  'vehicles_in_workshop', w.tenant_id, w.id, w.created_at::date, w.order_number, w.claim_number,
  w.business_type, w.customer_name, w.vehicle_name, w.plate, w.status,
  0, 0, 0, 0, 0, 0, 0, 0, 0, w.workshop_days, null,
  w.insurance_company_id, w.customer_id, w.vehicle_id, w.claim_id, w.id,
  jsonb_build_object('receivedAt', w.received_at)
from public.reports_work_order_facts_v1 w
where w.deleted_at is null
  and w.archived_at is null
  and w.delivered_at is null
  and lower(w.status) not in ('delivered', 'closed', 'cancelled')

union all

select
  'completed_without_invoice', w.tenant_id, w.id, coalesce(w.completed_at::date, w.created_at::date),
  w.order_number, w.claim_number, w.business_type, w.customer_name, w.vehicle_name, w.plate, w.status,
  0, 0, 0, 0, 0, 0, 0, 0, 0, w.workshop_days, null,
  w.insurance_company_id, w.customer_id, w.vehicle_id, w.claim_id, w.id,
  jsonb_build_object('completedAt', w.completed_at)
from public.reports_work_order_facts_v1 w
where w.deleted_at is null
  and lower(w.status) in ('completed', 'delivered', 'closed')
  and not exists (
    select 1 from public.reports_invoice_facts_v1 i
    where i.tenant_id = w.tenant_id
      and (i.work_order_id = w.id or (w.claim_id is not null and i.claim_id = w.claim_id))
  )

union all

select
  'delivered_awaiting_collection', i.tenant_id, i.id, i.invoice_date, i.invoice_number, i.claim_number,
  i.business_type, i.party_name, i.vehicle_name, i.plate, i.status,
  0, 0, i.subtotal, i.vat, i.total, i.paid, i.outstanding, 0, 0, null, i.due_date,
  i.insurance_company_id, i.customer_id, i.vehicle_id, i.claim_id, i.work_order_id,
  jsonb_build_object('sourceType', i.source_type)
from public.reports_invoice_facts_v1 i
left join lateral (
  select w1.*
  from public.reports_work_order_facts_v1 w1
  where w1.tenant_id = i.tenant_id
    and (
      w1.id = i.work_order_id
      or (i.work_order_id is null and i.claim_id is not null and w1.claim_id = i.claim_id)
    )
  order by
    case when w1.id = i.work_order_id then 0 else 1 end,
    w1.created_at desc
  limit 1
) w on true
where i.outstanding > 0
  and (w.delivered_at is not null or lower(coalesce(w.status, '')) in ('delivered', 'closed'))

union all

select
  'insurance_company_statement', s.tenant_id, s.record_id, s.report_date, s.reference, s.claim_number,
  'insurance', s.party_name, s.vehicle_name, s.plate, s.transaction_type,
  0, 0, s.subtotal, s.vat, s.debit, case when s.transaction_type = 'payment' then s.credit else 0::numeric end, s.running_balance, 0, 0, null, s.due_date,
  s.insurance_company_id, s.customer_id, s.vehicle_id, s.claim_id, s.work_order_id,
  jsonb_build_object(
    'transactionType', s.transaction_type,
    'debit', s.debit,
    'credit', s.credit,
    'settlementDiscount', case when s.transaction_type = 'settlement_discount' then s.credit else 0::numeric end,
    'runningBalance', s.running_balance
  )
from public.reports_insurance_statement_facts_v1 s

union all

select
  'aging', i.tenant_id, i.id, i.invoice_date, i.invoice_number, i.claim_number,
  i.business_type, i.party_name, i.vehicle_name, i.plate,
  case
    when i.due_date is null or i.due_date >= current_date then 'current'
    when current_date - i.due_date <= 30 then '1-30'
    when current_date - i.due_date <= 60 then '31-60'
    when current_date - i.due_date <= 90 then '61-90'
    else '90+'
  end,
  0, 0, i.subtotal, i.vat, i.total, i.paid, i.outstanding, 0, 0, null, i.due_date,
  i.insurance_company_id, i.customer_id, i.vehicle_id, i.claim_id, i.work_order_id,
  jsonb_build_object('sourceType', i.source_type)
from public.reports_invoice_facts_v1 i
where i.outstanding > 0

union all

select
  'profitability', w.tenant_id, w.id, w.created_at::date, w.order_number, w.claim_number,
  w.business_type, w.customer_name, w.vehicle_name, w.plate, w.status,
  0, 0,
  coalesce(r.revenue, 0), 0, coalesce(r.revenue, 0), 0, 0,
  coalesce(cost.actual_cost, 0),
  coalesce(r.revenue, 0) - coalesce(cost.actual_cost, 0),
  w.workshop_days, null,
  w.insurance_company_id, w.customer_id, w.vehicle_id, w.claim_id, w.id,
  jsonb_build_object('invoiceCount', coalesce(r.invoice_count, 0))
from public.reports_work_order_facts_v1 w
left join lateral (
  select sum(i.subtotal)::numeric as revenue, count(*)::integer as invoice_count
  from public.reports_invoice_facts_v1 i
  where i.tenant_id = w.tenant_id
    and i.work_order_id = w.id
) r on true
left join lateral (
  select sum(e.subtotal)::numeric as actual_cost
  from public.reports_expense_facts_v1 e
  where e.tenant_id = w.tenant_id
    and e.deleted_at is null
    and e.archived_at is null
    and e.work_order_id = w.id
) cost on true
where w.deleted_at is null;

create or replace function public.reports_center_query_rpc(
  p_tenant_id uuid,
  p_report_key text,
  p_from_date date default null,
  p_to_date date default null,
  p_business_type text default 'all',
  p_filters jsonb default '{}'::jsonb,
  p_search text default '',
  p_sort text default 'report_date',
  p_direction text default 'desc',
  p_page integer default 1,
  p_page_size integer default 25
)
returns jsonb
language sql
security invoker
stable
set search_path = public
as $$
with authorized as (
  select p_tenant_id as tenant_id
  where p_tenant_id = public.get_user_tenant_id()
    and p_business_type in ('all', 'insurance', 'cash')
    and p_report_key in (
      'claims_register', 'work_orders', 'invoices', 'payments', 'expenses',
      'vehicles_in_workshop', 'completed_without_invoice',
      'delivered_awaiting_collection', 'insurance_company_statement',
      'aging', 'profitability'
    )
),
scoped as (
  select r.*
  from public.reports_center_rows_v1 r
  join authorized a on a.tenant_id = r.tenant_id
  where r.report_key = p_report_key
    and (p_from_date is null or r.report_date >= p_from_date)
    and (p_to_date is null or r.report_date <= p_to_date)
    and (
      nullif(p_filters->>'insuranceCompanyId', '') is null
      or r.insurance_company_id::text = p_filters->>'insuranceCompanyId'
    )
    and (
      nullif(p_filters->>'customerId', '') is null
      or r.customer_id::text = p_filters->>'customerId'
    )
    and (
      nullif(p_filters->>'vehicleId', '') is null
      or r.vehicle_id::text = p_filters->>'vehicleId'
    )
    and (
      nullif(p_filters->>'status', '') is null
      or lower(r.status) = lower(p_filters->>'status')
    )
    and (
      nullif(p_filters->>'plate', '') is null
      or coalesce(r.plate, '') ilike '%' || (p_filters->>'plate') || '%'
    )
    and (
      nullif(p_filters->>'vin', '') is null
      or coalesce(r.extra->>'vin', '') ilike '%' || (p_filters->>'vin') || '%'
    )
    and (
      nullif(p_filters->>'claimNumber', '') is null
      or coalesce(r.secondary_reference, r.reference, '') ilike '%' || (p_filters->>'claimNumber') || '%'
    )
    and (
      nullif(p_filters->>'workOrderNumber', '') is null
      or (
        r.work_order_id is not null
        and (
          r.reference ilike '%' || (p_filters->>'workOrderNumber') || '%'
          or r.work_order_id::text = p_filters->>'workOrderNumber'
        )
      )
    )
    and (
      nullif(p_filters->>'invoiceNumber', '') is null
      or (
        r.report_key in ('invoices', 'delivered_awaiting_collection', 'insurance_company_statement', 'aging')
        and r.reference ilike '%' || (p_filters->>'invoiceNumber') || '%'
      )
    )
    and (
      nullif(p_filters->>'employeeId', '') is null
      or r.extra->>'technicianId' = p_filters->>'employeeId'
    )
    and (
      nullif(p_filters->>'supplierId', '') is null
      or r.extra->>'supplierId' = p_filters->>'supplierId'
    )
    and (
      nullif(p_filters->>'expenseCategory', '') is null
      or coalesce(r.status, r.secondary_reference, '') ilike '%' || (p_filters->>'expenseCategory') || '%'
    )
    and (
      nullif(p_filters->>'paymentMethod', '') is null
      or r.extra->>'method' = p_filters->>'paymentMethod'
      or r.extra->>'paymentMethod' = p_filters->>'paymentMethod'
    )
    and (
      nullif(p_filters->>'workshopLocation', '') is null
      or coalesce(r.extra->>'workshopLocation', '') ilike '%' || (p_filters->>'workshopLocation') || '%'
    )
    and (
      nullif(p_search, '') is null
      or concat_ws(
        ' ', r.reference, r.secondary_reference, r.party_name,
        r.vehicle_name, r.plate, r.status
      ) ilike '%' || p_search || '%'
    )
),
filtered as (
  select *
  from scoped
  where p_business_type = 'all' or business_type = p_business_type
),
ordered as (
  select *
  from filtered
  order by
    case when p_direction = 'asc' and p_sort = 'reference' then reference end asc nulls last,
    case when p_direction = 'desc' and p_sort = 'reference' then reference end desc nulls last,
    case when p_direction = 'asc' and p_sort = 'party_name' then party_name end asc nulls last,
    case when p_direction = 'desc' and p_sort = 'party_name' then party_name end desc nulls last,
    case when p_direction = 'asc' and p_sort = 'invoice_total' then invoice_total end asc nulls last,
    case when p_direction = 'desc' and p_sort = 'invoice_total' then invoice_total end desc nulls last,
    case when p_direction = 'asc' and p_sort = 'outstanding' then outstanding end asc nulls last,
    case when p_direction = 'desc' and p_sort = 'outstanding' then outstanding end desc nulls last,
    case when p_direction = 'asc' and p_sort = 'gross_profit' then gross_profit end asc nulls last,
    case when p_direction = 'desc' and p_sort = 'gross_profit' then gross_profit end desc nulls last,
    case when p_direction = 'asc' then report_date end asc nulls last,
    case when p_direction <> 'asc' then report_date end desc nulls last,
    record_id
),
paged as (
  select *
  from ordered
  offset greatest(p_page - 1, 0) * least(greatest(p_page_size, 1), 100)
  limit least(greatest(p_page_size, 1), 100)
),
statement_balance as (
  select coalesce(sum(x.outstanding), 0)::numeric as outstanding
  from (
    select distinct on (insurance_company_id)
      insurance_company_id,
      outstanding
    from filtered
    where p_report_key = 'insurance_company_statement'
    order by
      insurance_company_id,
      report_date desc,
      case extra->>'transactionType' when 'settlement_discount' then 2 when 'payment' then 1 else 0 end desc,
      record_id desc
  ) x
),
totals as (
  select
    count(*)::bigint as total_rows,
    coalesce(sum(estimate_amount), 0)::numeric as estimate_amount,
    coalesce(sum(approved_amount), 0)::numeric as approved_amount,
    coalesce(sum(invoice_subtotal), 0)::numeric as invoice_subtotal,
    coalesce(sum(vat), 0)::numeric as vat,
    coalesce(sum(invoice_total), 0)::numeric as invoice_total,
    coalesce(sum(paid), 0)::numeric as paid,
    coalesce(sum(coalesce(extra->>'settlementDiscount', '0')::numeric), 0)::numeric as settlement_discount,
    case
      when p_report_key = 'insurance_company_statement'
        then (select outstanding from statement_balance)
      else coalesce(sum(outstanding), 0)::numeric
    end as outstanding,
    coalesce(sum(actual_cost), 0)::numeric as actual_cost,
    coalesce(sum(gross_profit), 0)::numeric as gross_profit,
    coalesce(avg(workshop_days) filter (where workshop_days is not null), 0)::numeric as average_workshop_days
  from filtered
),
quality as (
  select count(*) filter (where business_type = 'unknown')::integer as unknown_business_type
  from scoped
)
select jsonb_build_object(
  'rows', coalesce((
    select jsonb_agg(to_jsonb(p) - 'tenant_id' - 'report_key' order by p.report_date desc, p.record_id)
    from paged p
  ), '[]'::jsonb),
  'pagination', jsonb_build_object(
    'page', greatest(p_page, 1),
    'pageSize', least(greatest(p_page_size, 1), 100),
    'totalRows', (select total_rows from totals),
    'totalPages', case
      when (select total_rows from totals) = 0 then 0
      else ceil((select total_rows from totals)::numeric / least(greatest(p_page_size, 1), 100))::integer
    end
  ),
  'aggregates', jsonb_build_object(
    'rowCount', (select total_rows from totals),
    'estimateAmount', round((select estimate_amount from totals), 3),
    'approvedAmount', round((select approved_amount from totals), 3),
    'invoiceSubtotal', round((select invoice_subtotal from totals), 3),
    'vat', round((select vat from totals), 3),
    'invoiceTotal', round((select invoice_total from totals), 3),
    'paid', round((select paid from totals), 3),
    'settlementDiscount', round((select settlement_discount from totals), 3),
    'outstanding', round((select outstanding from totals), 3),
    'actualCost', round((select actual_cost from totals), 3),
    'grossProfit', round((select gross_profit from totals), 3),
    'averageWorkshopDays', round((select average_workshop_days from totals), 1)
  ),
  'dataQuality', jsonb_build_object(
    'unknownBusinessType', (select unknown_business_type from quality)
  )
);
$$;

