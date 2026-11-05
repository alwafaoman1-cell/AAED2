-- Authorized atomic Production cutover, 2026-11-05.
-- Source components were rehearsed against actual Production and rolled back.
-- No operational DML, historical backfill, renumbering or blanket push.

;
-- COMPONENT supabase/migrations/20261101082501_reports_invoice_settlement_discount_receivables.sql SHA256 f81340b38fa3437d62b05be47b1f1d42e4339e5baec586e867f6020e282dfea3
-- Keep the reports-center invoice read model's column contract unchanged.
-- A cleared insurance settlement discount closes part of the receivable but
-- is not cash collected; paid remains the sum of actual cleared payments.
create or replace view public.reports_invoice_facts_v1
with (security_invoker = true)
as
with active_insurance_invoices as (
  select
    i.*,
    count(*) over (partition by i.tenant_id, i.claim_id) as active_invoice_count
  from public.insurance_invoices i
  where lower(coalesce(i.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
),
insurance_paid as (
  select
    i.tenant_id,
    i.id as invoice_id,
    coalesce(sum(p.amount) filter (
      where lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')
        and (
          p.offset_against_invoice_id = i.id
          or (p.offset_against_invoice_id is null and i.active_invoice_count = 1)
        )
    ), 0)::numeric as paid
  from active_insurance_invoices i
  left join public.claim_payments p
    on p.tenant_id = i.tenant_id
   and p.claim_id = i.claim_id
  group by i.tenant_id, i.id
),
cash_paid as (
  select p.tenant_id, p.sales_document_id, sum(p.amount)::numeric as paid
  from public.sales_payments p
  group by p.tenant_id, p.sales_document_id
)
select
  i.tenant_id,
  i.id,
  'insurance_invoice'::text as source_type,
  'insurance'::text as business_type,
  i.invoice_number,
  coalesce(nullif(to_jsonb(i)->>'invoice_date', '')::date, i.issued_at::date) as invoice_date,
  i.due_date,
  i.status,
  i.claim_id,
  c.job_order_id as work_order_id,
  c.customer_id,
  c.vehicle_id,
  i.insurance_company_id,
  i.insurance_company_name as party_name,
  c.claim_number,
  concat_ws(' ', nullif(i.vehicle_make, ''), nullif(i.vehicle_model, '')) as vehicle_name,
  i.vehicle_plate as plate,
  i.subtotal::numeric as subtotal,
  i.vat::numeric as vat,
  i.total::numeric as total,
  coalesce(cp.paid, 0)::numeric as paid,
  greatest(i.total - coalesce(cp.paid, 0) - coalesce(i.settlement_discount_amount, 0), 0)::numeric as outstanding
from active_insurance_invoices i
left join public.insurance_claims c
  on c.tenant_id = i.tenant_id
 and c.id = i.claim_id
left join insurance_paid cp
  on cp.tenant_id = i.tenant_id
 and cp.invoice_id = i.id

union all

select
  s.tenant_id,
  s.id,
  'customer_invoice'::text as source_type,
  public.reports_classify_business_type(jo.claim_id, 'customer_invoice', jo.work_order_type) as business_type,
  s.doc_number as invoice_number,
  s.date as invoice_date,
  s.due_date,
  s.status,
  jo.claim_id,
  jo.id as work_order_id,
  s.customer_id,
  jo.vehicle_id,
  null::uuid as insurance_company_id,
  coalesce(s.customer_name, cu.name) as party_name,
  c.claim_number,
  concat_ws(' ', nullif(s.vehicle_make, ''), nullif(s.vehicle_model, '')) as vehicle_name,
  s.vehicle_plate as plate,
  s.subtotal::numeric as subtotal,
  s.tax_total::numeric as vat,
  s.total::numeric as total,
  coalesce(sp.paid, 0)::numeric as paid,
  greatest(s.total - coalesce(sp.paid, 0), 0)::numeric as outstanding
from public.sales_documents s
left join lateral (
  select j.*
  from public.job_orders j
  where j.tenant_id = s.tenant_id
    and (j.id::text = s.work_order_id or j.order_number = s.work_order_id)
  order by j.created_at desc
  limit 1
) jo on true
left join public.insurance_claims c
  on c.tenant_id = s.tenant_id
 and c.id = jo.claim_id
left join public.customers cu
  on cu.tenant_id = s.tenant_id
 and cu.id = s.customer_id
left join cash_paid sp
  on sp.tenant_id = s.tenant_id
 and sp.sales_document_id = s.id
where s.doc_type = 'invoice'
  and lower(coalesce(s.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
  and nullif(to_jsonb(s)->>'deleted_at', '') is null;

;
-- COMPONENT supabase/migrations/20261101083908_reports_insurance_statement_settlement_discount.sql SHA256 5d75568b131e1b009a2c157184ead134a1667ca8b0a8bee004c75b381364462a
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

;
-- COMPONENT supabase/migrations/20261101084659_reports_center_summary_settlement_discount.sql SHA256 6dc5000203cd6425011db425e16dc9721a64a4a626ab46dc8a6e90fa44ea0712
-- The report summary's receivable is the invoice-cohort balance after cleared
-- cash and approved insurer settlement discounts; paid remains cash only.
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
  select coalesce(sum(p.amount), 0)::numeric as paid,
    coalesce(sum(p.settlement_discount_amount), 0)::numeric as settlement_discount
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
    ) -
    (case when p_business_type in ('all', 'insurance') then (select settlement_discount from insurance_payments) else 0 end),
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
        select sum(p.amount + p.settlement_discount_amount)
        from public.claim_payments p
        where p.tenant_id = i.tenant_id
          and p.claim_id = i.claim_id
          and lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')
      ), 0)
  ),
  'completed_without_invoice', (select count from completed_without_invoice)
);
$$;

;
-- COMPONENT supabase/migrations/20261101085816_monthly_vehicle_settlement_cost_release.sql SHA256 22329361f564d17f498aaa2e18363230542fb8f10088eef218ef87abd3972834
-- Release lifetime direct costs when an approved insurance settlement discount
-- extinguishes the final receivable. Discounts remain non-cash and never inflate
-- recognized revenue or VAT. The existing cash and authorization paths are unchanged.
CREATE OR REPLACE FUNCTION public.monthly_vehicle_profitability_rpc(p_from date, p_to date, p_business_type text DEFAULT 'cash'::text, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb;
  v_aggregates jsonb;
  v_overheads jsonb;
  v_total bigint := 0;
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'ACCOUNTING_REPORT_AUTH_REQUIRED';
  end if;
  if p_business_type not in ('cash', 'insurance') then
    raise exception 'INVALID_BUSINESS_TYPE';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;
  if not public.accounting_has_permission('accounting_reports.vehicle_profit_loss')
     and not public.accounting_has_permission('accounting_reports.admin') then
    raise exception 'ACCOUNTING_REPORT_PERMISSION_DENIED';
  end if;

  with
  valid_work_orders as (
    select w.*
    from public.reports_work_order_facts_v1 w
    join public.job_orders jo on jo.tenant_id = w.tenant_id and jo.id = w.id
    left join public.insurance_claims c on c.tenant_id = w.tenant_id and c.id = w.claim_id
    where w.tenant_id = v_tenant
      and w.business_type = p_business_type
      and jo.deleted_at is null
      and lower(coalesce(jo.status::text, '')) not in ('cancelled','canceled','deleted')
      and (c.id is null or lower(coalesce(c.status::text, '')) not in ('cancelled','canceled','rejected','deleted'))
  ),
  eligible_invoices_base as (
    select i.*,
      coalesce(i.work_order_id::text, 'vehicle:' || i.vehicle_id::text) operation_key
    from public.reports_invoice_facts_v1 i
    where i.tenant_id = v_tenant
      and i.business_type = p_business_type
      and (i.work_order_id is not null or i.vehicle_id is not null)
      and lower(coalesce(i.status, 'issued')) not in ('draft','cancelled','canceled','void','deleted')
  ),
  eligible_invoices as (
    select i.*, count(*) over (partition by i.operation_key) operation_invoice_count
    from eligible_invoices_base i
  ),
  eligible_payments as (
    select p.*,
      coalesce(cp.settlement_discount_amount, 0)::numeric as settlement_discount_amount,
      coalesce(p.work_order_id::text, 'vehicle:' || p.vehicle_id::text) payment_operation_key
    from public.reports_payment_facts_v1 p
    left join public.claim_payments cp
      on p.business_type = 'insurance'
     and cp.tenant_id = p.tenant_id
     and cp.id = p.id
     and cp.status::text = 'cleared'
    where p.tenant_id = v_tenant
      and p.business_type = p_business_type
      and p.payment_date <= p_to
      and lower(coalesce(p.status, 'cleared')) in ('cleared','paid','completed','success','succeeded')
  ),
  period_payments as (
    select p.* from eligible_payments p
    where p.payment_date between p_from and p_to
  ),
  linked_payments_base as (
    select
      p.*,
      i.id linked_invoice_id,
      i.operation_key invoice_operation_key,
      i.work_order_id invoice_work_order_id,
      i.vehicle_id invoice_vehicle_id,
      i.claim_id invoice_claim_id,
      i.invoice_number,
      i.invoice_date,
      i.source_type invoice_source_type,
      i.subtotal invoice_subtotal,
      i.vat invoice_vat,
      i.total invoice_total,
      i.outstanding invoice_outstanding
    from eligible_payments p
    left join eligible_invoices i
      on i.id = p.invoice_id
      or (
        p.invoice_id is null
        and i.operation_key = p.payment_operation_key
        and i.operation_invoice_count = 1
      )
  ),
  linked_payments as (
    select p.*,
      coalesce(
        sum(p.amount) over (
          partition by p.linked_invoice_id
          order by p.payment_date, p.id
          rows between unbounded preceding and 1 preceding
        ), 0
      )::numeric paid_before
    from linked_payments_base p
  ),
  period_payment_recognition as (
    select p.*,
      case
        when p.linked_invoice_id is null or coalesce(p.invoice_total, 0) <= 0 then 0
        else least(p.amount, greatest(p.invoice_total - p.paid_before, 0))
      end::numeric recognized_gross
    from linked_payments p
    where p.payment_date between p_from and p_to
  ),
  payment_revenue_basis as (
    select
      p.*,
      case
        when p_business_type = 'cash' then least(
          p.recognized_gross,
          greatest(
            coalesce(p.invoice_vat, 0)
            - least(coalesce(p.paid_before, 0), coalesce(p.invoice_vat, 0)),
            0
          )
        )
        else p.recognized_gross * coalesce(p.invoice_vat / nullif(p.invoice_total, 0), 0)
      end::numeric recognized_vat_amount,
      case
        when p_business_type = 'cash' then greatest(
          p.recognized_gross - least(
            p.recognized_gross,
            greatest(
              coalesce(p.invoice_vat, 0)
              - least(coalesce(p.paid_before, 0), coalesce(p.invoice_vat, 0)),
              0
            )
          ),
          0
        )
        else p.recognized_gross * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0)
      end::numeric recognized_net
    from period_payment_recognition p
  ),
  eligible_expenses as (
    select e.*,
      lower(coalesce(e.expense_type,'') || ' ' || coalesce(e.category_name,'') || ' ' || coalesce(e.description,'')) classifier
    from public.reports_expense_facts_v1 e
    left join public.job_orders jo on jo.tenant_id=e.tenant_id and jo.id=e.work_order_id
    left join public.insurance_claims c on c.tenant_id=e.tenant_id and c.id=e.claim_id
    where e.tenant_id = v_tenant
      and e.deleted_at is null and e.archived_at is null
      and (jo.id is null or (jo.deleted_at is null and lower(coalesce(jo.status::text,'')) not in ('cancelled','canceled','deleted')))
      and (c.id is null or lower(coalesce(c.status::text,'')) not in ('cancelled','canceled','rejected','deleted'))
  ),
  eligible_period_expenses as (
    select e.* from eligible_expenses e where e.date between p_from and p_to
  ),
  direct_expenses as (
    select e.*
    from eligible_expenses e
    where e.business_type = p_business_type
      and e.expense_type <> 'workshop_general'
      and (e.work_order_id is not null or e.vehicle_id is not null)
  ),
  activity_operations as (
    select distinct
      coalesce(p.payment_operation_key, p.invoice_operation_key) operation_key,
      coalesce(p.work_order_id, p.invoice_work_order_id) work_order_id,
      coalesce(p.vehicle_id, p.invoice_vehicle_id) vehicle_id,
      coalesce(p.claim_id, p.invoice_claim_id) claim_id
    from period_payment_recognition p
    where coalesce(p.payment_operation_key, p.invoice_operation_key) is not null
  ),
  invoice_line_amounts as (
    select
      i.id,
      i.source_type,
      coalesce(sum(line.net_amount), 0)::numeric raw_line_total,
      coalesce(sum(line.net_amount) filter (where line.is_parts), 0)::numeric raw_parts_total
    from eligible_invoices i
    join activity_operations a on a.operation_key = i.operation_key
    left join public.sales_documents sd
      on i.source_type = 'customer_invoice' and sd.tenant_id = i.tenant_id and sd.id = i.id
    left join public.insurance_invoices ii
      on i.source_type = 'insurance_invoice' and ii.tenant_id = i.tenant_id and ii.id = i.id
    left join lateral (
      select
        (
          case when pg_input_is_valid(item->>'quantity', 'numeric')
            then greatest((item->>'quantity')::numeric, 0) else 1 end
          * case when pg_input_is_valid(coalesce(item->>'unitPrice', item->>'unit_price', item->>'price'), 'numeric')
              then greatest(coalesce(item->>'unitPrice', item->>'unit_price', item->>'price')::numeric, 0) else 0 end
          * (1 - least(greatest(case when pg_input_is_valid(item->>'discount', 'numeric')
              then (item->>'discount')::numeric else 0 end, 0), 100) / 100)
        )::numeric net_amount,
        (
          nullif(item->>'inventoryId', '') is not null
          or lower(coalesce(item->>'id', '')) like 'exp::%'
          or lower(concat_ws(' ', item->>'itemName', item->>'item_name', item->>'description', item->>'category', item->>'type')) ~ '(part|spare|قطع|غيار)'
        ) is_parts
      from jsonb_array_elements(
        case when i.source_type = 'customer_invoice' then coalesce(sd.items, '[]'::jsonb)
             when i.source_type = 'insurance_invoice' then coalesce(ii.items, '[]'::jsonb)
             else '[]'::jsonb end
      ) item
    ) line on true
    group by i.id, i.source_type
  ),
  payment_revenue_month as (
    select
      coalesce(p.payment_operation_key, p.invoice_operation_key) operation_key,
      sum(p.recognized_net)::numeric recognized_revenue_ex_vat,
      sum(p.recognized_vat_amount)::numeric recognized_vat,
      sum(p.settlement_discount_amount
          * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0))::numeric cost_release_discount_ex_vat,
      sum(
        p.recognized_net
        * case when lm.raw_line_total > 0 then lm.raw_parts_total / lm.raw_line_total else 0 end
      )::numeric parts_revenue,
      sum(
        p.recognized_net
        * (1 - case when lm.raw_line_total > 0 then lm.raw_parts_total / lm.raw_line_total else 0 end)
      )::numeric labor_revenue
    from payment_revenue_basis p
    left join invoice_line_amounts lm on lm.id = p.linked_invoice_id and lm.source_type = p.invoice_source_type
    group by 1
  ),
  payment_month as (
    select coalesce(p.payment_operation_key, p.invoice_operation_key) operation_key,
      sum(p.amount)::numeric collected
    from period_payment_recognition p
    group by 1
  ),
  invoice_context as (
    select i.operation_key,
      string_agg(distinct i.invoice_number, ', ' order by i.invoice_number) invoice_numbers,
      string_agg(distinct i.invoice_date::text, ', ' order by i.invoice_date::text) invoice_dates,
      sum(i.outstanding)::numeric outstanding,
      sum(i.subtotal)::numeric total_invoice_subtotal
    from eligible_invoices i
    join activity_operations a on a.operation_key = i.operation_key
    group by i.operation_key
  ),
  expense_lifetime as (
    select coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text) operation_key,
      coalesce(sum(e.subtotal) filter (where e.classifier ~ '(part|spare|قطع|غيار)'),0)::numeric parts_cost,
      coalesce(sum(e.subtotal) filter (where e.classifier ~ '(labou?r|wage|salary|عمال|أجر|اجور|أجور)'),0)::numeric labor_cost,
      coalesce(sum(e.subtotal) filter (where e.classifier !~ '(part|spare|قطع|غيار|labou?r|wage|salary|عمال|أجر|اجور|أجور)'),0)::numeric operating_cost
    from direct_expenses e
    join activity_operations a
      on a.operation_key = coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text)
    group by 1
  ),
  matched_cost_month as (
    select
      e.operation_key,
      (e.parts_cost * least(greatest(coalesce(pr.recognized_revenue_ex_vat,0) + coalesce(pr.cost_release_discount_ex_vat,0),0) / nullif(cx.total_invoice_subtotal,0),1))::numeric parts_cost,
      (e.labor_cost * least(greatest(coalesce(pr.recognized_revenue_ex_vat,0) + coalesce(pr.cost_release_discount_ex_vat,0),0) / nullif(cx.total_invoice_subtotal,0),1))::numeric labor_cost,
      (e.operating_cost * least(greatest(coalesce(pr.recognized_revenue_ex_vat,0) + coalesce(pr.cost_release_discount_ex_vat,0),0) / nullif(cx.total_invoice_subtotal,0),1))::numeric operating_cost
    from expense_lifetime e
    join payment_revenue_month pr on pr.operation_key=e.operation_key
    join invoice_context cx on cx.operation_key=e.operation_key
    where cx.total_invoice_subtotal > 0
  ),
  report_rows as (
    select
      a.operation_key operation_id,
      w.id work_order_id,
      w.order_number work_order_number,
      w.status work_order_status,
      coalesce(w.claim_id,a.claim_id) claim_id,
      coalesce(w.claim_number,c.claim_number) claim_number,
      coalesce(ic.name,c.insurance_company) insurance_company,
      cu.customer_code, cu.name customer_name, cu.phone customer_phone,
      v.id vehicle_id, v.plate_number, v.plate_letters, v.plate_country,
      v.brand, v.model, v.year, v.color, coalesce(v.vin,v.vin_number) vin,
      v.mileage, v.vehicle_type,
      w.received_at, w.delivered_at, w.workshop_days,
      cx.invoice_numbers, cx.invoice_dates,
      coalesce(pr.recognized_revenue_ex_vat,0)::numeric recognized_revenue_ex_vat,
      coalesce(pr.recognized_revenue_ex_vat,0)::numeric invoiced_ex_vat,
      coalesce(pr.labor_revenue,0)::numeric labor_revenue,
      coalesce(pr.parts_revenue,0)::numeric parts_revenue,
      coalesce(pr.recognized_vat,0)::numeric vat,
      (coalesce(pr.recognized_revenue_ex_vat,0)+coalesce(pr.recognized_vat,0))::numeric invoiced_total,
      coalesce(pm.collected,0)::numeric collected,
      coalesce(cx.outstanding,0)::numeric outstanding,
      coalesce(em.parts_cost,0)::numeric parts_cost,
      coalesce(em.labor_cost,0)::numeric labor_cost,
      coalesce(em.operating_cost,0)::numeric operating_cost,
      coalesce(em.operating_cost,0)::numeric external_direct_cost,
      (coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0))::numeric direct_cost,
      (coalesce(pr.recognized_revenue_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0))::numeric gross_profit,
      case when coalesce(pr.recognized_revenue_ex_vat,0)=0 then 0 else
        ((coalesce(pr.recognized_revenue_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0))/pr.recognized_revenue_ex_vat*100)::numeric end profit_margin,
      case
        when coalesce(pm.collected,0)>0 and coalesce(pr.recognized_revenue_ex_vat,0)=0 then 'payment_without_linked_invoice'
        when coalesce(pr.recognized_revenue_ex_vat,0)=0 and coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0)=0 then 'no_actual_financial_data'
        when coalesce(pr.recognized_revenue_ex_vat,0)=0 then 'monthly_cost_without_monthly_revenue'
        when coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0)=0 then 'monthly_revenue_without_monthly_costs'
        else 'actual_monthly_data_available'
      end accounting_status
    from activity_operations a
    left join valid_work_orders w on w.id=a.work_order_id
    left join public.vehicles v on v.tenant_id=v_tenant and v.id=coalesce(w.vehicle_id,a.vehicle_id)
    left join public.insurance_claims c on c.tenant_id=v_tenant and c.id=coalesce(w.claim_id,a.claim_id)
    left join public.customers cu on cu.tenant_id=v_tenant and cu.id=coalesce(w.customer_id,c.customer_id,v.customer_id)
    left join public.insurance_companies ic on ic.tenant_id=v_tenant and ic.id=c.insurance_company_id
    left join payment_revenue_month pr on pr.operation_key=a.operation_key
    left join payment_month pm on pm.operation_key=a.operation_key
    left join invoice_context cx on cx.operation_key=a.operation_key
    left join matched_cost_month em on em.operation_key=a.operation_key
    where v.id is not null
      and (
        nullif(trim(coalesce(p_search,'')),'') is null
        or coalesce(w.order_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(c.claim_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cu.name,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cu.customer_code,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cu.phone,'') ilike '%'||trim(p_search)||'%'
        or coalesce(v.plate_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(v.plate_letters,'') ilike '%'||trim(p_search)||'%'
        or coalesce(v.vin,v.vin_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cx.invoice_numbers,'') ilike '%'||trim(p_search)||'%'
      )
  ),
  page_rows as (
    select * from report_rows
    order by coalesce(invoice_dates,'') desc, work_order_number desc nulls last, plate_number
    offset (v_page-1)*v_page_size limit v_page_size
  ),
  overhead_rows as (
    select e.* from eligible_period_expenses e
    where e.expense_type='workshop_general' or (e.work_order_id is null and e.vehicle_id is null and e.claim_id is null)
  ),
  overhead_summary as (
    select
      coalesce(sum(subtotal) filter(where classifier ~ '(salary|payroll|wage|راتب|رواتب|أجور الموظف)'),0)::numeric salaries,
      coalesce(sum(subtotal) filter(where classifier ~ '(rent|lease|subscription|license|depreciation|إيجار|ايجار|اشتراك|رخص|استهلاك)'),0)::numeric fixed,
      coalesce(sum(subtotal) filter(where classifier ~ '(electric|water|telephone|internet|fuel|tool|maintenance|admin|utility|كهرب|ماء|هاتف|انترنت|وقود|أدوات|صيانة|إدار)'),0)::numeric operating,
      coalesce(sum(subtotal) filter(where classifier ~ '(part|spare|قطع|غيار)'),0)::numeric unlinked_parts,
      coalesce(sum(subtotal) filter(where classifier !~ '(salary|payroll|wage|راتب|رواتب|أجور الموظف|rent|lease|subscription|license|depreciation|إيجار|ايجار|اشتراك|رخص|استهلاك|electric|water|telephone|internet|fuel|tool|maintenance|admin|utility|كهرب|ماء|هاتف|انترنت|وقود|أدوات|صيانة|إدار|part|spare|قطع|غيار)'),0)::numeric other,
      coalesce(sum(subtotal),0)::numeric total
    from overhead_rows
  )
  select
    coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows),'[]'::jsonb),
    coalesce((select count(*) from report_rows),0),
    coalesce((select jsonb_build_object(
      'recognized_revenue_ex_vat',sum(recognized_revenue_ex_vat),
      'invoiced_ex_vat',sum(invoiced_ex_vat),
      'labor_revenue',sum(labor_revenue),'parts_revenue',sum(parts_revenue),
      'vat',sum(vat),'invoiced_total',sum(invoiced_total),
      'collected',sum(collected),'outstanding',sum(outstanding),'parts_cost',sum(parts_cost),
      'labor_cost',sum(labor_cost),'operating_cost',sum(operating_cost),
      'external_direct_cost',sum(external_direct_cost),'direct_cost',sum(direct_cost),
      'gross_profit',sum(gross_profit),'vehicles',count(distinct vehicle_id)
    ) from report_rows),'{}'::jsonb),
    coalesce((select to_jsonb(overhead_summary) from overhead_summary),'{}'::jsonb)
  into v_rows,v_total,v_aggregates,v_overheads;

  return jsonb_build_object(
    'rows',v_rows,
    'aggregates',v_aggregates,
    'overheads',v_overheads,
    'pagination',jsonb_build_object('page',v_page,'pageSize',v_page_size,'totalRows',v_total,'totalPages',ceil(v_total::numeric/v_page_size)::integer),
    'basis','cash payments are VAT-inclusive as entered; full invoice VAT is recognized once from the earliest cash collection(s), partial payments change paid and outstanding only, and later collections do not repeat VAT; insurance keeps proportional VAT recognition; lifetime direct costs remain matched without duplication',
    'generatedAt',now()
  );
end;
$function$;


revoke all on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) from public, anon;
grant execute on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) to authenticated;

;
-- COMPONENT supabase/migrations/20261104043300_reports_summary_payment_period_and_receivable_parity.sql SHA256 8b1398eff6cfa79194440ae6da6f7b099ac381f4bd98d65390042c4dfd6ee246
-- Read-model only: no table, sequence, invoice, payment or journal mutations.
-- Version matches the Development migration ledger returned by apply_migration.
-- Invoice totals/current balances follow the selected invoice-date cohort.
-- Cash collected follows actual payment dates, including older eligible invoices.
-- Preserve function signature, invoker security and existing EXECUTE grants.
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
-- Invoice identity/eligibility is independent of the payment period. Use the
-- canonical current receivable, including approved non-cash settlement discounts.
eligible_insurance_invoice_rows as (
  select i.tenant_id, i.id, i.claim_id, f.invoice_date, i.due_date,
    i.subtotal, i.vat, i.total, f.outstanding
  from public.insurance_invoices i
  join authorized a on a.tenant_id = i.tenant_id
  join public.reports_invoice_facts_v1 f
    on f.tenant_id = i.tenant_id and f.id = i.id
   and f.source_type = 'insurance_invoice'
  where p_business_type in ('all', 'insurance')
    and (p_insurance_company_id is null or i.insurance_company_id = p_insurance_company_id)
),
insurance_invoice_rows as (
  select * from eligible_insurance_invoice_rows i
  where (p_from_date is null or i.invoice_date >= p_from_date)
    and (p_to_date is null or i.invoice_date <= p_to_date)
),
eligible_cash_invoice_rows as (
  select s.tenant_id, s.id, f.invoice_date, s.due_date, s.subtotal,
    s.tax_total as vat, s.total, f.outstanding
  from public.sales_documents s
  join authorized a on a.tenant_id = s.tenant_id
  join public.reports_invoice_facts_v1 f
    on f.tenant_id = s.tenant_id and f.id = s.id
   and f.source_type = 'customer_invoice'
  where p_business_type in ('all', 'cash')
    and s.deleted_at is null
    and s.archived_at is null
),
cash_invoice_rows as (
  select * from eligible_cash_invoice_rows i
  where (p_from_date is null or i.invoice_date >= p_from_date)
    and (p_to_date is null or i.invoice_date <= p_to_date)
),
insurance_payments as (
  select coalesce(sum(p.amount), 0)::numeric as paid
  from public.claim_payments p
  where lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')
    and (p_from_date is null or p.payment_date >= p_from_date)
    and (p_to_date is null or p.payment_date <= p_to_date)
    and exists (
      select 1 from eligible_insurance_invoice_rows i
      where i.tenant_id = p.tenant_id and i.claim_id = p.claim_id
        and (p.offset_against_invoice_id is null or p.offset_against_invoice_id = i.id)
    )
),
cash_payments as (
  select coalesce(sum(p.amount), 0)::numeric as paid
  from public.sales_payments p
  join eligible_cash_invoice_rows i
    on i.tenant_id = p.tenant_id and i.id = p.sales_document_id
  where (p_from_date is null or p.date >= p_from_date)
    and (p_to_date is null or p.date <= p_to_date)
),
invoice_totals as (
  select
    coalesce(sum(subtotal), 0)::numeric as subtotal,
    coalesce(sum(vat), 0)::numeric as vat,
    coalesce(sum(total), 0)::numeric as total,
    coalesce(sum(outstanding), 0)::numeric as outstanding,
    count(*) filter (where due_date < current_date and outstanding > 0)::integer as overdue
  from (
    select subtotal, vat, total, due_date, outstanding from insurance_invoice_rows
    union all
    select subtotal, vat, total, due_date, outstanding from cash_invoice_rows
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
  'outstanding', round((select outstanding from invoice_totals), 3),
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
    select count(distinct claim_id)
    from insurance_invoice_rows
    where claim_id is not null and outstanding > 0
  ),
  'completed_without_invoice', (select count from completed_without_invoice)
);
$$;

;
-- COMPONENT supabase/migrations/20261104043915_monthly_vehicle_parent_eligibility_guard.sql SHA256 b27ce192f729c9408ced8205dc17d36025f230b43fdefd60b32d27a9d8688653
-- Read-model only. Preserve approved settlement cost release and all financial dates.
-- Version matches the Development ledger returned by apply_migration.
-- Enforce the existing cancelled/deleted-parent policy after optional joins.
CREATE OR REPLACE FUNCTION public.monthly_vehicle_profitability_rpc(p_from date, p_to date, p_business_type text DEFAULT 'cash'::text, p_search text DEFAULT NULL::text, p_page integer DEFAULT 1, p_page_size integer DEFAULT 50)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_rows jsonb;
  v_aggregates jsonb;
  v_overheads jsonb;
  v_total bigint := 0;
  v_page_size integer := least(greatest(coalesce(p_page_size, 50), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'ACCOUNTING_REPORT_AUTH_REQUIRED';
  end if;
  if p_business_type not in ('cash', 'insurance') then
    raise exception 'INVALID_BUSINESS_TYPE';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;
  if not public.accounting_has_permission('accounting_reports.vehicle_profit_loss')
     and not public.accounting_has_permission('accounting_reports.admin') then
    raise exception 'ACCOUNTING_REPORT_PERMISSION_DENIED';
  end if;

  with
  valid_work_orders as (
    select w.*
    from public.reports_work_order_facts_v1 w
    join public.job_orders jo on jo.tenant_id = w.tenant_id and jo.id = w.id
    left join public.insurance_claims c on c.tenant_id = w.tenant_id and c.id = w.claim_id
    where w.tenant_id = v_tenant
      and w.business_type = p_business_type
      and jo.deleted_at is null
      and lower(coalesce(jo.status::text, '')) not in ('cancelled','canceled','deleted')
      and (c.id is null or lower(coalesce(c.status::text, '')) not in ('cancelled','canceled','rejected','deleted'))
  ),
  eligible_invoices_base as (
    select i.*,
      coalesce(i.work_order_id::text, 'vehicle:' || i.vehicle_id::text) operation_key
    from public.reports_invoice_facts_v1 i
    where i.tenant_id = v_tenant
      and i.business_type = p_business_type
      and (i.work_order_id is not null or i.vehicle_id is not null)
      and lower(coalesce(i.status, 'issued')) not in ('draft','cancelled','canceled','void','deleted')
  ),
  eligible_invoices as (
    select i.*, count(*) over (partition by i.operation_key) operation_invoice_count
    from eligible_invoices_base i
  ),
  eligible_payments as (
    select p.*,
      coalesce(cp.settlement_discount_amount, 0)::numeric as settlement_discount_amount,
      coalesce(p.work_order_id::text, 'vehicle:' || p.vehicle_id::text) payment_operation_key
    from public.reports_payment_facts_v1 p
    left join public.claim_payments cp
      on p.business_type = 'insurance'
     and cp.tenant_id = p.tenant_id
     and cp.id = p.id
     and cp.status::text = 'cleared'
    where p.tenant_id = v_tenant
      and p.business_type = p_business_type
      and p.payment_date <= p_to
      and lower(coalesce(p.status, 'cleared')) in ('cleared','paid','completed','success','succeeded')
  ),
  period_payments as (
    select p.* from eligible_payments p
    where p.payment_date between p_from and p_to
  ),
  linked_payments_base as (
    select
      p.*,
      i.id linked_invoice_id,
      i.operation_key invoice_operation_key,
      i.work_order_id invoice_work_order_id,
      i.vehicle_id invoice_vehicle_id,
      i.claim_id invoice_claim_id,
      i.invoice_number,
      i.invoice_date,
      i.source_type invoice_source_type,
      i.subtotal invoice_subtotal,
      i.vat invoice_vat,
      i.total invoice_total,
      i.outstanding invoice_outstanding
    from eligible_payments p
    left join eligible_invoices i
      on i.id = p.invoice_id
      or (
        p.invoice_id is null
        and i.operation_key = p.payment_operation_key
        and i.operation_invoice_count = 1
      )
  ),
  linked_payments as (
    select p.*,
      coalesce(
        sum(p.amount) over (
          partition by p.linked_invoice_id
          order by p.payment_date, p.id
          rows between unbounded preceding and 1 preceding
        ), 0
      )::numeric paid_before
    from linked_payments_base p
  ),
  period_payment_recognition as (
    select p.*,
      case
        when p.linked_invoice_id is null or coalesce(p.invoice_total, 0) <= 0 then 0
        else least(p.amount, greatest(p.invoice_total - p.paid_before, 0))
      end::numeric recognized_gross
    from linked_payments p
    where p.payment_date between p_from and p_to
  ),
  payment_revenue_basis as (
    select
      p.*,
      case
        when p_business_type = 'cash' then least(
          p.recognized_gross,
          greatest(
            coalesce(p.invoice_vat, 0)
            - least(coalesce(p.paid_before, 0), coalesce(p.invoice_vat, 0)),
            0
          )
        )
        else p.recognized_gross * coalesce(p.invoice_vat / nullif(p.invoice_total, 0), 0)
      end::numeric recognized_vat_amount,
      case
        when p_business_type = 'cash' then greatest(
          p.recognized_gross - least(
            p.recognized_gross,
            greatest(
              coalesce(p.invoice_vat, 0)
              - least(coalesce(p.paid_before, 0), coalesce(p.invoice_vat, 0)),
              0
            )
          ),
          0
        )
        else p.recognized_gross * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0)
      end::numeric recognized_net
    from period_payment_recognition p
  ),
  eligible_expenses as (
    select e.*,
      lower(coalesce(e.expense_type,'') || ' ' || coalesce(e.category_name,'') || ' ' || coalesce(e.description,'')) classifier
    from public.reports_expense_facts_v1 e
    left join public.job_orders jo on jo.tenant_id=e.tenant_id and jo.id=e.work_order_id
    left join public.insurance_claims c on c.tenant_id=e.tenant_id and c.id=e.claim_id
    where e.tenant_id = v_tenant
      and e.deleted_at is null and e.archived_at is null
      and (jo.id is null or (jo.deleted_at is null and lower(coalesce(jo.status::text,'')) not in ('cancelled','canceled','deleted')))
      and (c.id is null or lower(coalesce(c.status::text,'')) not in ('cancelled','canceled','rejected','deleted'))
  ),
  eligible_period_expenses as (
    select e.* from eligible_expenses e where e.date between p_from and p_to
  ),
  direct_expenses as (
    select e.*
    from eligible_expenses e
    where e.business_type = p_business_type
      and e.expense_type <> 'workshop_general'
      and (e.work_order_id is not null or e.vehicle_id is not null)
  ),
  activity_operations as (
    select distinct
      coalesce(p.payment_operation_key, p.invoice_operation_key) operation_key,
      coalesce(p.work_order_id, p.invoice_work_order_id) work_order_id,
      coalesce(p.vehicle_id, p.invoice_vehicle_id) vehicle_id,
      coalesce(p.claim_id, p.invoice_claim_id) claim_id
    from period_payment_recognition p
    where coalesce(p.payment_operation_key, p.invoice_operation_key) is not null
  ),
  invoice_line_amounts as (
    select
      i.id,
      i.source_type,
      coalesce(sum(line.net_amount), 0)::numeric raw_line_total,
      coalesce(sum(line.net_amount) filter (where line.is_parts), 0)::numeric raw_parts_total
    from eligible_invoices i
    join activity_operations a on a.operation_key = i.operation_key
    left join public.sales_documents sd
      on i.source_type = 'customer_invoice' and sd.tenant_id = i.tenant_id and sd.id = i.id
    left join public.insurance_invoices ii
      on i.source_type = 'insurance_invoice' and ii.tenant_id = i.tenant_id and ii.id = i.id
    left join lateral (
      select
        (
          case when pg_input_is_valid(item->>'quantity', 'numeric')
            then greatest((item->>'quantity')::numeric, 0) else 1 end
          * case when pg_input_is_valid(coalesce(item->>'unitPrice', item->>'unit_price', item->>'price'), 'numeric')
              then greatest(coalesce(item->>'unitPrice', item->>'unit_price', item->>'price')::numeric, 0) else 0 end
          * (1 - least(greatest(case when pg_input_is_valid(item->>'discount', 'numeric')
              then (item->>'discount')::numeric else 0 end, 0), 100) / 100)
        )::numeric net_amount,
        (
          nullif(item->>'inventoryId', '') is not null
          or lower(coalesce(item->>'id', '')) like 'exp::%'
          or lower(concat_ws(' ', item->>'itemName', item->>'item_name', item->>'description', item->>'category', item->>'type')) ~ '(part|spare|قطع|غيار)'
        ) is_parts
      from jsonb_array_elements(
        case when i.source_type = 'customer_invoice' then coalesce(sd.items, '[]'::jsonb)
             when i.source_type = 'insurance_invoice' then coalesce(ii.items, '[]'::jsonb)
             else '[]'::jsonb end
      ) item
    ) line on true
    group by i.id, i.source_type
  ),
  payment_revenue_month as (
    select
      coalesce(p.payment_operation_key, p.invoice_operation_key) operation_key,
      sum(p.recognized_net)::numeric recognized_revenue_ex_vat,
      sum(p.recognized_vat_amount)::numeric recognized_vat,
      sum(p.settlement_discount_amount
          * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0))::numeric cost_release_discount_ex_vat,
      sum(
        p.recognized_net
        * case when lm.raw_line_total > 0 then lm.raw_parts_total / lm.raw_line_total else 0 end
      )::numeric parts_revenue,
      sum(
        p.recognized_net
        * (1 - case when lm.raw_line_total > 0 then lm.raw_parts_total / lm.raw_line_total else 0 end)
      )::numeric labor_revenue
    from payment_revenue_basis p
    left join invoice_line_amounts lm on lm.id = p.linked_invoice_id and lm.source_type = p.invoice_source_type
    group by 1
  ),
  payment_month as (
    select coalesce(p.payment_operation_key, p.invoice_operation_key) operation_key,
      sum(p.amount)::numeric collected
    from period_payment_recognition p
    group by 1
  ),
  invoice_context as (
    select i.operation_key,
      string_agg(distinct i.invoice_number, ', ' order by i.invoice_number) invoice_numbers,
      string_agg(distinct i.invoice_date::text, ', ' order by i.invoice_date::text) invoice_dates,
      sum(i.outstanding)::numeric outstanding,
      sum(i.subtotal)::numeric total_invoice_subtotal
    from eligible_invoices i
    join activity_operations a on a.operation_key = i.operation_key
    group by i.operation_key
  ),
  expense_lifetime as (
    select coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text) operation_key,
      coalesce(sum(e.subtotal) filter (where e.classifier ~ '(part|spare|قطع|غيار)'),0)::numeric parts_cost,
      coalesce(sum(e.subtotal) filter (where e.classifier ~ '(labou?r|wage|salary|عمال|أجر|اجور|أجور)'),0)::numeric labor_cost,
      coalesce(sum(e.subtotal) filter (where e.classifier !~ '(part|spare|قطع|غيار|labou?r|wage|salary|عمال|أجر|اجور|أجور)'),0)::numeric operating_cost
    from direct_expenses e
    join activity_operations a
      on a.operation_key = coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text)
    group by 1
  ),
  matched_cost_month as (
    select
      e.operation_key,
      (e.parts_cost * least(greatest(coalesce(pr.recognized_revenue_ex_vat,0) + coalesce(pr.cost_release_discount_ex_vat,0),0) / nullif(cx.total_invoice_subtotal,0),1))::numeric parts_cost,
      (e.labor_cost * least(greatest(coalesce(pr.recognized_revenue_ex_vat,0) + coalesce(pr.cost_release_discount_ex_vat,0),0) / nullif(cx.total_invoice_subtotal,0),1))::numeric labor_cost,
      (e.operating_cost * least(greatest(coalesce(pr.recognized_revenue_ex_vat,0) + coalesce(pr.cost_release_discount_ex_vat,0),0) / nullif(cx.total_invoice_subtotal,0),1))::numeric operating_cost
    from expense_lifetime e
    join payment_revenue_month pr on pr.operation_key=e.operation_key
    join invoice_context cx on cx.operation_key=e.operation_key
    where cx.total_invoice_subtotal > 0
  ),
  report_rows as (
    select
      a.operation_key operation_id,
      w.id work_order_id,
      w.order_number work_order_number,
      w.status work_order_status,
      coalesce(w.claim_id,a.claim_id) claim_id,
      coalesce(w.claim_number,c.claim_number) claim_number,
      coalesce(ic.name,c.insurance_company) insurance_company,
      cu.customer_code, cu.name customer_name, cu.phone customer_phone,
      v.id vehicle_id, v.plate_number, v.plate_letters, v.plate_country,
      v.brand, v.model, v.year, v.color, coalesce(v.vin,v.vin_number) vin,
      v.mileage, v.vehicle_type,
      w.received_at, w.delivered_at, w.workshop_days,
      cx.invoice_numbers, cx.invoice_dates,
      coalesce(pr.recognized_revenue_ex_vat,0)::numeric recognized_revenue_ex_vat,
      coalesce(pr.recognized_revenue_ex_vat,0)::numeric invoiced_ex_vat,
      coalesce(pr.labor_revenue,0)::numeric labor_revenue,
      coalesce(pr.parts_revenue,0)::numeric parts_revenue,
      coalesce(pr.recognized_vat,0)::numeric vat,
      (coalesce(pr.recognized_revenue_ex_vat,0)+coalesce(pr.recognized_vat,0))::numeric invoiced_total,
      coalesce(pm.collected,0)::numeric collected,
      coalesce(cx.outstanding,0)::numeric outstanding,
      coalesce(em.parts_cost,0)::numeric parts_cost,
      coalesce(em.labor_cost,0)::numeric labor_cost,
      coalesce(em.operating_cost,0)::numeric operating_cost,
      coalesce(em.operating_cost,0)::numeric external_direct_cost,
      (coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0))::numeric direct_cost,
      (coalesce(pr.recognized_revenue_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0))::numeric gross_profit,
      case when coalesce(pr.recognized_revenue_ex_vat,0)=0 then 0 else
        ((coalesce(pr.recognized_revenue_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0))/pr.recognized_revenue_ex_vat*100)::numeric end profit_margin,
      case
        when coalesce(pm.collected,0)>0 and coalesce(pr.recognized_revenue_ex_vat,0)=0 then 'payment_without_linked_invoice'
        when coalesce(pr.recognized_revenue_ex_vat,0)=0 and coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0)=0 then 'no_actual_financial_data'
        when coalesce(pr.recognized_revenue_ex_vat,0)=0 then 'monthly_cost_without_monthly_revenue'
        when coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0)=0 then 'monthly_revenue_without_monthly_costs'
        else 'actual_monthly_data_available'
      end accounting_status
    from activity_operations a
    left join valid_work_orders w on w.id=a.work_order_id
    left join public.vehicles v on v.tenant_id=v_tenant and v.id=coalesce(w.vehicle_id,a.vehicle_id)
    left join public.insurance_claims c on c.tenant_id=v_tenant and c.id=coalesce(w.claim_id,a.claim_id)
    left join public.customers cu on cu.tenant_id=v_tenant and cu.id=coalesce(w.customer_id,c.customer_id,v.customer_id)
    left join public.insurance_companies ic on ic.tenant_id=v_tenant and ic.id=c.insurance_company_id
    left join payment_revenue_month pr on pr.operation_key=a.operation_key
    left join payment_month pm on pm.operation_key=a.operation_key
    left join invoice_context cx on cx.operation_key=a.operation_key
    left join matched_cost_month em on em.operation_key=a.operation_key
    where v.id is not null
      -- A LEFT JOIN preserves unmatched rows. Reject an invalid linked parent
      -- explicitly instead of reviving its payments as a vehicle-only operation.
      and (a.work_order_id is null or w.id is not null)
      and (
        coalesce(w.claim_id, a.claim_id) is null
        or (c.id is not null and lower(coalesce(c.status::text, '')) not in ('cancelled','canceled','rejected','deleted'))
      )
      and (
        nullif(trim(coalesce(p_search,'')),'') is null
        or coalesce(w.order_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(c.claim_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cu.name,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cu.customer_code,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cu.phone,'') ilike '%'||trim(p_search)||'%'
        or coalesce(v.plate_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(v.plate_letters,'') ilike '%'||trim(p_search)||'%'
        or coalesce(v.vin,v.vin_number,'') ilike '%'||trim(p_search)||'%'
        or coalesce(cx.invoice_numbers,'') ilike '%'||trim(p_search)||'%'
      )
  ),
  page_rows as (
    select * from report_rows
    order by coalesce(invoice_dates,'') desc, work_order_number desc nulls last, plate_number
    offset (v_page-1)*v_page_size limit v_page_size
  ),
  overhead_rows as (
    select e.* from eligible_period_expenses e
    where e.expense_type='workshop_general' or (e.work_order_id is null and e.vehicle_id is null and e.claim_id is null)
  ),
  overhead_summary as (
    select
      coalesce(sum(subtotal) filter(where classifier ~ '(salary|payroll|wage|راتب|رواتب|أجور الموظف)'),0)::numeric salaries,
      coalesce(sum(subtotal) filter(where classifier ~ '(rent|lease|subscription|license|depreciation|إيجار|ايجار|اشتراك|رخص|استهلاك)'),0)::numeric fixed,
      coalesce(sum(subtotal) filter(where classifier ~ '(electric|water|telephone|internet|fuel|tool|maintenance|admin|utility|كهرب|ماء|هاتف|انترنت|وقود|أدوات|صيانة|إدار)'),0)::numeric operating,
      coalesce(sum(subtotal) filter(where classifier ~ '(part|spare|قطع|غيار)'),0)::numeric unlinked_parts,
      coalesce(sum(subtotal) filter(where classifier !~ '(salary|payroll|wage|راتب|رواتب|أجور الموظف|rent|lease|subscription|license|depreciation|إيجار|ايجار|اشتراك|رخص|استهلاك|electric|water|telephone|internet|fuel|tool|maintenance|admin|utility|كهرب|ماء|هاتف|انترنت|وقود|أدوات|صيانة|إدار|part|spare|قطع|غيار)'),0)::numeric other,
      coalesce(sum(subtotal),0)::numeric total
    from overhead_rows
  )
  select
    coalesce((select jsonb_agg(to_jsonb(page_rows)) from page_rows),'[]'::jsonb),
    coalesce((select count(*) from report_rows),0),
    coalesce((select jsonb_build_object(
      'recognized_revenue_ex_vat',sum(recognized_revenue_ex_vat),
      'invoiced_ex_vat',sum(invoiced_ex_vat),
      'labor_revenue',sum(labor_revenue),'parts_revenue',sum(parts_revenue),
      'vat',sum(vat),'invoiced_total',sum(invoiced_total),
      'collected',sum(collected),'outstanding',sum(outstanding),'parts_cost',sum(parts_cost),
      'labor_cost',sum(labor_cost),'operating_cost',sum(operating_cost),
      'external_direct_cost',sum(external_direct_cost),'direct_cost',sum(direct_cost),
      'gross_profit',sum(gross_profit),'vehicles',count(distinct vehicle_id)
    ) from report_rows),'{}'::jsonb),
    coalesce((select to_jsonb(overhead_summary) from overhead_summary),'{}'::jsonb)
  into v_rows,v_total,v_aggregates,v_overheads;

  return jsonb_build_object(
    'rows',v_rows,
    'aggregates',v_aggregates,
    'overheads',v_overheads,
    'pagination',jsonb_build_object('page',v_page,'pageSize',v_page_size,'totalRows',v_total,'totalPages',ceil(v_total::numeric/v_page_size)::integer),
    'basis','cash payments are VAT-inclusive as entered; full invoice VAT is recognized once from the earliest cash collection(s), partial payments change paid and outstanding only, and later collections do not repeat VAT; insurance keeps proportional VAT recognition; lifetime direct costs remain matched without duplication',
    'generatedAt',now()
  );
end;
$function$

;
-- COMPONENT supabase/migrations/20261104044624_accounting_guard_null_tenant_and_supplier_permission.sql SHA256 75917f1fdfbac29b87472bab0f304d598a10e1cb81875988170b5b3f1a7f4a4c
-- Authorization guards only. No operational row/number/posting changes.
-- Version aligned to the confirmed Development migration ledger.
-- Reviewed against Development and matching Production source fingerprints.
-- Existing signatures, grants, search paths and business bodies are preserved.
set local lock_timeout = '2s';
do $preflight$
begin
  if md5(replace(pg_get_functiondef('public.accounting_get_source_posting_snapshot_base(uuid,text,uuid)'::regprocedure), chr(13), '')) is distinct from '6c92d377cc5ac9d67024af4182c70f48' then
    raise exception 'ACCOUNTING_GUARD_DEFINITION_DRIFT: accounting_get_source_posting_snapshot_base(uuid,text,uuid)';
  end if;
  if md5(replace(pg_get_functiondef('public.is_accounting_source_eligible(uuid,text,uuid)'::regprocedure), chr(13), '')) is distinct from 'e50565db3180cdd916c464a3f36995ac' then
    raise exception 'ACCOUNTING_GUARD_DEFINITION_DRIFT: is_accounting_source_eligible(uuid,text,uuid)';
  end if;
  if md5(replace(pg_get_functiondef('public.reserve_receipt_number_rpc(uuid)'::regprocedure), chr(13), '')) is distinct from 'c9979504fb5a9df39ca539cfd84590e0' then
    raise exception 'ACCOUNTING_GUARD_DEFINITION_DRIFT: reserve_receipt_number_rpc(uuid)';
  end if;
end;
$preflight$;

CREATE OR REPLACE FUNCTION public.accounting_get_source_posting_snapshot_base(p_tenant_id uuid, p_source_type text, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_source_id is null
     or p_tenant_id is distinct from public.get_user_tenant_id() then
    raise exception 'ACCOUNTING_SOURCE_ACCESS_DENIED';
  end if;
  if public.accounting_has_permission('accounting.view_journal') is distinct from true then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;

  if lower(btrim(p_source_type)) = 'supplier_invoice' then
    if not public.is_accounting_source_eligible(p_tenant_id, 'supplier_invoice', p_source_id) then
      raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
    end if;

    select jsonb_build_object(
      'source_type', 'supplier_invoice',
      'source_id', i.id,
      'source_number', coalesce(nullif(i.supplier_invoice_number, ''), i.invoice_number),
      'source_status', i.status,
      'document_date', i.date,
      'net_amount', round(greatest(i.total - i.vat, 0), 3),
      'vat_amount', round(greatest(i.vat, 0), 3),
      'total_amount', round(i.total, 3),
      'amount', round(i.total, 3),
      'party_type', 'supplier',
      'party_id', i.supplier_id,
      'supplier_id', i.supplier_id,
      'purchase_invoice_id', i.id,
      'invoice_id', null,
      'business_type', 'purchase',
      'payment_mapping_key', null
    ) into v_result
    from public.purchase_invoices i
    where i.id = p_source_id
      and i.tenant_id = p_tenant_id
      and lower(coalesce(i.status, 'draft')) in ('received','approved','issued','partial','paid','overdue')
      and i.total > 0;

  elsif lower(btrim(p_source_type)) = 'supplier_payment' then
    if not public.is_accounting_source_eligible(p_tenant_id, 'supplier_payment', p_source_id) then
      raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
    end if;

    select jsonb_build_object(
      'source_type', 'supplier_payment',
      'source_id', p.id,
      'source_number', p.payment_number,
      'source_status', 'paid',
      'document_date', p.payment_date,
      'net_amount', round(p.amount, 3),
      'vat_amount', 0,
      'total_amount', round(p.amount, 3),
      'amount', round(p.amount, 3),
      'party_type', 'supplier',
      'party_id', coalesce(p.supplier_id, i.supplier_id),
      'supplier_id', coalesce(p.supplier_id, i.supplier_id),
      'purchase_invoice_id', p.purchase_invoice_id,
      'payment_id', p.id,
      'business_type', 'purchase',
      'payment_mapping_key', case lower(coalesce(p.payment_method, 'cash'))
        when 'cash' then 'cash_on_hand'
        when 'cash_payment' then 'cash_on_hand'
        when 'bank' then 'bank_account'
        when 'bank_transfer' then 'bank_account'
        when 'transfer' then 'bank_account'
        when 'cheque' then 'bank_account'
        when 'check' then 'bank_account'
        when 'card' then 'bank_account'
        else 'payment_clearing'
      end
    ) into v_result
    from public.supplier_payments p
    join public.purchase_invoices i
      on i.id = p.purchase_invoice_id and i.tenant_id = p.tenant_id
    where p.id = p_source_id
      and p.tenant_id = p_tenant_id
      and p.amount > 0;

  else
    v_result := public.accounting_get_source_posting_snapshot_phase2_core(
      p_tenant_id, lower(btrim(p_source_type)), p_source_id
    );
  end if;

  if v_result is null then
    raise exception 'ACCOUNTING_SOURCE_NOT_POSTABLE';
  end if;
  if coalesce((v_result->>'total_amount')::numeric, 0) <= 0 then
    raise exception 'ACCOUNTING_SOURCE_AMOUNT_INVALID';
  end if;
  return v_result;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_accounting_source_eligible(p_tenant_id uuid, p_source_type text, p_source_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_source jsonb;
  v_parent jsonb;
  v_parent_id text;
begin
  if p_tenant_id is null or p_source_id is null then
    return false;
  end if;
  if auth.uid() is not null and p_tenant_id is distinct from public.get_user_tenant_id() then
    return false;
  end if;

  case lower(p_source_type)
    when 'sales_invoice' then
      select to_jsonb(d) into v_source from public.sales_documents d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'cash_invoice' then
      select to_jsonb(d) into v_source from public.invoices d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'insurance_invoice' then
      select to_jsonb(d) into v_source from public.insurance_invoices d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'expense' then
      select to_jsonb(d) into v_source from public.expenses d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'supplier_invoice' then
      select to_jsonb(d) into v_source from public.purchase_invoices d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'sales_payment' then
      select to_jsonb(d) into v_source from public.sales_payments d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'claim_payment' then
      select to_jsonb(d) into v_source from public.claim_payments d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'supplier_payment' then
      select to_jsonb(d) into v_source from public.supplier_payments d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'work_order' then
      select to_jsonb(d) into v_source from public.job_orders d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'claim' then
      select to_jsonb(d) into v_source from public.insurance_claims d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'vehicle' then
      select to_jsonb(d) into v_source from public.vehicles d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'customer' then
      select to_jsonb(d) into v_source from public.customers d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'supplier' then
      select to_jsonb(d) into v_source from public.suppliers d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'manual_journal' then
      return true;
    when 'opening_balance' then
      select to_jsonb(d) into v_source from public.accounting_opening_balances d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'reversal' then
      select to_jsonb(d) into v_source from public.accounting_journal_entries d
      where d.id = p_source_id and d.tenant_id = p_tenant_id and d.status = 'posted';
    else
      return false;
  end case;

  if not public.accounting_json_record_is_active(v_source) then
    return false;
  end if;

  -- Resolve invoice/expense parent work order when present.
  v_parent_id := coalesce(v_source->>'work_order_id', v_source->>'linked_work_order_id');
  if nullif(v_parent_id, '') is not null then
    if v_parent_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select to_jsonb(w) into v_parent from public.job_orders w
      where w.id = v_parent_id::uuid and w.tenant_id = p_tenant_id;
    else
      select to_jsonb(w) into v_parent from public.job_orders w
      where w.order_number = v_parent_id and w.tenant_id = p_tenant_id
      order by w.created_at desc limit 1;
    end if;
    if not public.accounting_json_record_is_active(v_parent) then return false; end if;
  end if;

  -- Resolve claim parent when present.
  v_parent_id := v_source->>'claim_id';
  if nullif(v_parent_id, '') is not null then
    select to_jsonb(c) into v_parent from public.insurance_claims c
    where c.id = v_parent_id::uuid and c.tenant_id = p_tenant_id;
    if not public.accounting_json_record_is_active(v_parent) then return false; end if;
  end if;

  -- A payment is eligible only when its financial parent is eligible.
  if lower(p_source_type) = 'sales_payment' then
    v_parent_id := v_source->>'sales_document_id';
    return v_parent_id is not null
      and public.is_accounting_source_eligible(p_tenant_id, 'sales_invoice', v_parent_id::uuid);
  elsif lower(p_source_type) = 'supplier_payment' then
    v_parent_id := v_source->>'purchase_invoice_id';
    return v_parent_id is not null
      and public.is_accounting_source_eligible(p_tenant_id, 'supplier_invoice', v_parent_id::uuid);
  elsif lower(p_source_type) = 'claim_payment' then
    v_parent_id := coalesce(v_source->>'offset_against_invoice_id', v_source->>'invoice_id');
    if nullif(v_parent_id, '') is not null then
      return public.is_accounting_source_eligible(p_tenant_id, 'insurance_invoice', v_parent_id::uuid);
    end if;
    v_parent_id := v_source->>'claim_id';
    return v_parent_id is not null
      and public.is_accounting_source_eligible(p_tenant_id, 'claim', v_parent_id::uuid);
  end if;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_receipt_number_rpc(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare v_user_id uuid := auth.uid(); v_year integer := extract(year from current_timestamp at time zone 'Asia/Muscat')::integer; v_prefix text; v_padding integer; v_settings jsonb; v_next_from_settings bigint; v_highest_receipt bigint; v_highest_deposit bigint; v_floor bigint; v_allocated bigint; begin if v_user_id is null or p_tenant_id is null or p_tenant_id is distinct from public.get_user_tenant_id() then raise exception 'RECEIPT_TENANT_DENIED' using errcode = '42501'; end if; select value into v_settings from public.tenant_settings where tenant_id = p_tenant_id and key = 'alwafa_voucher_settings_v1'; v_prefix := upper(coalesce(nullif(trim(v_settings->>'receiptPrefix'), ''), 'RCV')); if v_prefix !~ '^[A-Z0-9]{1,10}$' then raise exception 'INVALID_RECEIPT_PREFIX' using errcode = '22023'; end if; v_padding := greatest(3, least(10, coalesce((v_settings->>'numberPadding')::integer, 4))); v_next_from_settings := greatest(1, coalesce((v_settings->>'receiptNextNumber')::bigint, 1)); select coalesce(max(split_part(receipt_number, '-', 3)::bigint), 0) into v_highest_receipt from public.accounting_receipts where tenant_id = p_tenant_id and receipt_number ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$'); select coalesce(max(split_part(entry->>'receiptNumber', '-', 3)::bigint), 0) into v_highest_deposit from public.tenant_settings settings, jsonb_array_elements(case when jsonb_typeof(settings.value) = 'array' then settings.value else '[]'::jsonb end) entry where settings.tenant_id = p_tenant_id and settings.key = 'alwafa_deposits_v1' and entry->>'receiptNumber' ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$'); v_floor := greatest(v_next_from_settings, v_highest_receipt + 1, v_highest_deposit + 1); insert into public.receipt_number_sequences (tenant_id, receipt_year, prefix, next_number) values (p_tenant_id, v_year, v_prefix, v_floor + 1) on conflict (tenant_id, receipt_year, prefix) do update set next_number = greatest(public.receipt_number_sequences.next_number, v_floor) + 1, updated_at = now() returning next_number - 1 into v_allocated; return v_prefix || '-' || v_year::text || '-' || lpad(v_allocated::text, v_padding, '0'); end; $function$;

;
-- COMPONENT supabase/migrations/20261105105822_production_rls_scalar_uid_verified.sql SHA256 eebdea27bbd1a9513a147db0aab5dec066ce693d86e219dc76f385b9da9251d4
-- Production counterpart, explicitly authorized 2026-11-05.
-- Independently verify the Production connection and exact catalogue fingerprints.
-- The original Development migration remains immutable; no historical data changes.
-- Exactly 54 previously inspected policies; no changes to roles, commands,
-- Version aligned to the verified Production migration ledger.
-- restrictive/permissive kind, tenant predicates or operational data.
-- The actual Production project was independently verified by the caller.
select set_config('security_audit.approved_project_ref','ifnfwssdtjuzdtshnrht',true);
-- CANDIDATE ONLY. No application or latency claim. Review selected IDs: 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48, 49, 50, 51, 52, 53, 54, 55.
-- Requires Main approval, actual Production connection verification and
-- SET LOCAL security_audit.approved_project_ref = 'ifnfwssdtjuzdtshnrht'
-- inside an explicit transaction. No roles/command/permissiveness changes.
do $rls_candidate$
declare item jsonb; existing record; statement text;
begin
  if current_setting('security_audit.approved_project_ref',true)
      is distinct from 'ifnfwssdtjuzdtshnrht' then
    raise exception 'PRODUCTION_APPROVAL_AND_PROJECT_PREFLIGHT_REQUIRED';
  end if;
  perform set_config('lock_timeout','2s',true);
  for item in select value from jsonb_array_elements('[{"id":1,"schema":"public","table":"whatsapp_webhook_events","policy":"admin read whatsapp webhook events","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = auth.uid()) AND (p.tenant_id = whatsapp_webhook_events.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = (select auth.uid())) AND (p.tenant_id = whatsapp_webhook_events.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":2,"schema":"public","table":"expense_category_template_items","policy":"expense_template_read","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(auth.uid() IS NOT NULL)","check_before":null,"using_after":"((select auth.uid()) IS NOT NULL)","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":3,"schema":"public","table":"journal_entries","policy":"journal_entries_block_low_roles","command":"SELECT","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"((NOT has_role(auth.uid(), ''customer''::app_role)) AND (NOT has_role(auth.uid(), ''technician''::app_role)) AND (NOT has_role(auth.uid(), ''supervisor''::app_role)) AND (NOT has_role(auth.uid(), ''insurance''::app_role)))","check_before":null,"using_after":"((NOT has_role((select auth.uid()), ''customer''::app_role)) AND (NOT has_role((select auth.uid()), ''technician''::app_role)) AND (NOT has_role((select auth.uid()), ''supervisor''::app_role)) AND (NOT has_role((select auth.uid()), ''insurance''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"financial_access"},{"id":4,"schema":"public","table":"journal_lines","policy":"journal_lines_block_low_roles","command":"SELECT","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"((NOT has_role(auth.uid(), ''customer''::app_role)) AND (NOT has_role(auth.uid(), ''technician''::app_role)) AND (NOT has_role(auth.uid(), ''supervisor''::app_role)) AND (NOT has_role(auth.uid(), ''insurance''::app_role)))","check_before":null,"using_after":"((NOT has_role((select auth.uid()), ''customer''::app_role)) AND (NOT has_role((select auth.uid()), ''technician''::app_role)) AND (NOT has_role((select auth.uid()), ''supervisor''::app_role)) AND (NOT has_role((select auth.uid()), ''insurance''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"financial_access"},{"id":5,"schema":"public","table":"purchase_invoices","policy":"Block tech/supervisor read purchase_invoices","command":"SELECT","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"((NOT has_role(auth.uid(), ''technician''::app_role)) AND (NOT has_role(auth.uid(), ''supervisor''::app_role)))","check_before":null,"using_after":"((NOT has_role((select auth.uid()), ''technician''::app_role)) AND (NOT has_role((select auth.uid()), ''supervisor''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"financial_access"},{"id":6,"schema":"public","table":"accounting_report_saved_views","policy":"accounting_report_saved_views_own","command":"ALL","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()) AND accounting_has_permission(''accounting_reports.saved_views''::text))","check_before":"((tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()) AND accounting_has_permission(''accounting_reports.saved_views''::text))","using_after":"((tenant_id = get_user_tenant_id()) AND (user_id = (select auth.uid())) AND accounting_has_permission(''accounting_reports.saved_views''::text))","check_after":"((tenant_id = get_user_tenant_id()) AND (user_id = (select auth.uid())) AND accounting_has_permission(''accounting_reports.saved_views''::text))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"financial_access"},{"id":7,"schema":"public","table":"user_roles","policy":"Users read own role or admin/manager reads all","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND ((user_id = auth.uid()) OR (get_user_role() = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND ((user_id = (select auth.uid())) OR (get_user_role() = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":8,"schema":"public","table":"work_order_supplements","policy":"block_customer_work_order_supplements","command":"ALL","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","check_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","using_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","check_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":9,"schema":"public","table":"supplement_approval_requests","policy":"block_customer_supplement_requests","command":"ALL","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","check_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","using_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","check_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":10,"schema":"public","table":"supplement_audit_logs","policy":"block_customer_supplement_audit","command":"ALL","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","check_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","using_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","check_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":11,"schema":"public","table":"workshop_belongings_settings","policy":"belongings_settings_delete_admin_manager","command":"DELETE","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"(has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))","check_before":null,"using_after":"(has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":12,"schema":"public","table":"workshop_belongings_settings","policy":"belongings_settings_update_admin_manager","command":"UPDATE","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"(has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))","check_before":"(has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))","using_after":"(has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))","check_after":"(has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":13,"schema":"public","table":"workshop_belongings_settings","policy":"belongings_settings_write_admin_manager","command":"INSERT","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"(has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))","using_after":null,"check_after":"(has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":14,"schema":"public","table":"workshop_belongings_settings","policy":"block_customer_belongings_settings","command":"ALL","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","check_before":"(NOT has_role(auth.uid(), ''customer''::app_role))","using_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","check_after":"(NOT has_role((select auth.uid()), ''customer''::app_role))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":15,"schema":"public","table":"customer_portal_tokens","policy":"tenant delete tokens","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND has_role(auth.uid(), ''admin''::app_role))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND has_role((select auth.uid()), ''admin''::app_role))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":16,"schema":"public","table":"tenant_settings","policy":"tenant_settings_delete","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND has_role(auth.uid(), ''admin''::app_role))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND has_role((select auth.uid()), ''admin''::app_role))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":17,"schema":"public","table":"profiles","policy":"Customer sees only own profile","command":"SELECT","roles":"{authenticated}","permissive":"RESTRICTIVE","development_present":true,"development_matches":true,"using_before":"((get_user_role() <> ''customer''::app_role) OR (user_id = auth.uid()))","check_before":null,"using_after":"((get_user_role() <> ''customer''::app_role) OR (user_id = (select auth.uid())))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":18,"schema":"public","table":"profiles","policy":"Users update own profile own fields","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(user_id = auth.uid())","check_before":"((user_id = auth.uid()) AND (role = ( SELECT p.role\n   FROM profiles p\n  WHERE (p.user_id = auth.uid()))) AND (tenant_id = ( SELECT p.tenant_id\n   FROM profiles p\n  WHERE (p.user_id = auth.uid()))))","using_after":"(user_id = (select auth.uid()))","check_after":"((user_id = (select auth.uid())) AND (role = ( SELECT p.role\n   FROM profiles p\n  WHERE (p.user_id = (select auth.uid())))) AND (tenant_id = ( SELECT p.tenant_id\n   FROM profiles p\n  WHERE (p.user_id = (select auth.uid())))))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":20,"schema":"public","table":"admin_notification_reads","policy":"users manage own reads","command":"ALL","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(user_id = auth.uid())","check_before":"(user_id = auth.uid())","using_after":"(user_id = (select auth.uid()))","check_after":"(user_id = (select auth.uid()))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":21,"schema":"public","table":"admin_notifications","policy":"admin or sender can delete admin notifications","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND ((sender_id = auth.uid()) OR has_role(auth.uid(), ''admin''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND ((sender_id = (select auth.uid())) OR has_role((select auth.uid()), ''admin''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":22,"schema":"public","table":"admin_notifications","policy":"admin/manager can create admin notifications","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND (sender_id = auth.uid()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role)))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND (sender_id = (select auth.uid())) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role)))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":23,"schema":"public","table":"job_orders","policy":"Managers delete job orders","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":24,"schema":"public","table":"job_orders","policy":"Staff read tenant job orders","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (NOT has_role(auth.uid(), ''customer''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (NOT has_role((select auth.uid()), ''customer''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":25,"schema":"public","table":"job_orders","policy":"Workshop staff create job orders","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role) OR has_role(auth.uid(), ''supervisor''::app_role) OR has_role(auth.uid(), ''technician''::app_role)))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role) OR has_role((select auth.uid()), ''supervisor''::app_role) OR has_role((select auth.uid()), ''technician''::app_role)))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":26,"schema":"public","table":"job_orders","policy":"Workshop staff update job orders","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role) OR has_role(auth.uid(), ''supervisor''::app_role) OR has_role(auth.uid(), ''technician''::app_role)))","check_before":"(tenant_id = get_user_tenant_id())","using_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role) OR has_role((select auth.uid()), ''supervisor''::app_role) OR has_role((select auth.uid()), ''technician''::app_role)))","check_after":"(tenant_id = get_user_tenant_id())","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"identity_and_workshop"},{"id":27,"schema":"public","table":"whatsapp_logs","policy":"admin read provider whatsapp logs","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = auth.uid()) AND (p.tenant_id = whatsapp_logs.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = (select auth.uid())) AND (p.tenant_id = whatsapp_logs.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":28,"schema":"public","table":"report_saved_views","policy":"Tenant users read report saved views","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND ((user_id = auth.uid()) OR is_shared))","check_before":null,"using_after":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND ((user_id = (select auth.uid())) OR is_shared))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":29,"schema":"public","table":"report_saved_views","policy":"Users create own report saved views","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))","using_after":null,"check_after":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = (select auth.uid())))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":30,"schema":"public","table":"report_saved_views","policy":"Users delete own report saved views","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))","check_before":null,"using_after":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = (select auth.uid())))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":31,"schema":"public","table":"report_saved_views","policy":"Users update own report saved views","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))","check_before":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = auth.uid()))","using_after":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = (select auth.uid())))","check_after":"(reports_has_permission(''reports.saved_views''::text) AND (tenant_id = get_user_tenant_id()) AND (user_id = (select auth.uid())))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":32,"schema":"public","table":"tenant_features","policy":"Tenant feature manage","command":"ALL","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))))","check_before":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))))","using_after":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))))","check_after":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":33,"schema":"public","table":"tenant_domains","policy":"Tenant domain manage","command":"ALL","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(auth.uid(), ''admin''::app_role)))","check_before":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(auth.uid(), ''admin''::app_role)))","using_after":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role((select auth.uid()), ''admin''::app_role)))","check_after":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role((select auth.uid()), ''admin''::app_role)))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":34,"schema":"public","table":"tenant_files","policy":"Tenant files manage","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))))","check_before":null,"using_after":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":35,"schema":"public","table":"admin_user_events","policy":"Admin events read","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role))))","check_before":null,"using_after":"(is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":36,"schema":"public","table":"compliance_record_types","policy":"compliance_record_types_insert","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND (created_by = auth.uid()) AND (get_user_role() = ANY (ARRAY[''admin''::app_role, ''manager''::app_role])))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND (created_by = (select auth.uid())) AND (get_user_role() = ANY (ARRAY[''admin''::app_role, ''manager''::app_role])))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":37,"schema":"public","table":"import_export_operations","policy":"import_export_operations_insert","command":"INSERT","roles":"{public}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id IN ( SELECT profiles.tenant_id\n   FROM profiles\n  WHERE (profiles.user_id = auth.uid()))) OR (EXISTS ( SELECT 1\n   FROM profiles\n  WHERE ((profiles.user_id = auth.uid()) AND (profiles.is_platform_admin = true)))))","using_after":null,"check_after":"((tenant_id IN ( SELECT profiles.tenant_id\n   FROM profiles\n  WHERE (profiles.user_id = (select auth.uid())))) OR (EXISTS ( SELECT 1\n   FROM profiles\n  WHERE ((profiles.user_id = (select auth.uid())) AND (profiles.is_platform_admin = true)))))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":38,"schema":"public","table":"import_export_operations","policy":"import_export_operations_select","command":"SELECT","roles":"{public}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id IN ( SELECT profiles.tenant_id\n   FROM profiles\n  WHERE (profiles.user_id = auth.uid()))) OR (EXISTS ( SELECT 1\n   FROM profiles\n  WHERE ((profiles.user_id = auth.uid()) AND (profiles.is_platform_admin = true)))))","check_before":null,"using_after":"((tenant_id IN ( SELECT profiles.tenant_id\n   FROM profiles\n  WHERE (profiles.user_id = (select auth.uid())))) OR (EXISTS ( SELECT 1\n   FROM profiles\n  WHERE ((profiles.user_id = (select auth.uid())) AND (profiles.is_platform_admin = true)))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":39,"schema":"public","table":"tenant_security_settings","policy":"tenant_security_settings_admin_update","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = auth.uid()) AND (p.tenant_id = tenant_security_settings.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_before":"(tenant_id = get_user_tenant_id())","using_after":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = (select auth.uid())) AND (p.tenant_id = tenant_security_settings.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_after":"(tenant_id = get_user_tenant_id())","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":40,"schema":"public","table":"tenant_security_settings","policy":"tenant_security_settings_admin_write","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = auth.uid()) AND (p.tenant_id = tenant_security_settings.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = (select auth.uid())) AND (p.tenant_id = tenant_security_settings.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":41,"schema":"public","table":"cloud_reset_audit_log","policy":"cloud_reset_audit_tenant_admin_read","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = auth.uid()) AND (p.tenant_id = cloud_reset_audit_log.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = (select auth.uid())) AND (p.tenant_id = cloud_reset_audit_log.tenant_id) AND (p.role = ANY (ARRAY[''admin''::app_role, ''manager''::app_role]))))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":42,"schema":"public","table":"security_otp_audit_log","policy":"owner admin read security otp audit","command":"SELECT","roles":"{public}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = auth.uid()) AND (p.tenant_id = security_otp_audit_log.tenant_id) AND ((p.role)::text = ANY (ARRAY[''admin''::text, ''owner''::text]))))))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (EXISTS ( SELECT 1\n   FROM profiles p\n  WHERE ((p.user_id = (select auth.uid())) AND (p.tenant_id = security_otp_audit_log.tenant_id) AND ((p.role)::text = ANY (ARRAY[''admin''::text, ''owner''::text]))))))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"settings_reports_admin"},{"id":43,"schema":"public","table":"accounting_receipts","policy":"accounting_receipts_delete_admin","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"financial_access"},{"id":44,"schema":"public","table":"accounting_receipts","policy":"accounting_receipts_update_tenant","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role)))","check_before":"(tenant_id = get_user_tenant_id())","using_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role)))","check_after":"(tenant_id = get_user_tenant_id())","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"financial_access"},{"id":45,"schema":"public","table":"app_trash","policy":"app_trash_delete_admin","command":"DELETE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":46,"schema":"public","table":"app_trash","policy":"app_trash_update_admin","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role)))","check_before":"(tenant_id = get_user_tenant_id())","using_after":"((tenant_id = get_user_tenant_id()) AND (has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role)))","check_after":"(tenant_id = get_user_tenant_id())","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"portal_notifications_other"},{"id":47,"schema":"public","table":"technician_time_logs","policy":"technician_time_logs_insert_self","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND ((technician_id = auth.uid()) OR (technician_id IS NULL)))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND ((technician_id = (select auth.uid())) OR (technician_id IS NULL)))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":48,"schema":"public","table":"technician_time_logs","policy":"technician_time_logs_select_scope","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND ((technician_id = auth.uid()) OR has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role) OR has_role(auth.uid(), ''supervisor''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND ((technician_id = (select auth.uid())) OR has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role) OR has_role((select auth.uid()), ''supervisor''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":49,"schema":"public","table":"technician_time_logs","policy":"technician_time_logs_update_scope","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND ((technician_id = auth.uid()) OR has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role) OR has_role(auth.uid(), ''supervisor''::app_role)))","check_before":"(tenant_id = get_user_tenant_id())","using_after":"((tenant_id = get_user_tenant_id()) AND ((technician_id = (select auth.uid())) OR has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role) OR has_role((select auth.uid()), ''supervisor''::app_role)))","check_after":"(tenant_id = get_user_tenant_id())","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":50,"schema":"public","table":"technician_notes","policy":"technician_notes_insert_self","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND ((technician_id = auth.uid()) OR (technician_id IS NULL)))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND ((technician_id = (select auth.uid())) OR (technician_id IS NULL)))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":51,"schema":"public","table":"technician_notes","policy":"technician_notes_select_scope","command":"SELECT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND (deleted_at IS NULL) AND ((technician_id = auth.uid()) OR has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role) OR has_role(auth.uid(), ''supervisor''::app_role)))","check_before":null,"using_after":"((tenant_id = get_user_tenant_id()) AND (deleted_at IS NULL) AND ((technician_id = (select auth.uid())) OR has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role) OR has_role((select auth.uid()), ''supervisor''::app_role)))","check_after":null,"disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":52,"schema":"public","table":"technician_notes","policy":"technician_notes_update_scope","command":"UPDATE","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":"((tenant_id = get_user_tenant_id()) AND ((technician_id = auth.uid()) OR has_role(auth.uid(), ''admin''::app_role) OR has_role(auth.uid(), ''manager''::app_role) OR has_role(auth.uid(), ''supervisor''::app_role)))","check_before":"(tenant_id = get_user_tenant_id())","using_after":"((tenant_id = get_user_tenant_id()) AND ((technician_id = (select auth.uid())) OR has_role((select auth.uid()), ''admin''::app_role) OR has_role((select auth.uid()), ''manager''::app_role) OR has_role((select auth.uid()), ''supervisor''::app_role)))","check_after":"(tenant_id = get_user_tenant_id())","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":53,"schema":"public","table":"document_links","policy":"document_links_insert","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"(document_file_accessible(tenant_id, file_id) AND (linked_by = auth.uid()))","using_after":null,"check_after":"(document_file_accessible(tenant_id, file_id) AND (linked_by = (select auth.uid())))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":54,"schema":"public","table":"document_files","policy":"document_files_insert","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"((tenant_id = get_user_tenant_id()) AND document_access_allowed(access_scope) AND (uploaded_by = auth.uid()))","using_after":null,"check_after":"((tenant_id = get_user_tenant_id()) AND document_access_allowed(access_scope) AND (uploaded_by = (select auth.uid())))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"},{"id":55,"schema":"public","table":"document_extractions","policy":"document_extractions_insert","command":"INSERT","roles":"{authenticated}","permissive":"PERMISSIVE","development_present":true,"development_matches":true,"using_before":null,"check_before":"(document_file_accessible(tenant_id, file_id) AND (uploaded_by = auth.uid()))","using_after":null,"check_after":"(document_file_accessible(tenant_id, file_id) AND (uploaded_by = (select auth.uid())))","disposition":"CONDITIONAL_SCALAR_UID_ONLY_NO_APPLY","cohort":"documents_technicians"}]'::jsonb)
  loop
    select * into existing from pg_policies
    where schemaname=item->>'schema' and tablename=item->>'table' and policyname=item->>'policy';
    if not found or existing.qual is distinct from item->>'using_before'
      or existing.with_check is distinct from item->>'check_before'
      or existing.cmd is distinct from item->>'command'
      or existing.permissive is distinct from item->>'permissive'
      or existing.roles::text is distinct from item->>'roles' then
      raise exception 'RLS_POLICY_PREFLIGHT_DRIFT: %',item->>'id';
    end if;
    statement := format('alter policy %I on %I.%I',item->>'policy',item->>'schema',item->>'table');
    if item->>'using_after' is not null then
      statement := statement || format(' using (%s)',item->>'using_after');
    end if;
    if item->>'check_after' is not null then
      statement := statement || format(' with check (%s)',item->>'check_after');
    end if;
    execute statement;
  end loop;
end;
$rls_candidate$;

;
-- COMPONENT supabase/migrations/20261105110041_production_profiles_select_policy_planning.sql SHA256 9f775c03573bc5d61ff72bd419fa16dfb433becb2de1fedfb6f0a03e75f1a0d2
-- Explicitly authorized Production counterpart; preserve the existing catalogue checks.
-- Preserve the working restrictive profile SELECT policy and self-update safety.
-- Version aligned to the confirmed Production migration ledger.
-- A scalar SubLink here regresses PostgreSQL UPDATE policy rewriting; the other
-- 53 reviewed scalar UID optimizations remain. No data/grant changes.
select set_config('security_audit.approved_project_ref','ifnfwssdtjuzdtshnrht',true);
-- CANDIDATE ONLY. Main approval and apply_migration on Production required.
-- Root: profiles UPDATE checks read profiles; a SubLink in its SELECT policy
-- makes PostgreSQL fireRIRrules re-enter the active profiles policy expansion.
-- Restore only ID 17's proven pre-change expression. Keep restrictive SELECT,
-- authenticated target, user-role/customer ownership, ID 18, and all other RLS.
-- No new helper, grant, role/tenant policy relaxation, or operational write.
do $profile_recursion_guard$
declare p record;
begin
  if current_setting('security_audit.approved_project_ref',true)
      is distinct from 'ifnfwssdtjuzdtshnrht' then raise exception 'PRODUCTION_ACK_REQUIRED';end if;
  select * into p from pg_policies where schemaname='public' and tablename='profiles'
    and policyname='Customer sees only own profile';
  if not found or p.cmd<>'SELECT' or p.permissive<>'RESTRICTIVE' or p.roles::text<>'{authenticated}'
    or p.with_check is not null
    or md5(coalesce(p.qual,'<null>')||chr(31)||coalesce(p.with_check,'<null>')) is distinct from '94d9c0d305e2a916b7c1ec09aa413c4d' then
    raise exception 'PROFILE_ID17_POST54_DEFINITION_DRIFT';
  end if;
  execute 'alter policy "Customer sees only own profile" on public.profiles using (((get_user_role() <> ''customer''::app_role) OR (user_id = auth.uid())))';
end;
$profile_recursion_guard$;

;
-- COMPONENT supabase/migrations/20261105105823_production_verified_redundant_indexes.sql SHA256 cd3f13bc553233e9e0d5a0b1eb1a8665989278b13ce6789b8e03bc1b4f392a9c
-- Production counterpart, explicitly authorized 2026-11-05.
-- Independently verify the Production connection and exact catalogue fingerprints.
-- The original Development migration remains immutable; no historical data changes.
-- Drop only two exact non-unique redundant copies after live catalog checks.
-- Version aligned to the confirmed Production migration ledger.
-- Operational rows, remaining coverage and all constraints are unchanged.
select set_config('security_audit.approved_project_ref','ifnfwssdtjuzdtshnrht',true);
-- Reviewed selective Production counterpart. Production-only, separately approve from 01.
-- Explicitly keep report_account_idx and tenant_active_created. No new index.
-- Execute only inside Main's approved transaction after connection verification
-- and SET LOCAL security_audit.approved_project_ref = 'ifnfwssdtjuzdtshnrht'.
-- Plain DROP is transactional but briefly locks; lock_timeout fails instead of
-- waiting indefinitely. This is NOT a Production/concurrent-drop runbook.
do $duplicate_index_candidate$
declare
  names text[];
  keep_oid regclass;
  drop_oid regclass;
  keep_row pg_index%rowtype;
  drop_row pg_index%rowtype;
  keep_def text;
  drop_def text;
begin
  if current_setting('security_audit.approved_project_ref', true)
      is distinct from 'ifnfwssdtjuzdtshnrht' then
    raise exception 'PRODUCTION_APPROVAL_AND_PROJECT_PREFLIGHT_REQUIRED';
  end if;
  perform set_config('lock_timeout', '2s', true);
  foreach names slice 1 in array array[
    array['public.accounting_journal_lines_report_account_idx','public.accounting_journal_lines_account_idx'],
    array['public.idx_job_orders_tenant_active_created','public.idx_job_orders_tenant_not_deleted']
  ]
  loop
    keep_oid := to_regclass(names[1]);
    drop_oid := to_regclass(names[2]);
    if keep_oid is null or drop_oid is null then
      raise exception 'DUPLICATE_INDEX_PREFLIGHT_MISSING: %', names;
    end if;
    select * into keep_row from pg_index where indexrelid=keep_oid;
    select * into drop_row from pg_index where indexrelid=drop_oid;
    keep_def := regexp_replace(pg_get_indexdef(keep_oid), '^CREATE INDEX [^ ]+ ON ', 'CREATE INDEX <name> ON ');
    drop_def := regexp_replace(pg_get_indexdef(drop_oid), '^CREATE INDEX [^ ]+ ON ', 'CREATE INDEX <name> ON ');
    if keep_def is distinct from drop_def
      or keep_row.indrelid is distinct from drop_row.indrelid
      or not keep_row.indisvalid or not keep_row.indisready
      or not drop_row.indisvalid or not drop_row.indisready
      or keep_row.indisunique or drop_row.indisunique
      or keep_row.indisprimary or drop_row.indisprimary
      or keep_row.indisexclusion or drop_row.indisexclusion
      or keep_row.indisreplident or drop_row.indisreplident
      or keep_row.indisclustered or drop_row.indisclustered then
      raise exception 'DUPLICATE_INDEX_CATALOG_DRIFT: %', names;
    end if;
    if exists(select 1 from pg_constraint where conindid in (keep_oid,drop_oid))
      or exists(select 1 from pg_depend
                where refclassid='pg_class'::regclass and refobjid=drop_oid) then
      raise exception 'DUPLICATE_INDEX_HAS_DEPENDENT: %', names[2];
    end if;
    execute format('drop index %s', drop_oid);
  end loop;
end;
$duplicate_index_candidate$;

;
-- COMPONENT supabase/migrations/20261105110112_production_document_active_profile_gate.sql SHA256 94195474f1a95f40e49b15575ccefa2933c0c48ffd94678fbf76790f1a8e1197
-- Production counterpart with transaction ownership left to the migration runner.
-- Same verified active-profile guard; no data writes and no internal commit.
-- Development-verified document permission gate. No user/profile/data repair.
-- Filename matches the observed Development ledger; no ledger edits.

set local lock_timeout='5s';
do $$ begin
  if md5(pg_get_functiondef('public.document_access_allowed(text)'::regprocedure))
      is distinct from '7ee262cd61fd3e6acf1bd7b3641ea4dd' then
    raise exception 'DOCUMENT_ACCESS_FUNCTION_DRIFT';
  end if;
end $$;
create or replace function public.document_access_allowed(p_scope text)
returns boolean language sql stable security invoker
set search_path to 'pg_catalog','public'
as $function$
  -- Match the application's active-profile gate server-side as well. An older
  -- still-valid JWT must not keep private document access after disablement.
  select exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid())
      and p.account_status='active' and p.disabled_at is null
  ) and case p_scope
    when 'operational' then public.get_user_role() in ('admin'::public.app_role,'manager'::public.app_role,'insurance'::public.app_role,'supervisor'::public.app_role)
    when 'finance' then public.get_user_role() in ('admin'::public.app_role,'manager'::public.app_role,'accountant'::public.app_role)
    when 'restricted' then public.get_user_role() in ('admin'::public.app_role,'manager'::public.app_role)
    else false
  end;
$function$;

;
-- COMPONENT supabase/migrations/20261104123558_profiles_rls_update_identity_without_self_recursion.sql SHA256 5c9ec4acb4dd92886cba59c8f765d7c383d5a47f380f9e6653c1f9d807902dc8
-- Remove the actual profiles UPDATE -> profiles SELECT policy recursion edge.
-- Schema/policy-only: no profile, user, role, tenant or operational row is changed.
-- Explicitly trialled on Development before selective application; never db push.
set local lock_timeout = '2s';
set local statement_timeout = '15s';

do $preflight$
declare item record; actual record;
begin
  for item in select * from (values
    ('Customer sees only own profile', 'SELECT', 'RESTRICTIVE', '0207e915ca81458d6db8faaa6fa79f80', 'd41d8cd98f00b204e9800998ecf8427e'),
    ('Users update own profile own fields', 'UPDATE', 'PERMISSIVE', '6a6b7c2a3a520c44377894171204e8d2', 'edc3179948d1829563dfa0bebb4a78ab'),
    ('Admins can update tenant profiles', 'UPDATE', 'PERMISSIVE', 'd64bf36a0b4d653a0cac448134e547ad', '25debd591b79f70f83b2c8dc8c473c47'),
    ('profiles restrict role change', 'UPDATE', 'RESTRICTIVE', 'b326b5062b2f0e69046810717534cb09', '5338eb21240997b3b59b990b94b68fae')
  ) as expected(name, command, kind, qual_hash, check_hash)
  loop
    select * into actual from pg_policies where schemaname='public'
      and tablename='profiles' and policyname=item.name;
    if not found or actual.cmd <> item.command or actual.permissive <> item.kind
      or actual.roles::text <> '{authenticated}'
      or md5(coalesce(actual.qual,'')) <> item.qual_hash
      or md5(coalesce(actual.with_check,'')) <> item.check_hash then
      raise exception 'PROFILE_POLICY_DRIFT: %', item.name;
    end if;
  end loop;
  if to_regprocedure('app_private.profile_update_identity(uuid)') is not null then
    raise exception 'PROFILE_IDENTITY_HELPER_ALREADY_EXISTS';
  end if;
  if has_schema_privilege('authenticated','app_private','create')
    or has_schema_privilege('anon','app_private','usage') then
    raise exception 'PRIVATE_SCHEMA_PRIVILEGE_DRIFT';
  end if;
end $preflight$;

-- Narrow old-row identity lookup, not a general RLS bypass or exposed RPC.
-- Only the caller's own row or an admin's same-tenant target is visible. This
-- follows the existing UPDATE predicates, not user-editable JWT metadata.
create function app_private.profile_update_identity(p_profile_id uuid)
returns table (previous_role public.app_role, previous_tenant uuid)
language sql stable security definer
set search_path = ''
as $function$
  select p.role, p.tenant_id
  from public.profiles p
  where p.id = p_profile_id
    and (select auth.uid()) is not null
    and p.tenant_id = public.get_user_tenant_id()
    and (p.user_id = (select auth.uid()) or public.get_user_role() = 'admin'::public.app_role)
$function$;
revoke all on function app_private.profile_update_identity(uuid) from public, anon;
grant usage on schema app_private to authenticated;
grant execute on function app_private.profile_update_identity(uuid) to authenticated;

alter policy "Users update own profile own fields" on public.profiles
with check (
  user_id = (select auth.uid())
  and role = (select i.previous_role from app_private.profile_update_identity(id) i)
  and tenant_id = (select i.previous_tenant from app_private.profile_update_identity(id) i)
);
alter policy "Admins can update tenant profiles" on public.profiles
with check (
  tenant_id = public.get_user_tenant_id() and public.get_user_role() = 'admin'::public.app_role
  and role = (select i.previous_role from app_private.profile_update_identity(id) i)
);
alter policy "profiles restrict role change" on public.profiles
with check (
  role = (select i.previous_role from app_private.profile_update_identity(id) i)
  or public.get_user_role() = 'admin'::public.app_role
);
alter policy "Customer sees only own profile" on public.profiles
using (public.get_user_role() <> 'customer'::public.app_role or user_id = (select auth.uid()));

comment on function app_private.profile_update_identity(uuid) is
  'Internal old-row identity for profiles UPDATE RLS; scoped to self/same-tenant admin. Avoids recursive policy SubLinks. Not a public API.';

;
-- COMPONENT supabase/migrations/20261104124329_expense_work_order_lookup_rls_parity_and_private_dedupe_acl.sql SHA256 0c732a89cf96f021d4daec829344d970b3112e14582bdb5cee8313a5f00be25e
-- Enforce the existing job_orders SELECT policy in its definer search API.
-- No new business permission; preserve staff lookup, bounds, joins and output.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $lookup_guard$
declare original text; patched text;
begin
  original:=pg_get_functiondef('public.expense_work_order_search_rpc(text,integer)'::regprocedure);
  if md5(replace(original,chr(13),'')) <> '6d33d78c8b7bfd0e78c29573bfedce68' then
    raise exception 'EXPENSE_WORK_ORDER_LOOKUP_DEFINITION_DRIFT';end if;
  patched:=replace(original,
    'where j.tenant_id=public.get_user_tenant_id() and j.deleted_at is null',
    'where j.tenant_id=public.get_user_tenant_id() and j.deleted_at is null
    and auth.uid() is not null
    and public.get_user_role() <> ''customer''::public.app_role
    and not public.has_role(auth.uid(), ''customer''::public.app_role)');
  if patched=original then raise exception 'EXPENSE_LOOKUP_GUARD_NOT_CHANGED';end if;
  execute patched;
end $lookup_guard$;

-- Only unified-message-send's service client consumes this private table.
-- RLS stays enabled/default-deny; no artificial deny policy to hide its INFO.
-- Revoke unnecessary browser grants including TRUNCATE (not governed by RLS).
revoke all on table public.message_idempotency_keys from public,anon,authenticated;

;
-- COMPONENT supabase/migrations/20261105110304_production_signup_isolation_verified.sql SHA256 57b5cda84e9521861bc56f6b5e6a1a413f01cc157579bb7a2f837c29bfe7fc5d
-- Production source is byte-equivalent after CRLF normalization, verified read-only.
-- Preserve the original reviewed hash, trigger binding and the tested fixed body.
-- Source-only candidate. Main must coordinate this with the paired manage-users
-- change on verified Development; do not apply/deploy either half in isolation.
-- No existing account, tenant, role, policy or Auth configuration is changed.
do $preflight$
begin
  if pg_catalog.md5(replace(pg_catalog.pg_get_functiondef('public.handle_new_user()'::regprocedure),chr(13),''))
     <> '01fbc7293f1c21dc236c112ef10190c7' then
    raise exception 'AUTH_SIGNUP_TRIGGER_SOURCE_DRIFT';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgrelid = 'auth.users'::regclass
      and tgname = 'on_auth_user_created'
      and tgfoid = 'public.handle_new_user()'::regprocedure
      and tgtype = 5 -- AFTER INSERT, FOR EACH ROW
      and tgenabled = 'O'
  ) then
    raise exception 'AUTH_SIGNUP_TRIGGER_BINDING_DRIFT';
  end if;
end;
$preflight$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_tenant_id uuid;
begin
  -- This USER-EDITABLE marker only REDUCES access: no profile, tenant or role.
  -- It is NOT evidence of an admin request. Public callers may also opt out.
  -- manage-users supplies it to BOTH createUser.user_metadata and invite.data,
  -- then provisions through a separately authorized, checked service-side write.
  -- Do not infer authority from the Auth DB actor or invited_at. Admin Auth can
  -- apply app_metadata/invited_at AFTER INSERT, too late for this trigger.
  if NEW.raw_user_meta_data->>'profile_provisioning' = 'manage-users' then
    return NEW;
  end if;

  -- Preserve the existing fresh-workshop owner default, but never join/create
  -- a caller-selected tenant and never derive authorization from user metadata.
  v_tenant_id := pg_catalog.gen_random_uuid();
  insert into public.tenants (id, name)
  values (v_tenant_id, coalesce(NEW.raw_user_meta_data->>'company_name', 'ورشتي'));
  -- No ON CONFLICT reuse: a UUID collision must fail, not attach to a tenant.
  insert into public.profiles (user_id, tenant_id, full_name, role, is_platform_admin)
  values (
    NEW.id,
    v_tenant_id,
    coalesce(NEW.raw_user_meta_data->>'full_name', ''),
    'admin'::public.app_role,
    false
  );
  return NEW;
end;
$function$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

;
-- COMPONENT supabase/migrations/20261104130809_profiles_browser_authority_fields_guard.sql SHA256 7a5d4625760a3acc552ef4254f3282f6d8e649cace801a1c4004c284fedfd8b0
-- Browser-editable profile details are not a platform/account-management API.
-- Prevent self platform escalation (proved on Development) and reactivation.
-- Trusted Auth/service-side provisioning and existing tenant/role RLS remain.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $preflight$
begin
  if to_regprocedure('public.guard_profile_authority_fields()') is not null
    or exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
      and tgname='trg_profile_authority_fields') then
    raise exception 'PROFILE_AUTHORITY_GUARD_ALREADY_EXISTS';end if;
  if not exists(select 1 from pg_trigger where tgrelid='public.profiles'::regclass
      and tgname='prevent_self_role_escalation_trg' and tgenabled='O') then
    raise exception 'EXISTING_ROLE_TENANT_GUARD_REQUIRED';end if;
end $preflight$;

create function public.guard_profile_authority_fields()
returns trigger language plpgsql security definer set search_path=''
as $function$
declare
  browser_actor boolean := coalesce(auth.role(),'') in ('anon','authenticated')
    or coalesce(current_setting('role',true),'') in ('anon','authenticated');
begin
  if browser_actor then
    if TG_OP='INSERT' then
      if NEW.is_platform_admin or NEW.account_status is distinct from 'active'
        or NEW.disabled_at is not null or NEW.disabled_by is not null or NEW.invited_at is not null then
        raise exception 'PROFILE_AUTHORITY_FIELDS_SERVICE_ONLY' using errcode='42501';
      end if;
    else
      if NEW.user_id is distinct from OLD.user_id
        or NEW.is_platform_admin is distinct from OLD.is_platform_admin
        or NEW.account_status is distinct from OLD.account_status
        or NEW.disabled_at is distinct from OLD.disabled_at
        or NEW.disabled_by is distinct from OLD.disabled_by
        or NEW.invited_at is distinct from OLD.invited_at then
        raise exception 'PROFILE_AUTHORITY_FIELDS_SERVICE_ONLY' using errcode='42501';
      end if;
    end if;
  end if;
  return NEW;
end $function$;
revoke all on function public.guard_profile_authority_fields() from public,anon,authenticated;
create trigger trg_profile_authority_fields before insert or update on public.profiles
for each row execute function public.guard_profile_authority_fields();

;
-- COMPONENT supabase/migrations/20261105082707_active_profile_identity_gate.sql SHA256 462b2fda174926c5da86bb8b0a307e198fc45dd2f37549bad43e860b779698d7
-- Resolve authorization from an active database profile, never stale role rows.
-- No user/profile/tenant/role records, grants, invoice numbers or postings change.
set local lock_timeout='2s';
set local statement_timeout='15s';

do $preflight$
declare item record;
begin
  for item in select * from (values
    ('public.get_user_role()','f7a0817003d29872d60e4c174f69b2b3'),
    ('public.get_user_tenant_id()','26d361a3d365f1293bb48ea55cabbc7b'),
    ('public.has_role(uuid,public.app_role)','cfe1e05060299d5f5bfc9043653cd8e1'),
    ('public.is_platform_admin()','f1bdb6517384b8202fe29d385ba28908')
  ) expected(signature,source_hash) loop
    if to_regprocedure(item.signature) is null or
      md5(replace(pg_get_functiondef(to_regprocedure(item.signature)),chr(13),'')) is distinct from item.source_hash then
      raise exception 'IDENTITY_GATE_SOURCE_DRIFT: %',item.signature;
    end if;
  end loop;
end $preflight$;

create or replace function public.get_user_tenant_id()
returns uuid language sql stable security definer set search_path=''
as $function$
  select p.tenant_id from public.profiles p
  where p.user_id=(select auth.uid())
    and p.account_status='active' and p.disabled_at is null
  limit 1;
$function$;

create or replace function public.get_user_role()
returns public.app_role language sql stable security definer set search_path=''
as $function$
  select coalesce((
    select ur.role from public.user_roles ur
    where ur.user_id=p.user_id and ur.tenant_id=p.tenant_id
    order by case ur.role
      when 'admin' then 1 when 'manager' then 2 when 'supervisor' then 3
      when 'technician' then 4 when 'insurance' then 5 else 99 end
    limit 1
  ),p.role)
  from public.profiles p
  where p.user_id=(select auth.uid())
    and p.account_status='active' and p.disabled_at is null
  limit 1;
$function$;

create or replace function public.has_role(_user_id uuid,_role public.app_role)
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists (
    select 1 from public.user_roles ur
    join public.profiles p on p.user_id=ur.user_id and p.tenant_id=ur.tenant_id
    where ur.user_id=_user_id and ur.role=_role
      and ur.tenant_id=public.get_user_tenant_id()
      and p.account_status='active' and p.disabled_at is null
  );
$function$;

create or replace function public.is_platform_admin()
returns boolean language sql stable security definer set search_path=''
as $function$
  select exists (
    select 1 from public.profiles p
    where p.user_id=(select auth.uid()) and p.is_platform_admin
      and p.account_status='active' and p.disabled_at is null
  );
$function$;

;
-- COMPONENT supabase/migrations/20261105082709_consolidate_role_scoped_permissive_policies.sql SHA256 7c891d717bbf67e9fa3434a219b3b87bb1e203c106ba641023d0316a18459f02
-- Development-verified equivalent RLS command projection. No row/grant changes.

-- Preserve OR semantics of every original PERMISSIVE policy and all RESTRICTIVE policies.

-- ALL policies are expanded per command; INSERT/UPDATE retain implicit USING-as-CHECK.

set local lock_timeout='2s';

set local statement_timeout='30s';

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_account_mappings' and permissive='PERMISSIVE') is distinct from 'be546d56d700586a3b2fc1825ae7e656' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_account_mappings'; end if; end $preflight$;

drop policy "accounting_mappings_manage" on public."accounting_account_mappings";

drop policy "accounting_mappings_read" on public."accounting_account_mappings";

create policy "rls_accounting_account_mappings_select" on public."accounting_account_mappings" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_account_mappings_insert" on public."accounting_account_mappings" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_account_mappings_update" on public."accounting_account_mappings" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_account_mappings_delete" on public."accounting_account_mappings" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_accounts' and permissive='PERMISSIVE') is distinct from '5030410178ca420a84df2ed847d90327' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_accounts'; end if; end $preflight$;

drop policy "accounting_accounts_manage" on public."accounting_accounts";

drop policy "accounting_accounts_read" on public."accounting_accounts";

create policy "rls_accounting_accounts_select" on public."accounting_accounts" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_accounts_insert" on public."accounting_accounts" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))));

create policy "rls_accounting_accounts_update" on public."accounting_accounts" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))));

create policy "rls_accounting_accounts_delete" on public."accounting_accounts" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_accounts'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_cash_bank_accounts' and permissive='PERMISSIVE') is distinct from '4cbf615cf897d1ef7ebee8374f50fbe9' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_cash_bank_accounts'; end if; end $preflight$;

drop policy "accounting_cash_bank_accounts_manage" on public."accounting_cash_bank_accounts";

drop policy "accounting_cash_bank_accounts_read" on public."accounting_cash_bank_accounts";

create policy "rls_accounting_cash_bank_accounts_select" on public."accounting_cash_bank_accounts" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_cash_bank_accounts_insert" on public."accounting_cash_bank_accounts" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_cash_bank_accounts_update" on public."accounting_cash_bank_accounts" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_cash_bank_accounts_delete" on public."accounting_cash_bank_accounts" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_cost_centers' and permissive='PERMISSIVE') is distinct from '766773ac814a3b3264d4bd5a64f6d814' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_cost_centers'; end if; end $preflight$;

drop policy "accounting_cost_centers_manage" on public."accounting_cost_centers";

drop policy "accounting_cost_centers_read" on public."accounting_cost_centers";

create policy "rls_accounting_cost_centers_select" on public."accounting_cost_centers" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_cost_centers_insert" on public."accounting_cost_centers" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))));

create policy "rls_accounting_cost_centers_update" on public."accounting_cost_centers" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))));

create policy "rls_accounting_cost_centers_delete" on public."accounting_cost_centers" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_cost_centers'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_fiscal_years' and permissive='PERMISSIVE') is distinct from '3896166398cf8df32544f063efbcbee6' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_fiscal_years'; end if; end $preflight$;

drop policy "accounting_fiscal_years_manage" on public."accounting_fiscal_years";

drop policy "accounting_fiscal_years_read" on public."accounting_fiscal_years";

create policy "rls_accounting_fiscal_years_select" on public."accounting_fiscal_years" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_fiscal_years_insert" on public."accounting_fiscal_years" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))));

create policy "rls_accounting_fiscal_years_update" on public."accounting_fiscal_years" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))));

create policy "rls_accounting_fiscal_years_delete" on public."accounting_fiscal_years" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_fiscal_years'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_journal_lines' and permissive='PERMISSIVE') is distinct from '530763c49b36f691d23c210cf1ec8448' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_journal_lines'; end if; end $preflight$;

drop policy "accounting_journal_lines_read" on public."accounting_journal_lines";

drop policy "accounting_journal_lines_write" on public."accounting_journal_lines";

create policy "rls_accounting_journal_lines_select" on public."accounting_journal_lines" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_journal_lines_insert" on public."accounting_journal_lines" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))));

create policy "rls_accounting_journal_lines_update" on public."accounting_journal_lines" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))));

create policy "rls_accounting_journal_lines_delete" on public."accounting_journal_lines" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.create_journal'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_opening_balance_batches' and permissive='PERMISSIVE') is distinct from '9e0c0b65ede2a1cfc57338b82b828392' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_opening_balance_batches'; end if; end $preflight$;

drop policy "accounting_opening_balance_batches_manage" on public."accounting_opening_balance_batches";

drop policy "accounting_opening_balance_batches_read" on public."accounting_opening_balance_batches";

create policy "rls_accounting_opening_balance_batches_select" on public."accounting_opening_balance_batches" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (accounting_has_permission('accounting.manage_opening_balances'::text) OR accounting_has_permission('accounting.view_journal'::text)))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balance_batches_insert" on public."accounting_opening_balance_batches" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balance_batches_update" on public."accounting_opening_balance_batches" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balance_batches_delete" on public."accounting_opening_balance_batches" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_opening_balances' and permissive='PERMISSIVE') is distinct from 'fd5ca2c0db718d8f6886664744ab77b4' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_opening_balances'; end if; end $preflight$;

drop policy "accounting_opening_balances_manage" on public."accounting_opening_balances";

drop policy "accounting_opening_balances_read" on public."accounting_opening_balances";

create policy "rls_accounting_opening_balances_select" on public."accounting_opening_balances" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_opening_balances_insert" on public."accounting_opening_balances" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balances_update" on public."accounting_opening_balances" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

create policy "rls_accounting_opening_balances_delete" on public."accounting_opening_balances" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_opening_balances'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_payment_method_mappings' and permissive='PERMISSIVE') is distinct from '9d7b6cb4ece1ac06e9b2b654e36d9f41' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_payment_method_mappings'; end if; end $preflight$;

drop policy "accounting_payment_method_mappings_manage" on public."accounting_payment_method_mappings";

drop policy "accounting_payment_method_mappings_read" on public."accounting_payment_method_mappings";

create policy "rls_accounting_payment_method_mappings_select" on public."accounting_payment_method_mappings" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_payment_method_mappings_insert" on public."accounting_payment_method_mappings" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_payment_method_mappings_update" on public."accounting_payment_method_mappings" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_payment_method_mappings_delete" on public."accounting_payment_method_mappings" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_periods' and permissive='PERMISSIVE') is distinct from '06a77d2ae2b780a567eeace9a59ce4a6' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_periods'; end if; end $preflight$;

drop policy "accounting_periods_manage" on public."accounting_periods";

drop policy "accounting_periods_read" on public."accounting_periods";

create policy "rls_accounting_periods_select" on public."accounting_periods" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_periods_insert" on public."accounting_periods" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))));

create policy "rls_accounting_periods_update" on public."accounting_periods" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))));

create policy "rls_accounting_periods_delete" on public."accounting_periods" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_periods'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_posting_rules' and permissive='PERMISSIVE') is distinct from 'e23292b0699b0430147bdce1c69c3a5c' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_posting_rules'; end if; end $preflight$;

drop policy "accounting_posting_rules_manage" on public."accounting_posting_rules";

drop policy "accounting_posting_rules_read" on public."accounting_posting_rules";

create policy "rls_accounting_posting_rules_select" on public."accounting_posting_rules" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))) OR (((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.view_journal'::text))));

create policy "rls_accounting_posting_rules_insert" on public."accounting_posting_rules" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_posting_rules_update" on public."accounting_posting_rules" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text)))) with check ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

create policy "rls_accounting_posting_rules_delete" on public."accounting_posting_rules" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND accounting_has_permission('accounting.manage_mappings'::text))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='accounting_role_permissions' and permissive='PERMISSIVE') is distinct from 'e9b44e16829b4ffd54a31b64928e7f68' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: accounting_role_permissions'; end if; end $preflight$;

drop policy "accounting_role_permissions_manage" on public."accounting_role_permissions";

drop policy "accounting_role_permissions_read" on public."accounting_role_permissions";

create policy "rls_accounting_role_permissions_select" on public."accounting_role_permissions" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_accounting_role_permissions_insert" on public."accounting_role_permissions" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_accounting_role_permissions_update" on public."accounting_role_permissions" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_accounting_role_permissions_delete" on public."accounting_role_permissions" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='app_versions' and permissive='PERMISSIVE') is distinct from 'ca383310a1d43ae3e01c22fc9bf8b72b' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: app_versions'; end if; end $preflight$;

drop policy "app_versions_admin_manage" on public."app_versions";

drop policy "app_versions_tenant_read" on public."app_versions";

create policy "rls_app_versions_select" on public."app_versions" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR ((tenant_id = get_user_tenant_id())));

create policy "rls_app_versions_insert" on public."app_versions" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_app_versions_update" on public."app_versions" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_app_versions_delete" on public."app_versions" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='customer_notification_settings' and permissive='PERMISSIVE') is distinct from 'cff6a75b76b9856e9ca0200d9d7a2a7f' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: customer_notification_settings'; end if; end $preflight$;

drop policy "tenant manage settings" on public."customer_notification_settings";

drop policy "tenant read settings" on public."customer_notification_settings";

create policy "rls_customer_notification_settings_select" on public."customer_notification_settings" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_customer_notification_settings_insert" on public."customer_notification_settings" as permissive for insert to authenticated with check (((tenant_id = get_user_tenant_id())));

create policy "rls_customer_notification_settings_update" on public."customer_notification_settings" as permissive for update to authenticated using (((tenant_id = get_user_tenant_id()))) with check (((tenant_id = get_user_tenant_id())));

create policy "rls_customer_notification_settings_delete" on public."customer_notification_settings" as permissive for delete to authenticated using (((tenant_id = get_user_tenant_id())));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='customers' and permissive='PERMISSIVE') is distinct from '2222283b0c71e56e903e1ca0bd52b10f' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: customers'; end if; end $preflight$;

drop policy "Admin delete customers" on public."customers";

drop policy "Staff insert customers" on public."customers";

drop policy "Staff update customers" on public."customers";

drop policy "Supervisor insert customers" on public."customers";

drop policy "Supervisor update customers" on public."customers";

drop policy "Tenant access customers" on public."customers";

create policy "rls_customers_select" on public."customers" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND ((get_user_role() <> 'customer'::app_role) OR (email = get_user_email())))));

create policy "rls_customers_insert" on public."customers" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_customers_update" on public."customers" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_customers_delete" on public."customers" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='damage_markers' and permissive='PERMISSIVE') is distinct from 'eade2f1448777a0cbc9639e403bc42a2' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: damage_markers'; end if; end $preflight$;

drop policy "Admins/managers delete damage_markers" on public."damage_markers";

drop policy "Admins/managers update damage_markers" on public."damage_markers";

drop policy "Staff insert damage_markers" on public."damage_markers";

drop policy "Supervisor insert damage_markers" on public."damage_markers";

drop policy "Tenant access damage_markers" on public."damage_markers";

create policy "rls_damage_markers_select" on public."damage_markers" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_damage_markers_insert" on public."damage_markers" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_damage_markers_update" on public."damage_markers" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

create policy "rls_damage_markers_delete" on public."damage_markers" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='estimate_sequences' and permissive='PERMISSIVE') is distinct from 'e8a5cb384b84f1cd86d30ce28da48826' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: estimate_sequences'; end if; end $preflight$;

drop policy "Staff manage estimate sequences" on public."estimate_sequences";

drop policy "Tenant read estimate sequences" on public."estimate_sequences";

create policy "rls_estimate_sequences_select" on public."estimate_sequences" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))) OR ((tenant_id = get_user_tenant_id())));

create policy "rls_estimate_sequences_insert" on public."estimate_sequences" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_estimate_sequences_update" on public."estimate_sequences" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_estimate_sequences_delete" on public."estimate_sequences" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='inspections' and permissive='PERMISSIVE') is distinct from 'ea9480b84c6b1e09a9d84d0884e150e7' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: inspections'; end if; end $preflight$;

drop policy "Admin delete inspections" on public."inspections";

drop policy "Staff insert inspections" on public."inspections";

drop policy "Staff update inspections" on public."inspections";

drop policy "Supervisor insert inspections" on public."inspections";

drop policy "Supervisor update inspections" on public."inspections";

drop policy "Tenant access inspections" on public."inspections";

create policy "rls_inspections_select" on public."inspections" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_inspections_insert" on public."inspections" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_inspections_update" on public."inspections" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_inspections_delete" on public."inspections" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='insurance_claims' and permissive='PERMISSIVE') is distinct from 'c55098037ad14cd92ebda1b10e880c3a' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: insurance_claims'; end if; end $preflight$;

drop policy "Admin delete insurance_claims" on public."insurance_claims";

drop policy "Staff insert insurance_claims" on public."insurance_claims";

drop policy "Staff update insurance_claims" on public."insurance_claims";

drop policy "Supervisor insert insurance_claims" on public."insurance_claims";

drop policy "Supervisor update insurance_claims" on public."insurance_claims";

drop policy "Tenant access insurance_claims" on public."insurance_claims";

create policy "rls_insurance_claims_select" on public."insurance_claims" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND ((get_user_role() <> 'customer'::app_role) OR (customer_id IN ( SELECT c.id
   FROM customers c
  WHERE ((c.tenant_id = get_user_tenant_id()) AND (c.email = get_user_email()))))))));

create policy "rls_insurance_claims_insert" on public."insurance_claims" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role, 'insurance'::app_role])))));

create policy "rls_insurance_claims_update" on public."insurance_claims" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_insurance_claims_delete" on public."insurance_claims" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='insurance_estimates' and permissive='PERMISSIVE') is distinct from 'd88553357aa5186952e022af6cd94561' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: insurance_estimates'; end if; end $preflight$;

drop policy "Admin delete insurance_estimates" on public."insurance_estimates";

drop policy "Staff insert insurance_estimates" on public."insurance_estimates";

drop policy "Staff update insurance_estimates" on public."insurance_estimates";

drop policy "Supervisor insert insurance_estimates" on public."insurance_estimates";

drop policy "Supervisor read insurance_estimates" on public."insurance_estimates";

drop policy "Supervisor update insurance_estimates" on public."insurance_estimates";

drop policy "Tenant access insurance_estimates" on public."insurance_estimates";

create policy "rls_insurance_estimates_select" on public."insurance_estimates" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role])))));

create policy "rls_insurance_estimates_insert" on public."insurance_estimates" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role, 'technician'::app_role])))));

create policy "rls_insurance_estimates_update" on public."insurance_estimates" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])))));

create policy "rls_insurance_estimates_delete" on public."insurance_estimates" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='job_order_parts' and permissive='PERMISSIVE') is distinct from 'a58346d4a91fbf47bad4afaec7613f85' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: job_order_parts'; end if; end $preflight$;

drop policy "Admin delete parts" on public."job_order_parts";

drop policy "Staff insert parts" on public."job_order_parts";

drop policy "Staff update parts" on public."job_order_parts";

drop policy "Supervisor insert parts" on public."job_order_parts";

drop policy "Supervisor update parts" on public."job_order_parts";

drop policy "Tenant access parts" on public."job_order_parts";

create policy "rls_job_order_parts_select" on public."job_order_parts" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_job_order_parts_insert" on public."job_order_parts" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_job_order_parts_update" on public."job_order_parts" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role]))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role])))));

create policy "rls_job_order_parts_delete" on public."job_order_parts" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='job_orders' and permissive='PERMISSIVE') is distinct from '22987499a5cd4eb1c9d86c95747ba676' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: job_orders'; end if; end $preflight$;

drop policy "Managers delete job orders" on public."job_orders";

drop policy "Staff read tenant job orders" on public."job_orders";

drop policy "Supervisor insert job_orders" on public."job_orders";

drop policy "Supervisor update job_orders" on public."job_orders";

drop policy "Workshop staff create job orders" on public."job_orders";

drop policy "Workshop staff update job orders" on public."job_orders";

create policy "rls_job_orders_select" on public."job_orders" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND (NOT has_role(( SELECT auth.uid() AS uid), 'customer'::app_role)))));

create policy "rls_job_orders_insert" on public."job_orders" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'supervisor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'technician'::app_role)))));

create policy "rls_job_orders_update" on public."job_orders" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR (((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'supervisor'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'technician'::app_role))))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'supervisor'::app_role))) OR ((tenant_id = get_user_tenant_id())));

create policy "rls_job_orders_delete" on public."job_orders" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role)))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='profiles' and permissive='PERMISSIVE') is distinct from '9d862e7bd0f383b0008e19c90f1607e8' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: profiles'; end if; end $preflight$;

drop policy "Admins can update tenant profiles" on public."profiles";

drop policy "Admins insert profiles" on public."profiles";

drop policy "Users see profiles in tenant" on public."profiles";

drop policy "Users update own profile own fields" on public."profiles";

create policy "rls_profiles_select" on public."profiles" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_profiles_insert" on public."profiles" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role])) AND ((role <> 'admin'::app_role) OR (get_user_role() = 'admin'::app_role)))));

create policy "rls_profiles_update" on public."profiles" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR ((user_id = ( SELECT auth.uid() AS uid)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role) AND (role = ( SELECT i.previous_role
   FROM app_private.profile_update_identity(profiles.id) i(previous_role, previous_tenant))))) OR (((user_id = ( SELECT auth.uid() AS uid)) AND (role = ( SELECT i.previous_role
   FROM app_private.profile_update_identity(profiles.id) i(previous_role, previous_tenant))) AND (tenant_id = ( SELECT i.previous_tenant
   FROM app_private.profile_update_identity(profiles.id) i(previous_role, previous_tenant))))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='security_action_otps' and permissive='PERMISSIVE') is distinct from '334896e5467474100ac6bf5500c32e6a' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: security_action_otps'; end if; end $preflight$;

drop policy "security_action_otps_no_client_read" on public."security_action_otps";

drop policy "security_action_otps_no_client_write" on public."security_action_otps";

create policy "rls_security_action_otps_select" on public."security_action_otps" as permissive for select to authenticated using ((false));

create policy "rls_security_action_otps_insert" on public."security_action_otps" as permissive for insert to authenticated with check ((false));

create policy "rls_security_action_otps_update" on public."security_action_otps" as permissive for update to authenticated using ((false)) with check ((false));

create policy "rls_security_action_otps_delete" on public."security_action_otps" as permissive for delete to authenticated using ((false));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='tenant_domains' and permissive='PERMISSIVE') is distinct from '53dda8d4ad8b270013534961b080191d' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: tenant_domains'; end if; end $preflight$;

drop policy "Tenant domain manage" on public."tenant_domains";

drop policy "Tenant domain read" on public."tenant_domains";

create policy "rls_tenant_domains_select" on public."tenant_domains" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) OR is_platform_admin())) OR ((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

create policy "rls_tenant_domains_insert" on public."tenant_domains" as permissive for insert to authenticated with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

create policy "rls_tenant_domains_update" on public."tenant_domains" as permissive for update to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role))))) with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

create policy "rls_tenant_domains_delete" on public."tenant_domains" as permissive for delete to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND has_role(( SELECT auth.uid() AS uid), 'admin'::app_role)))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='tenant_features' and permissive='PERMISSIVE') is distinct from 'cacea6bf63df1bf74442520ab2cc64b4' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: tenant_features'; end if; end $preflight$;

drop policy "Tenant feature manage" on public."tenant_features";

drop policy "Tenant feature read" on public."tenant_features";

create policy "rls_tenant_features_select" on public."tenant_features" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) OR is_platform_admin())) OR ((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

create policy "rls_tenant_features_insert" on public."tenant_features" as permissive for insert to authenticated with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

create policy "rls_tenant_features_update" on public."tenant_features" as permissive for update to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role)))))) with check (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

create policy "rls_tenant_features_delete" on public."tenant_features" as permissive for delete to authenticated using (((is_platform_admin() OR ((tenant_id = get_user_tenant_id()) AND (has_role(( SELECT auth.uid() AS uid), 'admin'::app_role) OR has_role(( SELECT auth.uid() AS uid), 'manager'::app_role))))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='tenants' and permissive='PERMISSIVE') is distinct from '0b28d5daabc544992ba140c19f28c59f' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: tenants'; end if; end $preflight$;

drop policy "Admins update tenant" on public."tenants";

drop policy "Platform admins manage tenants" on public."tenants";

drop policy "Users see own tenant" on public."tenants";

create policy "rls_tenants_select" on public."tenants" as permissive for select to authenticated using (((id = get_user_tenant_id())) OR (is_platform_admin()));

create policy "rls_tenants_insert" on public."tenants" as permissive for insert to authenticated with check ((is_platform_admin()));

create policy "rls_tenants_update" on public."tenants" as permissive for update to authenticated using ((((id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR (is_platform_admin())) with check ((((id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))) OR (is_platform_admin()));

create policy "rls_tenants_delete" on public."tenants" as permissive for delete to authenticated using ((is_platform_admin()));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='user_roles' and permissive='PERMISSIVE') is distinct from '4f50146cb4abeaed2d06c6e33f98d731' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: user_roles'; end if; end $preflight$;

drop policy "Admins manage tenant roles" on public."user_roles";

drop policy "Users read own role or admin/manager reads all" on public."user_roles";

create policy "rls_user_roles_select" on public."user_roles" as permissive for select to authenticated using ((((tenant_id = get_user_tenant_id()) AND ((user_id = ( SELECT auth.uid() AS uid)) OR (get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role]))))) OR (((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_user_roles_insert" on public."user_roles" as permissive for insert to authenticated with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_user_roles_update" on public."user_roles" as permissive for update to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role)))) with check ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

create policy "rls_user_roles_delete" on public."user_roles" as permissive for delete to authenticated using ((((tenant_id = get_user_tenant_id()) AND (get_user_role() = 'admin'::app_role))));

do $preflight$ begin if (select md5(string_agg(policyname||chr(31)||roles::text||chr(31)||cmd||chr(31)||coalesce(qual,'<null>')||chr(31)||coalesce(with_check,'<null>'),chr(30) order by policyname)) from pg_policies where schemaname='public' and tablename='whatsapp_templates' and permissive='PERMISSIVE') is distinct from 'f3191e1736a61408e13c9a47ab14de08' then raise exception 'RLS_POLICY_DEFINITION_DRIFT: whatsapp_templates'; end if; end $preflight$;

drop policy "tenant manage whatsapp templates" on public."whatsapp_templates";

drop policy "tenant read whatsapp templates" on public."whatsapp_templates";

create policy "rls_whatsapp_templates_select" on public."whatsapp_templates" as permissive for select to authenticated using (((tenant_id = get_user_tenant_id())));

create policy "rls_whatsapp_templates_insert" on public."whatsapp_templates" as permissive for insert to authenticated with check (((tenant_id = get_user_tenant_id())));

create policy "rls_whatsapp_templates_update" on public."whatsapp_templates" as permissive for update to authenticated using (((tenant_id = get_user_tenant_id()))) with check (((tenant_id = get_user_tenant_id())));

create policy "rls_whatsapp_templates_delete" on public."whatsapp_templates" as permissive for delete to authenticated using (((tenant_id = get_user_tenant_id())));

;
-- COMPONENT supabase/migrations/20261105094638_vehicle_entry_claim_inspection_link.sql SHA256 66b445bc78398208e5e12e2cf86de56b9516b57104fdadea883e59afc6e196b3
-- New, explicit visit-scoped inspections only. No historical relinking/backfill.
-- Reuse the established DR allocator/report table and the claim's UUID pointer.
create unique index inspections_entry_damage_report_unique
  on public.inspections (tenant_id, (details->>'vehicleEntryId'))
  where inspection_kind = 'insurance' and details->>'vehicleEntryId' is not null;

-- Align the existing insurance report writer with its existing Insurance role UI
-- permission. Do not change numbering, existing signatures or technician access.
do $migration$
declare v_definition text;
begin
  v_definition := pg_get_functiondef('public.save_insurance_damage_report(text,uuid,text,jsonb)'::regprocedure);
  if position('''technician''::public.app_role, ''supervisor''::public.app_role' in v_definition) = 0 then
    raise exception 'INSPECTION_WRITER_DEFINITION_CHANGED';
  end if;
  execute replace(v_definition,
    '''technician''::public.app_role, ''supervisor''::public.app_role',
    '''technician''::public.app_role, ''supervisor''::public.app_role, ''insurance''::public.app_role');
end;
$migration$;

create or replace function public.save_vehicle_entry_damage_inspection(
  p_entry_id uuid, p_existing_code text, p_request_id uuid, p_report jsonb
) returns jsonb
language plpgsql security definer set search_path = pg_catalog
as $function$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_entry public.vehicle_entries%rowtype;
  v_claim public.insurance_claims%rowtype;
  v_order public.job_orders%rowtype;
  v_vehicle public.vehicles%rowtype;
  v_inspection public.inspections%rowtype;
  v_claim_id uuid;
  v_order_id uuid;
  v_code text;
  v_report jsonb;
  v_new boolean;
  v_profile_id uuid;
begin
  select p.id into v_profile_id from public.profiles p where p.user_id = auth.uid() and p.tenant_id = v_tenant
    and p.account_status = 'active' and p.disabled_at is null and p.role in ('admin', 'manager', 'supervisor', 'insurance');
  if auth.uid() is null or v_tenant is null or v_profile_id is null then
    raise exception 'INSPECTION_SAVE_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_entry_id is null or p_request_id is null or jsonb_typeof(p_report) is distinct from 'object' then
    raise exception 'INSPECTION_REPORT_INVALID' using errcode = '22023';
  end if;
  -- Lock canonical sources before deduplication, including concurrent tabs/users.
  select * into v_entry from public.vehicle_entries
    where id = p_entry_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found or v_entry.status in ('Draft', 'Cancelled') or v_entry.vehicle_id is null
    or v_entry.vehicle_location is distinct from 'داخل الورشة' then
    raise exception 'INSPECTION_ENTRY_UNAVAILABLE' using errcode = '22023';
  end if;
  if v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null
    and v_entry.insurance_claim_id <> v_entry.converted_claim_id then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  v_claim_id := coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id);
  select * into v_claim from public.insurance_claims
    where id = v_claim_id and tenant_id = v_tenant and deleted_at is null for update;
  if not found or v_claim.vehicle_id is distinct from v_entry.vehicle_id
    or v_claim.status in ('cancelled', 'rejected')
    or (v_claim.vehicle_entry_id is not null and v_claim.vehicle_entry_id <> v_entry.id) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  if v_entry.work_order_id is not null and v_entry.converted_work_order_id is not null
    and v_entry.work_order_id <> v_entry.converted_work_order_id then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  v_order_id := coalesce(v_entry.work_order_id, v_entry.converted_work_order_id);
  if v_order_id is not null then
    select * into v_order from public.job_orders where id = v_order_id and tenant_id = v_tenant and deleted_at is null;
    if not found or v_order.vehicle_id is distinct from v_entry.vehicle_id or v_order.claim_id is distinct from v_claim_id
      or v_order.work_order_type is distinct from 'insurance'
      or (v_order.vehicle_entry_id is not null and v_order.vehicle_entry_id <> v_entry.id) then
      raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
    end if;
  end if;
  select * into v_inspection from public.inspections where tenant_id = v_tenant
    and inspection_kind = 'insurance' and details->>'vehicleEntryId' = v_entry.id::text for update;
  v_new := not found;
  if (v_claim.inspection_id is not null and v_claim.inspection_id is distinct from v_inspection.id)
    or (v_inspection.id is not null and v_inspection.details->>'claimId' is distinct from v_claim_id::text)
    or (nullif(trim(p_existing_code), '') is not null and p_existing_code is distinct from v_inspection.inspection_code) then
    -- Historical links require explicit review, never adopt/overwrite silently.
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  if not v_new and nullif(trim(p_existing_code), '') is null then
    if v_inspection.details->>'insuranceDamageSaveRequestId' is distinct from p_request_id::text then
      raise exception 'INSPECTION_ALREADY_EXISTS' using errcode = '40001';
    end if;
    -- Another tab or a retry already saved. Return that exact report, do not
    -- overwrite it with a stale draft or allocate another DR code.
    return jsonb_build_object('code', v_inspection.inspection_code, 'entryId', v_entry.id,
      'claimId', v_claim_id, 'report', v_inspection.details->'insuranceInspectionReport');
  end if;
  if exists (select 1 from public.inspections i where i.tenant_id = v_tenant
    and i.inspection_kind = 'insurance' and i.details->>'insuranceDamageSaveRequestId' = p_request_id::text
    and i.details->>'vehicleEntryId' is distinct from v_entry.id::text) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  select * into strict v_vehicle from public.vehicles where id = v_entry.vehicle_id and tenant_id = v_tenant;
  v_report := p_report || jsonb_build_object('claimNo', v_claim.claim_number, 'gatePass', v_entry.entry_number,
    'regNo', concat_ws(' ', nullif(v_vehicle.plate_letters, ''), v_vehicle.plate_number),
    'makeModel', concat_ws(' ', v_vehicle.brand, v_vehicle.model), 'modelYear', coalesce(v_vehicle.year::text, ''),
    'insuranceCompany', v_claim.insurance_company);
  v_code := public.save_insurance_damage_report(v_inspection.inspection_code, p_request_id, v_order.order_number, v_report);
  select * into strict v_inspection from public.inspections where tenant_id = v_tenant
    and inspection_kind = 'insurance' and inspection_code = v_code for update;
  -- A request token reused for another visit must not move a report.
  if (v_inspection.details ? 'vehicleEntryId' and v_inspection.details->>'vehicleEntryId' <> v_entry.id::text)
    or (v_inspection.details ? 'claimId' and v_inspection.details->>'claimId' <> v_claim_id::text) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  update public.inspections set details = details || jsonb_build_object(
    'vehicleEntryId', v_entry.id, 'claimId', v_claim_id), inspector_id = coalesce(inspector_id, v_profile_id)
    where id = v_inspection.id;
  if v_claim.inspection_id is distinct from v_inspection.id then
    update public.insurance_claims set inspection_id = v_inspection.id
      where id = v_claim_id and tenant_id = v_tenant;
  end if;
  insert into public.claim_audit_logs(tenant_id, claim_id, user_id, action, details)
    values (v_tenant, v_claim_id, auth.uid(), 'vehicle_entry_inspection_saved', jsonb_build_object(
      'vehicle_entry_id', v_entry.id, 'inspection_id', v_inspection.id, 'inspection_code', v_code, 'created', v_new));
  return jsonb_build_object('code', v_code, 'entryId', v_entry.id,
    'claimId', v_claim_id, 'report', v_inspection.details->'insuranceInspectionReport');
end;
$function$;
revoke all on function public.save_vehicle_entry_damage_inspection(uuid,text,uuid,jsonb) from public, anon;
grant execute on function public.save_vehicle_entry_damage_inspection(uuid,text,uuid,jsonb) to authenticated;

-- Every writer, including the legacy edit RPC, preserves the canonical link.
-- Only new visit-scoped reports opt into this guard; old records are untouched.
create or replace function app_private.guard_entry_inspection_identity()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $guard$
declare v_entry public.vehicle_entries%rowtype; v_claim public.insurance_claims%rowtype; v_vehicle public.vehicles%rowtype;
begin
  if old.details->>'vehicleEntryId' is null then return new; end if;
  if new.tenant_id is distinct from old.tenant_id or new.inspection_code is distinct from old.inspection_code
    or new.inspection_kind is distinct from old.inspection_kind
    or new.details->>'vehicleEntryId' is distinct from old.details->>'vehicleEntryId'
    or new.details->>'claimId' is distinct from old.details->>'claimId' then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  select * into strict v_entry from public.vehicle_entries where tenant_id = new.tenant_id and id = (old.details->>'vehicleEntryId')::uuid;
  select * into strict v_claim from public.insurance_claims where tenant_id = new.tenant_id and id = (old.details->>'claimId')::uuid;
  select * into strict v_vehicle from public.vehicles where tenant_id = new.tenant_id and id = v_entry.vehicle_id;
  if coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id) is distinct from v_claim.id
    or v_claim.vehicle_id is distinct from v_entry.vehicle_id
    or new.job_order_id is distinct from coalesce(v_entry.work_order_id, v_entry.converted_work_order_id)
    or new.details->'insuranceInspectionReport'->>'claimNo' is distinct from v_claim.claim_number
    or new.details->'insuranceInspectionReport'->>'gatePass' is distinct from v_entry.entry_number
    or new.details->'insuranceInspectionReport'->>'regNo' is distinct from concat_ws(' ', nullif(v_vehicle.plate_letters, ''), v_vehicle.plate_number) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  return new;
end;
$guard$;
revoke all on function app_private.guard_entry_inspection_identity() from public, anon, authenticated;
create trigger guard_entry_inspection_identity before update on public.inspections
  for each row execute function app_private.guard_entry_inspection_identity();

;
-- COMPONENT supabase/migrations/20261105094929_guard_entry_inspection_first_link.sql SHA256 a15b22a18ed7d213b1079cbb1bef48b7a4932206287e8ff418a7aaddcd4b486a
-- Guard first attachment/insert as well as later edits. Historical unlinked
-- reports cannot acquire visit identity in a later transaction.
create or replace function app_private.guard_entry_inspection_identity()
returns trigger language plpgsql security invoker set search_path = pg_catalog
as $guard$
declare v_entry public.vehicle_entries%rowtype; v_claim public.insurance_claims%rowtype; v_vehicle public.vehicles%rowtype;
begin
  if tg_op = 'UPDATE' and old.details->>'vehicleEntryId' is not null then
    if new.tenant_id is distinct from old.tenant_id or new.inspection_code is distinct from old.inspection_code
      or new.inspection_kind is distinct from old.inspection_kind
      or new.details->>'vehicleEntryId' is distinct from old.details->>'vehicleEntryId'
      or new.details->>'claimId' is distinct from old.details->>'claimId' then
      raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
    end if;
  elsif new.details->>'vehicleEntryId' is null and new.details->>'claimId' is null then
    return new;
  elsif tg_op = 'UPDATE' then
    if old.created_at < transaction_timestamp()
      or old.details->>'insuranceDamageSaveRequestId' is null
      or new.details->>'insuranceDamageSaveRequestId' is distinct from old.details->>'insuranceDamageSaveRequestId' then
      raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
    end if;
  end if;
  if new.inspection_kind <> 'insurance' or new.details->>'vehicleEntryId' is null or new.details->>'claimId' is null then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  select * into strict v_entry from public.vehicle_entries where tenant_id = new.tenant_id and id = (new.details->>'vehicleEntryId')::uuid;
  select * into strict v_claim from public.insurance_claims where tenant_id = new.tenant_id and id = (new.details->>'claimId')::uuid;
  select * into strict v_vehicle from public.vehicles where tenant_id = new.tenant_id and id = v_entry.vehicle_id;
  if coalesce(v_entry.insurance_claim_id, v_entry.converted_claim_id) is distinct from v_claim.id
    or (v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null and v_entry.insurance_claim_id <> v_entry.converted_claim_id)
    or v_claim.vehicle_id is distinct from v_entry.vehicle_id
    or new.job_order_id is distinct from coalesce(v_entry.work_order_id, v_entry.converted_work_order_id)
    or new.details->'insuranceInspectionReport'->>'claimNo' is distinct from v_claim.claim_number
    or new.details->'insuranceInspectionReport'->>'gatePass' is distinct from v_entry.entry_number
    or new.details->'insuranceInspectionReport'->>'regNo' is distinct from concat_ws(' ', nullif(v_vehicle.plate_letters, ''), v_vehicle.plate_number) then
    raise exception 'INSPECTION_LINK_CONFLICT' using errcode = '22023';
  end if;
  return new;
end;
$guard$;
revoke all on function app_private.guard_entry_inspection_identity() from public, anon, authenticated;
drop trigger guard_entry_inspection_identity on public.inspections;
create trigger guard_entry_inspection_identity before insert or update on public.inspections
  for each row execute function app_private.guard_entry_inspection_identity();

;
-- COMPONENT supabase/migrations/20261105095546_restrict_entry_inspection_link_creation.sql SHA256 014355259aa9ddbb8b5244c5dc425cd28b4a937af803cb73efba1dd021a5a2ce
-- First linkage is an atomic server-writer operation, never a browser-editable
-- JSON/timestamp privilege. current_user is the database execution role (not JWT
-- metadata); the existing SECURITY DEFINER writer runs as its database owner.
do $migration$
declare v_definition text; v_marker text := '  select * into strict v_entry from public.vehicle_entries';
begin
  v_definition := pg_get_functiondef('app_private.guard_entry_inspection_identity()'::regprocedure);
  if position(v_marker in v_definition) = 0 then raise exception 'INSPECTION_GUARD_DEFINITION_CHANGED'; end if;
  execute replace(v_definition, v_marker,
    E'  if current_user in (''authenticated'', ''anon'') and (tg_op = ''INSERT'' or old.details->>''vehicleEntryId'' is null) then\n'
    || E'    raise exception ''INSPECTION_LINK_CREATION_REQUIRES_SERVER'' using errcode = ''42501'';\n  end if;\n'
    || v_marker);
end;
$migration$;
