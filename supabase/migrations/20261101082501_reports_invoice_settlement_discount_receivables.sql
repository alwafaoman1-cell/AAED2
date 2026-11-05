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

