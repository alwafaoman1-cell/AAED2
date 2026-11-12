-- Read-only projections. No posting, reclassification, backfill or data rewrite.
-- SECURITY INVOKER deliberately retains every source-table RLS policy.
create function public.accounting_expense_summary_rpc(p_tenant_id uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $summary$
declare result jsonb;
begin
  if auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=p_tenant_id
      and p.account_status='active' and p.disabled_at is null) then
    raise exception 'DASHBOARD_SCOPE_DENIED' using errcode='42501';
  end if;
  with eligible as materialized (
    select e.category_name, left(coalesce(e.date::text,e.created_at::text),7) as month,
      floor((coalesce(e.amount,0)::float8+2.220446049250313e-16)*1000+0.5)/1000 amount,
      length(btrim(coalesce(nullif(e.supplier_tax_number,''),e.meta->>'supplierTaxNumber','')))>0 taxed
    from public.expenses e where e.tenant_id=p_tenant_id and e.deleted_at is null and e.archived_at is null
      and coalesce(e.meta->'deletedAt','null'::jsonb) in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
      and coalesce(e.meta->'archivedAt','null'::jsonb) in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
      and coalesce(e.meta->'refunded','null'::jsonb) in ('null'::jsonb,'false'::jsonb,'0'::jsonb,'""'::jsonb)
  ), normalized as materialized (
    select category_name,month,(case when taxed then floor((amount/1.05+2.220446049250313e-16)*1000+0.5)/1000 else amount end)::numeric subtotal
    from eligible
  ), months as (select month,sum(subtotal) expenses from normalized group by month),
  categories as (select nullif(category_name,'') account,sum(subtotal) total,count(*) count from normalized group by nullif(category_name,''))
  select jsonb_build_object('total',coalesce((select sum(subtotal)from normalized),0),'count',(select count(*)from normalized),
    'monthly',coalesce((select jsonb_agg(to_jsonb(m)order by month)from months m),'[]'::jsonb),
    'categories',coalesce((select jsonb_agg(to_jsonb(c)order by total desc,account nulls last)from categories c),'[]'::jsonb)) into result;
  return result;
end;
$summary$;
revoke all on function public.accounting_expense_summary_rpc(uuid) from public,anon;
grant execute on function public.accounting_expense_summary_rpc(uuid) to authenticated;

create function public.insurance_hub_summary_rpc(
  p_tenant_id uuid,p_now timestamptz default now(),p_timezone text default 'Asia/Muscat'
) returns jsonb language plpgsql stable security invoker set search_path='' as $hub$
declare result jsonb;
begin
  if auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=p_tenant_id
      and p.account_status='active' and p.disabled_at is null) then
    raise exception 'DASHBOARD_SCOPE_DENIED' using errcode='42501';
  end if;
  if p_now is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_timezone) then raise exception 'DASHBOARD_TIME_INVALID'; end if;
  with claims as materialized (
    select c.id,c.claim_number,c.insurance_company,c.status,c.estimated_amount,c.approved_amount,c.created_at,
      c.delivered_at,c.workshop_arrival_date,c.temporary_inspection_release_id,c.vehicle_presence_status,
      c.policy_expiry_date,c.policy_number,c.vehicle_make,c.vehicle_model,c.vehicle_plate,
      case when c.status='paid' then 'paid_archive' when c.status in ('cancelled','rejected') then 'cancelled'
        when c.delivered_at is not null then 'delivered'
        when c.temporary_inspection_release_id is not null and c.vehicle_presence_status='with_customer' then 'with_customer'
        when c.workshop_arrival_date is not null then 'in_workshop' else 'with_customer' end location,
      floor(extract(epoch from(p_now-c.created_at))/86400)::integer age,
      floor(extract(epoch from((c.policy_expiry_date::timestamp at time zone 'UTC')-p_now))/86400)::integer policy_days
    from public.insurance_claims c where c.tenant_id=p_tenant_id and c.deleted_at is null
  ), payments as materialized (
    select p.id,p.status,p.amount,p.payment_method,p.cheque_due_date,p.payment_number,p.payment_date,p.created_at,
      floor(extract(epoch from((p.cheque_due_date::timestamp at time zone 'UTC')-p_now))/86400)::integer due_days
    from public.claim_payments p where p.tenant_id=p_tenant_id
  ), invoices as materialized (
    select i.id,i.claim_id,i.status,i.total,i.paid_amount,i.settlement_discount_amount,i.invoice_number,i.insurance_company_name,
      i.invoice_date,i.issued_at,i.created_at,i.due_date,
      coalesce(i.total,0)-coalesce(i.paid_amount,0)-coalesce(i.settlement_discount_amount,0) remaining,
      floor(extract(epoch from(p_now-coalesce(i.invoice_date::timestamp at time zone 'UTC',i.issued_at,i.created_at)))/86400)::integer age,
      floor(extract(epoch from(p_now-(i.due_date::timestamp at time zone 'UTC')))/86400)::integer overdue
    from public.insurance_invoices i where i.tenant_id=p_tenant_id
  ), stats as (
    select count(*) total,count(*)filter(where status='pending') pending,count(*)filter(where status='approved') approved,
      count(*)filter(where status='paid') paid,count(*)filter(where status='rejected') rejected,
      coalesce(sum(estimated_amount),0) "estimatedTotal",coalesce(sum(approved_amount),0) "approvedTotal",
      count(*)filter(where location='in_workshop') "inWorkshop",count(*)filter(where location='with_customer') "withCustomer",
      count(*)filter(where location='delivered') "deliveredCount",
      count(*)filter(where delivered_at is null and floor(extract(epoch from(p_now-created_at))/86400+0.5)>30) "overdueClaims"
    from claims
  ), financial as (
    select coalesce((select sum(amount)from payments where status='cleared'),0) paid,
      coalesce((select sum(total)from invoices),0) invoiced,
      (select count(*)from invoices where status not in ('paid','cancelled') and remaining>0.01) awaiting
  ), companies as (
    select coalesce(nullif(insurance_company,''),'—') name,count(*) count,
      coalesce(sum(coalesce(nullif(approved_amount,0),estimated_amount,0)),0) amount,max(created_at) latest
    from claims group by coalesce(nullif(insurance_company,''),'—')
  ), top_companies as (select name,count,amount from companies order by amount desc,latest desc,name limit 5),
  month_slots as (select slot,(date_trunc('month',p_now at time zone p_timezone)+(slot-5)*interval '1 month') as month from generate_series(0,5) slot),
  trend as (
    select s.month,to_char(s.month,'Mon') name,count(c.id) claims,coalesce(sum(c.estimated_amount),0) amount
    from month_slots s left join claims c on date_trunc('month',c.created_at at time zone p_timezone)=s.month group by s.month
  ), bucket_slots as (select * from(values('0-30',0),('31-60',1),('61-90',2),('90+',3))t(name,n)),
  ageing as (
    select b.name,b.n,coalesce(sum(i.remaining),0) value from bucket_slots b left join invoices i
      on i.status not in ('paid','cancelled') and i.remaining>0 and
        (case when i.age<=30 then 0 when i.age<=60 then 1 when i.age<=90 then 2 else 3 end)=b.n group by b.name,b.n
  ), recent as (
    select id,claim_number,status,insurance_company,vehicle_make,vehicle_model,vehicle_plate,estimated_amount
    from claims where location not in ('paid_archive','cancelled') order by created_at desc,id limit 6
  ), alerts as (
    select 'stale-'||c.id id,'stale_pending' type,case when c.age>=14 then 'critical' else 'warning' end severity,
      c.age days,c.claim_number label,c.insurance_company detail,'/insurance/'||c.id href,1 priority,c.created_at ordering,null::numeric amount
    from claims c where c.status='pending' and c.age>=7
    union all
    select 'delivered-no-invoice-'||c.id,'delivered_without_invoice',case when floor(extract(epoch from(p_now-c.delivered_at))/86400)>=7 then 'critical' else 'warning' end,
      floor(extract(epoch from(p_now-c.delivered_at))/86400)::integer,c.claim_number,c.insurance_company,'/insurance/'||c.id,2,c.created_at,null::numeric
    from claims c where c.delivered_at is not null and c.status not in ('paid','cancelled','rejected')
      and floor(extract(epoch from(p_now-c.delivered_at))/86400)>=1 and not exists(select 1 from invoices i where i.claim_id=c.id)
    union all
    select 'pol-'||c.id,'policy_expiring',case when c.policy_days<=7 then 'critical' else 'warning' end,
      c.policy_days,c.claim_number,coalesce(c.policy_number,''),'/insurance/'||c.id,3,c.created_at,null::numeric
    from claims c where c.policy_days between 0 and 30
    union all
    select 'chq-'||p.id,'cheque_due',case when p.due_days<=2 then 'critical' else 'warning' end,
      p.due_days,p.payment_number,'',null,4,(p.payment_date::timestamp at time zone 'UTC'),p.amount
    from payments p where p.payment_method='cheque' and p.status='pending' and p.due_days between 0 and 7
    union all
    select 'inv-'||i.id,'invoice_overdue',case when i.overdue>30 then 'critical' else 'warning' end,
      i.overdue,i.invoice_number,i.insurance_company_name,null,5,coalesce(i.invoice_date::timestamp at time zone 'UTC',i.issued_at),i.total
    from invoices i where i.status not in ('paid','cancelled') and i.overdue>0
  ), critical as (select id,type,severity,days,label,detail,href,amount from alerts where severity='critical' order by priority,ordering desc,id limit 5)
  select jsonb_build_object(
    'stats',to_jsonb(s)||jsonb_build_object('paidTotal',f.paid,'invoicedTotal',f.invoiced,'outstanding',greatest(f.invoiced-f.paid,0),
      'approvalRate',case when s.total>0 then floor((s.approved+s.paid)::numeric/s.total*100+0.5) else 0 end,'completedPendingCollection',f.awaiting),
    'topCompanies',coalesce((select jsonb_agg(to_jsonb(t))from top_companies t),'[]'::jsonb),
    'monthlyTrend',coalesce((select jsonb_agg(jsonb_build_object('name',name,'claims',claims,'amount',amount)order by month)from trend),'[]'::jsonb),
    'agingBuckets',coalesce((select jsonb_agg(jsonb_build_object('name',name,'value',value)order by n)from ageing),'[]'::jsonb),
    'recentClaims',coalesce((select jsonb_agg(to_jsonb(r))from recent r),'[]'::jsonb),
    'criticalAlerts',coalesce((select jsonb_agg(to_jsonb(a))from critical a),'[]'::jsonb),'alertCount',(select count(*)from alerts)
  )into result from stats s cross join financial f;
  return result;
end;
$hub$;
revoke all on function public.insurance_hub_summary_rpc(uuid,timestamptz,text) from public,anon;
grant execute on function public.insurance_hub_summary_rpc(uuid,timestamptz,text) to authenticated;
