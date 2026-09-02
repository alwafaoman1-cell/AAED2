-- True monthly vehicle profitability.
-- Revenue is recognized from cleared payments dated inside the selected month,
-- net of the linked invoice VAT and capped at the invoice total.
-- Direct costs are recognized only from eligible expense vouchers dated inside
-- the same month. Nothing is carried from another month.

create or replace function public.monthly_vehicle_profitability_rpc(
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
      coalesce(p.work_order_id::text, 'vehicle:' || p.vehicle_id::text) payment_operation_key
    from public.reports_payment_facts_v1 p
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
  direct_period_expenses as (
    select e.*
    from eligible_period_expenses e
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
    union
    select distinct
      coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text),
      e.work_order_id, e.vehicle_id, e.claim_id
    from direct_period_expenses e
    where e.work_order_id is not null or e.vehicle_id is not null
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
      sum(p.recognized_gross * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0))::numeric recognized_revenue_ex_vat,
      sum(p.recognized_gross - p.recognized_gross * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0))::numeric recognized_vat,
      sum(
        p.recognized_gross * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0)
        * case when lm.raw_line_total > 0 then lm.raw_parts_total / lm.raw_line_total else 0 end
      )::numeric parts_revenue,
      sum(
        p.recognized_gross * coalesce(p.invoice_subtotal / nullif(p.invoice_total, 0), 0)
        * (1 - case when lm.raw_line_total > 0 then lm.raw_parts_total / lm.raw_line_total else 0 end)
      )::numeric labor_revenue
    from period_payment_recognition p
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
      sum(i.outstanding)::numeric outstanding
    from eligible_invoices i
    join activity_operations a on a.operation_key = i.operation_key
    group by i.operation_key
  ),
  expense_month as (
    select coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text) operation_key,
      coalesce(sum(e.subtotal) filter (where e.classifier ~ '(part|spare|قطع|غيار)'),0)::numeric parts_cost,
      coalesce(sum(e.subtotal) filter (where e.classifier ~ '(labou?r|wage|salary|عمال|أجر|اجور|أجور)'),0)::numeric labor_cost,
      coalesce(sum(e.subtotal) filter (where e.classifier !~ '(part|spare|قطع|غيار|labou?r|wage|salary|عمال|أجر|اجور|أجور)'),0)::numeric operating_cost
    from direct_period_expenses e
    group by 1
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
    left join expense_month em on em.operation_key=a.operation_key
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
    'basis','strict monthly basis: recognized revenue comes only from cleared payments dated in the selected month, net of VAT and capped at linked invoice total; direct costs come only from eligible expense vouchers dated in the same month; no revenue or vehicle cost is carried between months; general overhead remains separate',
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) from public, anon;
grant execute on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) to authenticated;

comment on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) is
  'Strict month-by-month vehicle profitability from cleared payments and expense vouchers in the selected month, with no carryover.';
