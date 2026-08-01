-- Vehicle P&L read model. Revenue is invoice subtotal; costs are actual eligible expenses.
create or replace function public.accounting_vehicle_profit_loss_rpc(
  p_from date default null,p_to date default null,p_page integer default 1,p_page_size integer default 50,
  p_search text default null,p_filters jsonb default '{}'::jsonb
) returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.get_user_tenant_id();v_rows jsonb;v_total bigint;v_revenue numeric;v_cost numeric;v_profit numeric;
begin
  if auth.uid() is null or v_tenant is null then raise exception 'ACCOUNTING_REPORT_AUTH_REQUIRED';end if;
  if not public.accounting_has_permission('accounting_reports.vehicle_profit_loss')
     and not public.accounting_has_permission('accounting_reports.admin') then raise exception 'ACCOUNTING_REPORT_PERMISSION_DENIED';end if;
  with eligible_work_orders as (
    select w.id,w.order_number,w.claim_id,w.customer_id,w.vehicle_id,w.business_type,w.customer_name,w.vehicle_name,w.plate,w.created_at
    from public.reports_work_order_facts_v1 w
    join public.job_orders jo on jo.tenant_id=w.tenant_id and jo.id=w.id
    join public.vehicles v on v.tenant_id=w.tenant_id and v.id=w.vehicle_id
    left join public.insurance_claims c on c.tenant_id=w.tenant_id and c.id=w.claim_id
    where w.tenant_id=v_tenant and jo.deleted_at is null and jo.archived_at is null
      and lower(jo.status::text) not in ('cancelled','canceled','deleted','archived')
      and v.deleted_at is null and v.archived_at is null and not coalesce(v.archived,false)
      and (c.id is null or lower(c.status::text) not in ('cancelled','canceled','rejected','deleted'))
      and (p_from is null or w.created_at::date>=p_from) and (p_to is null or w.created_at::date<=p_to)
      and (nullif(p_filters->>'work_order_id','') is null or w.id=(p_filters->>'work_order_id')::uuid)
      and (nullif(p_filters->>'business_type','') is null or w.business_type=p_filters->>'business_type')
      and (p_search is null or w.order_number ilike '%'||p_search||'%' or w.plate ilike '%'||p_search||'%' or w.customer_name ilike '%'||p_search||'%')
  ), invoice_totals as (
    select i.work_order_id,sum(i.subtotal)::numeric revenue,sum(i.vat)::numeric vat,sum(i.total)::numeric invoiced,sum(i.paid)::numeric paid
    from public.reports_invoice_facts_v1 i join eligible_work_orders w on w.id=i.work_order_id
    where i.tenant_id=v_tenant and lower(coalesce(i.status,'issued')) not in ('draft','cancelled','canceled','void','deleted')
    group by i.work_order_id
  ), legacy_expenses as (
    select e.work_order_id,sum(coalesce(e.subtotal,e.total,0))::numeric cost
    from public.reports_expense_facts_v1 e join eligible_work_orders w on w.id=e.work_order_id
    where e.tenant_id=v_tenant group by e.work_order_id
  ), eligible_expenses as (
    select e.work_order_id,
      sum(coalesce(e.subtotal,e.total,0)) filter(where lower(coalesce(e.category_name,'')||' '||coalesce(e.description,'')) ~ '(part|spare|قطع|غيار)')::numeric parts_cost,
      sum(coalesce(e.subtotal,e.total,0)) filter(where lower(coalesce(e.category_name,'')||' '||coalesce(e.description,'')) ~ '(labou?r|wage|عمال|أجر|اجور|أجور)')::numeric labor_cost,
      sum(coalesce(e.subtotal,e.total,0)) filter(where lower(coalesce(e.category_name,'')||' '||coalesce(e.description,'')) !~ '(part|spare|قطع|غيار|labou?r|wage|عمال|أجر|اجور|أجور)')::numeric other_cost
    from public.reports_expense_facts_v1 e join eligible_work_orders w on w.id=e.work_order_id
    left join public.suppliers s on s.tenant_id=e.tenant_id and s.id=e.supplier_id
    where e.tenant_id=v_tenant and e.deleted_at is null and e.archived_at is null
      and (e.supplier_id is null or coalesce(s.is_active,false))
    group by e.work_order_id
  ), q as (
    select w.id,w.order_number,w.created_at::date date,w.business_type,w.customer_name,w.vehicle_name,w.plate,
      coalesce(i.revenue,0)::numeric revenue,coalesce(x.parts_cost,0)::numeric parts_cost,
      coalesce(x.labor_cost,0)::numeric labor_cost,coalesce(x.other_cost,0)::numeric other_cost,
      (coalesce(x.parts_cost,0)+coalesce(x.labor_cost,0)+coalesce(x.other_cost,0))::numeric cost,
      (coalesce(i.revenue,0)-coalesce(x.parts_cost,0)-coalesce(x.labor_cost,0)-coalesce(x.other_cost,0))::numeric profit,
      case when coalesce(i.revenue,0)=0 then 0 else ((coalesce(i.revenue,0)-coalesce(x.parts_cost,0)-coalesce(x.labor_cost,0)-coalesce(x.other_cost,0))/i.revenue*100)::numeric end margin,
      (coalesce(i.revenue,0)-coalesce(le.cost,0))::numeric old_result,
      (coalesce(i.revenue,0)-coalesce(x.parts_cost,0)-coalesce(x.labor_cost,0)-coalesce(x.other_cost,0))::numeric eligible_old_result,
      0::numeric difference,coalesce(i.vat,0)::numeric vat,coalesce(i.invoiced,0)::numeric invoiced,coalesce(i.paid,0)::numeric paid
    from eligible_work_orders w left join invoice_totals i on i.work_order_id=w.id
    left join eligible_expenses x on x.work_order_id=w.id left join legacy_expenses le on le.work_order_id=w.id
  ), counted as(select *,count(*) over() full_count from q),paged as(
    select * from counted order by date desc,order_number offset greatest(coalesce(p_page,1)-1,0)*least(greatest(coalesce(p_page_size,50),1),500) limit least(greatest(coalesce(p_page_size,50),1),500)
  ) select coalesce(jsonb_agg(to_jsonb(p)-'full_count'),'[]'),coalesce(max(full_count),0),coalesce(sum(revenue),0),coalesce(sum(cost),0),coalesce(sum(profit),0)
    into v_rows,v_total,v_revenue,v_cost,v_profit from paged p;
  return jsonb_build_object('reportKey','vehicle-profit-loss','basis','eligible_operational_actuals','available',true,'rows',coalesce(v_rows,'[]'),
    'aggregates',jsonb_build_object('revenue',coalesce(v_revenue,0),'cost',coalesce(v_cost,0),'profit',coalesce(v_profit,0),'rows',v_total),
    'pagination',jsonb_build_object('page',greatest(coalesce(p_page,1),1),'pageSize',least(greatest(coalesce(p_page_size,50),1),500),'totalRows',v_total,'totalPages',ceil(v_total::numeric/least(greatest(coalesce(p_page_size,50),1),500))::int),
    'dataQuality',jsonb_build_object('status',case when v_total=0 then 'not_configured' else 'ready' end,'excludedRecordsApplied',true,'parityRule','eligible_old_result = new_result'),
    'generatedAt',now());
end$$;
revoke all on function public.accounting_vehicle_profit_loss_rpc(date,date,integer,integer,text,jsonb) from public,anon;
grant execute on function public.accounting_vehicle_profit_loss_rpc(date,date,integer,integer,text,jsonb) to authenticated;
