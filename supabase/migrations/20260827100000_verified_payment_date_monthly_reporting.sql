-- Monthly collection must come from a real payment voucher with an explicit date.
-- Previously inferred LEGACY-PAID rows are retained for audit, but are pending
-- verification and are excluded from invoice settlement and financial reports.

create or replace view public.reports_payment_facts_v1
with (security_invoker = true)
as
select
  p.tenant_id,
  p.id,
  'insurance'::text as business_type,
  p.payment_number,
  p.payment_date as payment_date,
  p.status::text as status,
  p.amount::numeric as amount,
  p.payment_method::text as payment_method,
  p.claim_id,
  c.job_order_id as work_order_id,
  c.customer_id,
  c.vehicle_id,
  p.insurance_company_id,
  coalesce(ic.name, c.insurance_company) as party_name,
  c.claim_number,
  p.offset_against_invoice_id as invoice_id
from public.claim_payments p
join public.insurance_claims c
  on c.tenant_id = p.tenant_id
 and c.id = p.claim_id
left join public.insurance_companies ic
  on ic.tenant_id = p.tenant_id
 and ic.id = p.insurance_company_id
where lower(p.status::text) in ('cleared', 'paid', 'completed', 'success', 'succeeded')
  and coalesce(p.reference_number, '') not like 'LEGACY-PAID:%'

union all

select
  p.tenant_id,
  p.id,
  public.reports_classify_business_type(jo.claim_id, 'customer_invoice', jo.work_order_type) as business_type,
  p.payment_number,
  p.date as payment_date,
  'cleared'::text as status,
  p.amount::numeric as amount,
  p.method as payment_method,
  jo.claim_id,
  jo.id as work_order_id,
  s.customer_id,
  jo.vehicle_id,
  null::uuid as insurance_company_id,
  coalesce(s.customer_name, cu.name) as party_name,
  c.claim_number,
  s.id as invoice_id
from public.sales_payments p
join public.sales_documents s
  on s.tenant_id = p.tenant_id
 and s.id = p.sales_document_id
left join lateral (
  select j.*
  from public.job_orders j
  where j.tenant_id = s.tenant_id
    and (j.id::text = s.work_order_id or j.order_number = s.work_order_id)
  order by j.created_at desc
  limit 1
) jo on true
left join public.insurance_claims c
  on c.tenant_id = p.tenant_id
 and c.id = jo.claim_id
left join public.customers cu
  on cu.tenant_id = p.tenant_id
 and cu.id = s.customer_id
where s.doc_type = 'invoice'
  and lower(coalesce(s.status, 'issued')) not in ('draft', 'cancelled', 'deleted')
  and s.deleted_at is null
  and s.archived_at is null;

with changed as (
  update public.claim_payments
     set status = 'pending'::public.claim_payment_status,
         notes = concat_ws(
           E'\n',
           nullif(notes, ''),
           'Pending verification: inferred legacy amount is not an actual dated payment voucher.'
         ),
         updated_at = now()
   where reference_number like 'LEGACY-PAID:%'
     and status = 'cleared'::public.claim_payment_status
  returning id, tenant_id, claim_id, offset_against_invoice_id, amount, payment_date
)
insert into public.claim_audit_logs (tenant_id, claim_id, action, details)
select
  tenant_id,
  claim_id,
  'insurance_payment_legacy_requires_verification',
  jsonb_build_object(
    'payment_id', id,
    'invoice_id', offset_against_invoice_id,
    'amount', amount,
    'inferred_payment_date', payment_date,
    'financial_status', 'pending_verification',
    'required_action', 'record_real_payment_voucher_with_actual_payment_date'
  )
from changed;

create or replace function public.prevent_clearing_inferred_legacy_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if coalesce(new.reference_number, old.reference_number, '') like 'LEGACY-PAID:%'
     and new.status = 'cleared'::public.claim_payment_status then
    raise exception 'LEGACY_INFERRED_PAYMENT_REQUIRES_REAL_VOUCHER'
      using errcode = '23514';
  end if;
  return new;
end;
$$;

revoke all on function public.prevent_clearing_inferred_legacy_payment()
  from public, anon, authenticated;

drop trigger if exists trg_prevent_clearing_inferred_legacy_payment on public.claim_payments;
create trigger trg_prevent_clearing_inferred_legacy_payment
before insert or update of status, reference_number on public.claim_payments
for each row execute function public.prevent_clearing_inferred_legacy_payment();

-- Versioned wrapper: preserve invoice-date revenue calculations from v1 while
-- displaying the linked invoice reference on payment-month rows as well.
create or replace function public.monthly_vehicle_profitability_v2_rpc(
  p_from date,
  p_to date,
  p_business_type text default 'cash',
  p_search text default null,
  p_page integer default 1,
  p_page_size integer default 50
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_result jsonb;
  v_rows jsonb;
begin
  v_result := public.monthly_vehicle_profitability_rpc(
    p_from, p_to, p_business_type, p_search, p_page, p_page_size
  );

  select coalesce(jsonb_agg(
    case
      when refs.invoice_numbers is null then entry.row_data
      else jsonb_set(
        jsonb_set(entry.row_data, '{invoice_numbers}', to_jsonb(refs.invoice_numbers), true),
        '{invoice_dates}', to_jsonb(refs.invoice_dates), true
      )
    end
    order by entry.ordinality
  ), '[]'::jsonb)
  into v_rows
  from jsonb_array_elements(coalesce(v_result->'rows', '[]'::jsonb))
       with ordinality as entry(row_data, ordinality)
  left join lateral (
    select
      string_agg(distinct i.invoice_number, ', ' order by i.invoice_number) as invoice_numbers,
      string_agg(distinct i.invoice_date::text, ', ' order by i.invoice_date::text) as invoice_dates
    from public.reports_invoice_facts_v1 i
    where i.tenant_id = v_tenant
      and i.business_type = p_business_type
      and lower(coalesce(i.status, 'issued')) not in ('draft', 'cancelled', 'canceled', 'void', 'deleted')
      and (
        (entry.row_data->>'work_order_id' is not null
          and i.work_order_id::text = entry.row_data->>'work_order_id')
        or
        (entry.row_data->>'work_order_id' is null
          and i.vehicle_id::text = entry.row_data->>'vehicle_id')
      )
  ) refs on true;

  return jsonb_set(v_result, '{rows}', v_rows, true);
end;
$$;

revoke all on function public.monthly_vehicle_profitability_v2_rpc(date,date,text,text,integer,integer)
  from public, anon;
grant execute on function public.monthly_vehicle_profitability_v2_rpc(date,date,text,text,integer,integer)
  to authenticated;

comment on function public.monthly_vehicle_profitability_v2_rpc(date,date,text,text,integer,integer) is
  'Collection uses real dated payment vouchers only; linked invoice references remain visible across reporting months.';
