-- Add a server-side supplier invoice number filter to both expense rows and
-- aggregates. Preserve tenant, permission, archive/deletion and parent rules.
-- No historical expense rows are changed.
create or replace function public.expense_management_rpc(
 p_page integer default 1,p_page_size integer default 50,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.get_user_tenant_id(); v_rows jsonb; v_total bigint; v_agg jsonb;
 v_limit integer:=least(greatest(coalesce(p_page_size,50),1),500);
 v_offset integer:=greatest(coalesce(p_page,1)-1,0)*least(greatest(coalesce(p_page_size,50),1),500);
begin
 if not public.expense_has_permission('expenses.view') then raise exception 'EXPENSE_PERMISSION_DENIED'; end if;
 with facts as (
  select e.*,j.order_number,j.work_order_type,v.plate_number as plate,v.plate_letters,v.brand as make,v.model,
   cu.name customer_name,c.claim_number,c.insurance_company,
   coalesce(s.name,nullif(e.beneficiary,''),nullif(e.meta->>'supplierName','')) supplier_name,
   d.name_ar department_ar,d.name_en department_en,cat.name_ar category_ar,cat.name_en category_en,
   sub.name_ar subcategory_ar,sub.name_en subcategory_en,cc.name_ar cost_center_ar,cc.name_en cost_center_en
  from public.expenses e
  left join public.job_orders j on j.id=e.work_order_id and j.tenant_id=e.tenant_id
  left join public.vehicles v on v.id=e.vehicle_id and v.tenant_id=e.tenant_id
  left join public.customers cu on cu.id=e.customer_id and cu.tenant_id=e.tenant_id
  left join public.insurance_claims c on c.id=e.claim_id and c.tenant_id=e.tenant_id
  left join public.suppliers s on s.id=e.supplier_id and s.tenant_id=e.tenant_id
  left join public.expense_categories d on d.id=e.department_id
  left join public.expense_categories cat on cat.id=e.expense_category_id
  left join public.expense_categories sub on sub.id=e.subcategory_id
  left join public.accounting_cost_centers cc on cc.id=e.cost_center_id
  where e.tenant_id=v_tenant and e.deleted_at is null and e.archived_at is null
   and lower(coalesce(e.status,'active')) not in ('cancelled','void','invalid')
   and (e.expense_scope is distinct from 'work_order' or (j.id is not null and j.deleted_at is null))
   and (e.claim_id is null or (c.id is not null and lower(c.status::text) not in ('cancelled','deleted')))
   and (nullif(p_filters->>'from','') is null or e.date>=(p_filters->>'from')::date)
   and (nullif(p_filters->>'to','') is null or e.date<=(p_filters->>'to')::date)
   and (nullif(p_filters->>'scope','') is null or e.expense_scope=p_filters->>'scope')
   and (nullif(p_filters->>'channel','') is null or e.work_order_channel=p_filters->>'channel')
   and (nullif(p_filters->>'work_order_id','') is null or e.work_order_id=(p_filters->>'work_order_id')::uuid)
   and (nullif(p_filters->>'claim_id','') is null or e.claim_id=(p_filters->>'claim_id')::uuid)
   and (nullif(p_filters->>'vehicle_id','') is null or e.vehicle_id=(p_filters->>'vehicle_id')::uuid)
   and (nullif(p_filters->>'customer_id','') is null or e.customer_id=(p_filters->>'customer_id')::uuid)
   and (nullif(p_filters->>'department_id','') is null or e.department_id=(p_filters->>'department_id')::uuid)
   and (nullif(p_filters->>'category_id','') is null or e.expense_category_id=(p_filters->>'category_id')::uuid)
   and (nullif(p_filters->>'subcategory_id','') is null or e.subcategory_id=(p_filters->>'subcategory_id')::uuid)
   and (nullif(p_filters->>'supplier_id','') is null or e.supplier_id=(p_filters->>'supplier_id')::uuid)
   and (nullif(p_filters->>'payment_method','') is null or e.payment_method=p_filters->>'payment_method')
   and (nullif(p_filters->>'cost_center_id','') is null or e.cost_center_id=(p_filters->>'cost_center_id')::uuid)
   and (nullif(p_filters->>'insurance_company','') is null or coalesce(c.insurance_company,'') ilike '%'||(p_filters->>'insurance_company')||'%')
   and (nullif(p_filters->>'classification_status','') is null or e.classification_status=p_filters->>'classification_status')
   and (nullif(p_filters->>'work_order','') is null or coalesce(j.order_number,'') ilike '%'||(p_filters->>'work_order')||'%')
   and (nullif(p_filters->>'claim','') is null or coalesce(c.claim_number,'') ilike '%'||(p_filters->>'claim')||'%')
   and (nullif(p_filters->>'vehicle','') is null or concat_ws(' ',v.plate_number,v.plate_letters) ilike '%'||(p_filters->>'vehicle')||'%')
   and (nullif(p_filters->>'customer','') is null or coalesce(cu.name,'') ilike '%'||(p_filters->>'customer')||'%')
   and (nullif(p_filters->>'supplier','') is null or position(lower(btrim(p_filters->>'supplier')) in lower(concat_ws(' ',s.name,e.beneficiary,e.meta->>'supplierName')))>0)
   and (nullif(p_filters->>'supplier_invoice_number','') is null or position(lower(btrim(p_filters->>'supplier_invoice_number')) in lower(concat_ws(' ',e.supplier_invoice_number,e.meta->>'supplierInvoiceNumber')))>0)
   and (nullif(p_filters->>'amount_from','') is null or coalesce(nullif(e.total,0),e.amount)>=(p_filters->>'amount_from')::numeric)
   and (nullif(p_filters->>'amount_to','') is null or coalesce(nullif(e.total,0),e.amount)<=(p_filters->>'amount_to')::numeric)
   and (nullif(p_filters->>'vat','') is null or (case when p_filters->>'vat'='vat' then e.vat_amount>0 else e.vat_amount=0 end))
   and (nullif(p_filters->>'search','') is null or e.voucher_number ilike '%'||(p_filters->>'search')||'%'
      or coalesce(e.description,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(j.order_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(v.plate_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(s.name,'') ilike '%'||(p_filters->>'search')||'%')
 ), counted as(select *,count(*) over() full_count from facts)
 select coalesce(jsonb_agg(to_jsonb(x)-'full_count'),'[]'),coalesce(max(full_count),0)
 into v_rows,v_total from(select * from counted order by date desc,created_at desc offset v_offset limit v_limit)x;
 with eligible as (
  select e.* from public.expenses e left join public.job_orders j on j.id=e.work_order_id and j.tenant_id=e.tenant_id
  left join public.insurance_claims c on c.id=e.claim_id and c.tenant_id=e.tenant_id
  left join public.vehicles v on v.id=e.vehicle_id and v.tenant_id=e.tenant_id
  left join public.customers cu on cu.id=e.customer_id and cu.tenant_id=e.tenant_id
  left join public.suppliers s on s.id=e.supplier_id and s.tenant_id=e.tenant_id
  where e.tenant_id=v_tenant and e.deleted_at is null and e.archived_at is null
   and lower(coalesce(e.status,'active')) not in ('cancelled','void','invalid')
   and (e.expense_scope is distinct from 'work_order' or (j.id is not null and j.deleted_at is null))
   and (e.claim_id is null or (c.id is not null and lower(c.status::text) not in ('cancelled','deleted')))
   and (nullif(p_filters->>'from','') is null or e.date>=(p_filters->>'from')::date)
   and (nullif(p_filters->>'to','') is null or e.date<=(p_filters->>'to')::date)
   and (nullif(p_filters->>'scope','') is null or e.expense_scope=p_filters->>'scope')
   and (nullif(p_filters->>'channel','') is null or e.work_order_channel=p_filters->>'channel')
   and (nullif(p_filters->>'work_order_id','') is null or e.work_order_id=(p_filters->>'work_order_id')::uuid)
   and (nullif(p_filters->>'claim_id','') is null or e.claim_id=(p_filters->>'claim_id')::uuid)
   and (nullif(p_filters->>'vehicle_id','') is null or e.vehicle_id=(p_filters->>'vehicle_id')::uuid)
   and (nullif(p_filters->>'customer_id','') is null or e.customer_id=(p_filters->>'customer_id')::uuid)
   and (nullif(p_filters->>'department_id','') is null or e.department_id=(p_filters->>'department_id')::uuid)
   and (nullif(p_filters->>'category_id','') is null or e.expense_category_id=(p_filters->>'category_id')::uuid)
   and (nullif(p_filters->>'subcategory_id','') is null or e.subcategory_id=(p_filters->>'subcategory_id')::uuid)
   and (nullif(p_filters->>'supplier_id','') is null or e.supplier_id=(p_filters->>'supplier_id')::uuid)
   and (nullif(p_filters->>'payment_method','') is null or e.payment_method=p_filters->>'payment_method')
   and (nullif(p_filters->>'cost_center_id','') is null or e.cost_center_id=(p_filters->>'cost_center_id')::uuid)
   and (nullif(p_filters->>'insurance_company','') is null or coalesce(c.insurance_company,'') ilike '%'||(p_filters->>'insurance_company')||'%')
   and (nullif(p_filters->>'classification_status','') is null or e.classification_status=p_filters->>'classification_status')
   and (nullif(p_filters->>'work_order','') is null or coalesce(j.order_number,'') ilike '%'||(p_filters->>'work_order')||'%')
   and (nullif(p_filters->>'claim','') is null or coalesce(c.claim_number,'') ilike '%'||(p_filters->>'claim')||'%')
   and (nullif(p_filters->>'vehicle','') is null or concat_ws(' ',v.plate_number,v.plate_letters) ilike '%'||(p_filters->>'vehicle')||'%')
   and (nullif(p_filters->>'customer','') is null or coalesce(cu.name,'') ilike '%'||(p_filters->>'customer')||'%')
   and (nullif(p_filters->>'supplier','') is null or position(lower(btrim(p_filters->>'supplier')) in lower(concat_ws(' ',s.name,e.beneficiary,e.meta->>'supplierName')))>0)
   and (nullif(p_filters->>'supplier_invoice_number','') is null or position(lower(btrim(p_filters->>'supplier_invoice_number')) in lower(concat_ws(' ',e.supplier_invoice_number,e.meta->>'supplierInvoiceNumber')))>0)
   and (nullif(p_filters->>'amount_from','') is null or coalesce(nullif(e.total,0),e.amount)>=(p_filters->>'amount_from')::numeric)
   and (nullif(p_filters->>'amount_to','') is null or coalesce(nullif(e.total,0),e.amount)<=(p_filters->>'amount_to')::numeric)
   and (nullif(p_filters->>'vat','') is null or (case when p_filters->>'vat'='vat' then e.vat_amount>0 else e.vat_amount=0 end))
   and (nullif(p_filters->>'search','') is null or e.voucher_number ilike '%'||(p_filters->>'search')||'%'
      or coalesce(e.description,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(j.order_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(v.plate_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(s.name,'') ilike '%'||(p_filters->>'search')||'%')
 ) select jsonb_build_object(
   'total',coalesce(sum(coalesce(nullif(total,0),amount)),0),
   'cashWorkOrders',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='work_order' and work_order_channel='cash'),0),
   'insuranceWorkOrders',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='work_order' and work_order_channel='insurance'),0),
   'operating',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='operating'),0),
   'vat',coalesce(sum(vat_amount),0),
   'directCosts',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='work_order'),0),
   'operatingCosts',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='operating'),0)
  ) into v_agg from eligible;
 return jsonb_build_object('rows',v_rows,'aggregates',v_agg,'pagination',jsonb_build_object(
  'page',greatest(coalesce(p_page,1),1),'pageSize',v_limit,'totalRows',v_total,
  'totalPages',case when v_total=0 then 0 else ceil(v_total::numeric/v_limit)::int end),
  'generatedAt',now(),'basis','eligible_expenses_server_side');
end $$;
revoke all on function public.expense_management_rpc(integer,integer,jsonb) from public,anon;
grant execute on function public.expense_management_rpc(integer,integer,jsonb) to authenticated;
