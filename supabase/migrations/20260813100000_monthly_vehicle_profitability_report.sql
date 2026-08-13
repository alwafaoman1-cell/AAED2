-- Monthly cash/insurance vehicle profitability.
-- Revenue = issued invoice subtotal in the selected period (VAT excluded).
-- Collection = cleared payment date in the selected period.
-- Direct costs = eligible linked expense date in the selected period.
-- General salaries/fixed/operating expenses stay in a separate monthly summary.

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
  period_invoices as (
    select i.*
    from public.reports_invoice_facts_v1 i
    where i.tenant_id = v_tenant
      and i.business_type = p_business_type
      and i.invoice_date between p_from and p_to
      and lower(coalesce(i.status, 'issued')) not in ('draft','cancelled','canceled','void','deleted')
  ),
  period_payments as (
    select p.*
    from public.reports_payment_facts_v1 p
    where p.tenant_id = v_tenant
      and p.business_type = p_business_type
      and p.payment_date between p_from and p_to
      and lower(coalesce(p.status, 'cleared')) in ('cleared','paid','completed','success','succeeded')
  ),
  eligible_period_expenses as (
    select e.*,
      lower(coalesce(e.expense_type,'') || ' ' || coalesce(e.category_name,'') || ' ' || coalesce(e.description,'')) classifier
    from public.reports_expense_facts_v1 e
    left join public.job_orders jo on jo.tenant_id=e.tenant_id and jo.id=e.work_order_id
    left join public.insurance_claims c on c.tenant_id=e.tenant_id and c.id=e.claim_id
    where e.tenant_id = v_tenant
      and e.date between p_from and p_to
      and e.deleted_at is null and e.archived_at is null
      and (jo.id is null or (jo.deleted_at is null and lower(coalesce(jo.status::text,'')) not in ('cancelled','canceled','deleted')))
      and (c.id is null or lower(coalesce(c.status::text,'')) not in ('cancelled','canceled','rejected','deleted'))
  ),
  direct_period_expenses as (
    select e.*
    from eligible_period_expenses e
    where e.business_type = p_business_type
      and e.expense_type <> 'workshop_general'
      and (e.work_order_id is not null or e.vehicle_id is not null)
  ),
  activity_operations as (
    select distinct coalesce(i.work_order_id::text, 'vehicle:' || i.vehicle_id::text) operation_key, i.work_order_id, i.vehicle_id, i.claim_id
      from period_invoices i where i.work_order_id is not null or i.vehicle_id is not null
    union
    select distinct coalesce(p.work_order_id::text, 'vehicle:' || p.vehicle_id::text), p.work_order_id, p.vehicle_id, p.claim_id
      from period_payments p where p.work_order_id is not null or p.vehicle_id is not null
    union
    select distinct coalesce(e.work_order_id::text, 'vehicle:' || e.vehicle_id::text), e.work_order_id, e.vehicle_id, e.claim_id
      from direct_period_expenses e where e.work_order_id is not null or e.vehicle_id is not null
  ),
  invoice_month as (
    select coalesce(i.work_order_id::text, 'vehicle:' || i.vehicle_id::text) operation_key,
      string_agg(distinct i.invoice_number, ', ' order by i.invoice_number) invoice_numbers,
      string_agg(distinct i.invoice_date::text, ', ' order by i.invoice_date::text) invoice_dates,
      sum(i.subtotal)::numeric invoiced_ex_vat, sum(i.vat)::numeric vat, sum(i.total)::numeric invoiced_total
    from period_invoices i
    where i.work_order_id is not null or i.vehicle_id is not null
    group by 1
  ),
  invoice_current_balance as (
    select coalesce(i.work_order_id::text, 'vehicle:' || i.vehicle_id::text) operation_key,
      sum(i.outstanding)::numeric outstanding
    from public.reports_invoice_facts_v1 i
    join activity_operations a on a.operation_key=coalesce(i.work_order_id::text, 'vehicle:' || i.vehicle_id::text)
    where i.tenant_id=v_tenant and i.business_type=p_business_type
      and lower(coalesce(i.status,'issued')) not in ('draft','cancelled','canceled','void','deleted')
    group by 1
  ),
  payment_month as (
    select coalesce(p.work_order_id::text, 'vehicle:' || p.vehicle_id::text) operation_key, sum(p.amount)::numeric collected
    from period_payments p
    where p.work_order_id is not null or p.vehicle_id is not null
    group by 1
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
      a.operation_key as operation_id,
      w.id as work_order_id,
      w.order_number as work_order_number,
      w.status as work_order_status,
      coalesce(w.claim_id,a.claim_id) claim_id,
      coalesce(w.claim_number, c.claim_number) claim_number,
      coalesce(ic.name, c.insurance_company) insurance_company,
      cu.customer_code,
      cu.name customer_name,
      cu.phone customer_phone,
      v.id vehicle_id,
      v.plate_number,
      v.plate_letters,
      v.plate_country,
      v.brand,
      v.model,
      v.year,
      v.color,
      coalesce(v.vin, v.vin_number) vin,
      v.mileage,
      v.vehicle_type,
      w.received_at,
      w.delivered_at,
      w.workshop_days,
      im.invoice_numbers,
      im.invoice_dates,
      coalesce(im.invoiced_ex_vat,0)::numeric invoiced_ex_vat,
      coalesce(im.vat,0)::numeric vat,
      coalesce(im.invoiced_total,0)::numeric invoiced_total,
      coalesce(pm.collected,0)::numeric collected,
      coalesce(cb.outstanding,0)::numeric outstanding,
      coalesce(em.parts_cost,0)::numeric parts_cost,
      coalesce(em.labor_cost,0)::numeric labor_cost,
      coalesce(em.operating_cost,0)::numeric operating_cost,
      (coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0))::numeric direct_cost,
      (coalesce(im.invoiced_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0))::numeric gross_profit,
      case when coalesce(im.invoiced_ex_vat,0)=0 then 0 else
        ((coalesce(im.invoiced_ex_vat,0)-coalesce(em.parts_cost,0)-coalesce(em.labor_cost,0)-coalesce(em.operating_cost,0))/im.invoiced_ex_vat*100)::numeric end profit_margin,
      case
        when coalesce(im.invoiced_ex_vat,0)=0 and coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0)=0 then 'no_actual_financial_data'
        when coalesce(im.invoiced_ex_vat,0)=0 then 'cost_without_invoice'
        when coalesce(em.parts_cost,0)+coalesce(em.labor_cost,0)+coalesce(em.operating_cost,0)=0 then 'invoice_without_recorded_costs'
        else 'actual_data_available'
      end accounting_status
    from activity_operations a
    left join valid_work_orders w on w.id=a.work_order_id
    left join public.vehicles v on v.tenant_id=v_tenant and v.id=coalesce(w.vehicle_id,a.vehicle_id)
    left join public.insurance_claims c on c.tenant_id=v_tenant and c.id=coalesce(w.claim_id,a.claim_id)
    left join public.customers cu on cu.tenant_id=v_tenant and cu.id=coalesce(w.customer_id,c.customer_id,v.customer_id)
    left join public.insurance_companies ic on ic.tenant_id=v_tenant and ic.id=c.insurance_company_id
    left join invoice_month im on im.operation_key=a.operation_key
    left join invoice_current_balance cb on cb.operation_key=a.operation_key
    left join payment_month pm on pm.operation_key=a.operation_key
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
        or coalesce(im.invoice_numbers,'') ilike '%'||trim(p_search)||'%'
      )
  ),
  page_rows as (
    select * from report_rows
    order by coalesce(invoice_dates,'' ) desc, work_order_number desc nulls last, plate_number
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
      'invoiced_ex_vat',sum(invoiced_ex_vat),'vat',sum(vat),'invoiced_total',sum(invoiced_total),
      'collected',sum(collected),'outstanding',sum(outstanding),'parts_cost',sum(parts_cost),
      'labor_cost',sum(labor_cost),'operating_cost',sum(operating_cost),'direct_cost',sum(direct_cost),
      'gross_profit',sum(gross_profit),'vehicles',count(distinct vehicle_id)
    ) from report_rows),'{}'::jsonb),
    coalesce((select to_jsonb(overhead_summary) from overhead_summary),'{}'::jsonb)
  into v_rows,v_total,v_aggregates,v_overheads;

  return jsonb_build_object(
    'rows',v_rows,
    'aggregates',v_aggregates,
    'overheads',v_overheads,
    'pagination',jsonb_build_object('page',v_page,'pageSize',v_page_size,'totalRows',v_total,'totalPages',ceil(v_total::numeric/v_page_size)::integer),
    'basis','invoice_date + payment_date + expense_date; invoice subtotal excludes VAT; overhead is not allocated to vehicles',
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) from public, anon;
grant execute on function public.monthly_vehicle_profitability_rpc(date,date,text,text,integer,integer) to authenticated;

create index if not exists idx_monthly_claim_payments_invoice_date
  on public.claim_payments (tenant_id, payment_date, claim_id, offset_against_invoice_id);
create index if not exists idx_monthly_sales_payments_date_document
  on public.sales_payments (tenant_id, date, sales_document_id);
create index if not exists idx_monthly_expenses_date_work_order
  on public.expenses (tenant_id, date, linked_work_order_id)
  where deleted_at is null and archived_at is null;
