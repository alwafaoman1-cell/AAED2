-- Reliable monthly invoice revenue allocation.
--
-- Some work-order invoices were generated with one generic line classified as
-- parts. Treating that line as the full parts sale produced zero labour revenue
-- even when the linked real parts purchase was small (or absent). Keep a genuine
-- mixed invoice split. When a work-order expense stores quantity, buy price and
-- sell price, its sell price is authoritative for parts revenue; the remainder is
-- labour/service revenue. If no sell price exists, actual matched parts cost is the
-- conservative fallback. Total recognized revenue, VAT, direct cost and vehicle
-- profit remain unchanged.

-- Preserve historical rows and correct only the reporting classification. Older
-- work-order expense records can carry their authoritative parts fields in meta
-- even when the later accounting category columns are empty.
create or replace view public.reports_expense_facts_v1
with (security_invoker = true) as
with resolved as (
  select
    e.*,
    jo.id as resolved_work_order_id,
    jo.vehicle_id as resolved_vehicle_id,
    jo.claim_id as resolved_claim_id,
    jo.work_order_type as resolved_work_order_type,
    jo.deleted_at as resolved_work_order_deleted_at,
    jo.status as resolved_work_order_status,
    coalesce(sub.name_en, cat.name_en, e.category_name) as resolved_category_name,
    (
      e.expense_scope = 'work_order'
      or (
        e.expense_scope is null
        and lower(coalesce(e.expense_type, '')) <> 'workshop_general'
        and (
          e.work_order_id is not null
          or nullif(btrim(coalesce(e.linked_work_order_id, '')), '') is not null
          or nullif(btrim(coalesce(e.meta->>'sourceWorkOrderId', '')), '') is not null
          or e.vehicle_id is not null
        )
      )
    ) as is_direct_vehicle_cost,
    (
      e.work_order_id is not null
      or nullif(btrim(coalesce(e.linked_work_order_id, '')), '') is not null
      or nullif(btrim(coalesce(e.meta->>'sourceWorkOrderId', '')), '') is not null
    ) as has_work_order_reference,
    (
      nullif(btrim(coalesce(e.meta->>'partName', '')), '') is not null
      or nullif(btrim(coalesce(e.meta->>'partNumber', '')), '') is not null
      or nullif(btrim(coalesce(e.meta->>'requiredPartId', '')), '') is not null
      or lower(coalesce(e.meta->>'convertedFromRequiredPart', 'false')) = 'true'
      or case
        when pg_input_is_valid(e.meta->>'unitBuyPrice', 'numeric')
          then (e.meta->>'unitBuyPrice')::numeric > 0
        else false
      end
    ) as has_parts_metadata
  from public.expenses e
  left join lateral (
    select j.*
    from public.job_orders j
    where j.tenant_id = e.tenant_id
      and (
        j.id = e.work_order_id
        or j.id::text = e.linked_work_order_id
        or j.order_number = e.linked_work_order_id
        or j.id::text = nullif(e.meta->>'sourceWorkOrderId', '')
        or j.order_number = nullif(e.meta->>'sourceWorkOrderId', '')
      )
    order by (j.id = e.work_order_id) desc, j.created_at desc
    limit 1
  ) jo on true
  left join public.expense_categories cat
    on cat.id = e.expense_category_id
   and cat.tenant_id = e.tenant_id
  left join public.expense_categories sub
    on sub.id = e.subcategory_id
   and sub.tenant_id = e.tenant_id
)
select
  r.tenant_id,
  r.id,
  r.voucher_number,
  r.date,
  r.resolved_category_name as category_name,
  case
    when r.expense_scope = 'operating' then 'workshop_general'
    when r.is_direct_vehicle_cost and r.has_parts_metadata then 'parts_direct_cost'
    when r.is_direct_vehicle_cost then coalesce(
      nullif(r.accounting_mapping_key, ''),
      nullif(r.expense_type, ''),
      'work_order_direct'
    )
    else coalesce(nullif(r.expense_type, ''), 'unassigned')
  end as expense_type,
  r.description,
  r.beneficiary,
  r.payment_method,
  r.supplier_id,
  case when r.is_direct_vehicle_cost then coalesce(r.claim_id, r.resolved_claim_id) end as claim_id,
  case when r.is_direct_vehicle_cost then coalesce(r.work_order_id, r.resolved_work_order_id) end as work_order_id,
  case when r.is_direct_vehicle_cost then coalesce(r.vehicle_id, r.resolved_vehicle_id) end as vehicle_id,
  case
    when r.is_direct_vehicle_cost then coalesce(
      r.work_order_channel,
      public.reports_classify_business_type(
        coalesce(r.claim_id, r.resolved_claim_id),
        'expense',
        r.resolved_work_order_type
      )
    )
    else r.work_order_channel
  end as business_type,
  coalesce(nullif(r.subtotal, 0), r.amount, 0)::numeric as subtotal,
  coalesce(r.vat_amount, 0)::numeric as vat,
  coalesce(nullif(r.total, 0), nullif(r.subtotal, 0), r.amount, 0)::numeric as total,
  r.deleted_at,
  r.archived_at,
  case when r.is_direct_vehicle_cost then 'work_order' else r.expense_scope end as expense_scope,
  r.accounting_mapping_key,
  r.classification_status,
  r.department_id,
  r.expense_category_id,
  r.subcategory_id,
  r.cost_center_id
from resolved r
left join public.insurance_claims claim
  on claim.id = coalesce(r.claim_id, r.resolved_claim_id)
 and claim.tenant_id = r.tenant_id
where r.deleted_at is null
  and r.archived_at is null
  and lower(coalesce(r.status, 'active')) not in ('cancelled', 'canceled', 'void', 'invalid', 'deleted')
  and (
    not r.is_direct_vehicle_cost
    or not r.has_work_order_reference
    or (
      r.resolved_work_order_id is not null
      and r.resolved_work_order_deleted_at is null
      and lower(coalesce(r.resolved_work_order_status::text, 'active'))
        not in ('cancelled', 'canceled', 'void', 'deleted')
    )
  )
  and (
    coalesce(r.claim_id, r.resolved_claim_id) is null
    or (
      claim.id is not null
      and claim.deleted_at is null
      and lower(coalesce(claim.status::text, 'active'))
        not in ('cancelled', 'canceled', 'void', 'deleted', 'rejected')
    )
  );

revoke all on public.reports_expense_facts_v1 from public, anon;
grant select on public.reports_expense_facts_v1 to authenticated;

comment on view public.reports_expense_facts_v1 is
  'Eligible expense facts with legacy work-order linkage and non-mutating parts classification from authoritative saved part metadata.';

create or replace function public.monthly_vehicle_parts_sale_basis(
  p_row jsonb
) returns numeric
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_work_order_id text := nullif(p_row->>'work_order_id', '');
  v_vehicle_id text := nullif(p_row->>'vehicle_id', '');
  v_matched_parts_cost numeric := greatest(coalesce((p_row->>'parts_cost')::numeric, 0), 0);
  v_lifetime_parts_cost numeric := 0;
  v_lifetime_parts_sale_net numeric := 0;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'ACCOUNTING_REPORT_AUTH_REQUIRED';
  end if;

  select
    coalesce(sum(coalesce(nullif(e.subtotal, 0), e.amount, 0)), 0),
    coalesce(sum(
      case
        when pg_input_is_valid(e.meta->>'unitSellPrice', 'numeric')
             and (e.meta->>'unitSellPrice')::numeric > 0
          then
            (e.meta->>'unitSellPrice')::numeric
            * case
                when pg_input_is_valid(e.meta->>'partQty', 'numeric')
                     and (e.meta->>'partQty')::numeric > 0
                  then (e.meta->>'partQty')::numeric
                else 1
              end
            / 1.05
        else 0
      end
    ), 0)
  into v_lifetime_parts_cost, v_lifetime_parts_sale_net
  from public.expenses e
  where e.tenant_id = v_tenant
    and e.deleted_at is null
    and e.archived_at is null
    and lower(coalesce(e.status, 'active')) not in ('cancelled','canceled','void','invalid','deleted')
    and (
      nullif(btrim(coalesce(e.meta->>'partName', '')), '') is not null
      or nullif(btrim(coalesce(e.meta->>'partNumber', '')), '') is not null
      or nullif(btrim(coalesce(e.meta->>'requiredPartId', '')), '') is not null
      or lower(coalesce(e.meta->>'convertedFromRequiredPart', 'false')) = 'true'
      or e.accounting_mapping_key = 'parts_direct_cost'
    )
    and (
      (
        v_work_order_id is not null
        and (
          e.work_order_id::text = v_work_order_id
          or e.linked_work_order_id = v_work_order_id
          or e.meta->>'sourceWorkOrderId' = v_work_order_id
        )
      )
      or (
        v_work_order_id is null
        and v_vehicle_id is not null
        and e.vehicle_id::text = v_vehicle_id
      )
    );

  if v_lifetime_parts_cost <= 0 or v_lifetime_parts_sale_net <= 0 or v_matched_parts_cost <= 0 then
    return null;
  end if;

  return round(
    v_lifetime_parts_sale_net
    * least(v_matched_parts_cost / nullif(v_lifetime_parts_cost, 0), 1),
    3
  );
end;
$$;

revoke all on function public.monthly_vehicle_parts_sale_basis(jsonb)
  from public, anon, authenticated;

create or replace function public.adjust_monthly_vehicle_revenue_composition(
  p_row jsonb,
  p_authoritative_parts_sale numeric default null
) returns jsonb
language sql
immutable
set search_path = pg_catalog, public
as $$
  with values as (
    select
      greatest(coalesce((p_row->>'recognized_revenue_ex_vat')::numeric, 0), 0) revenue,
      greatest(coalesce((p_row->>'parts_cost')::numeric, 0), 0) parts_cost,
      greatest(coalesce((p_row->>'parts_revenue')::numeric, 0), 0) old_parts_revenue,
      greatest(coalesce((p_row->>'labor_revenue')::numeric, 0), 0) old_labor_revenue
  ), allocation as (
    select *,
      case
        -- Only a real mixed invoice composition is authoritative. It must also
        -- have an actual linked parts purchase; otherwise parts profit is not
        -- recognized from an unsupported label alone.
        when coalesce(p_authoritative_parts_sale, 0) > 0
          then least(revenue, p_authoritative_parts_sale)
        when parts_cost > 0 and old_parts_revenue > 0 and old_labor_revenue > 0
          then least(revenue, old_parts_revenue)
        -- A total-only or single-category invoice is ambiguous. The parts sold
        -- are inferred from the actual matched parts purchase and the remainder
        -- is the workshop labour/service revenue.
        else least(revenue, parts_cost)
      end::numeric adjusted_parts_revenue
    from values
  )
  select p_row
    || jsonb_build_object(
      'parts_revenue', round(adjusted_parts_revenue, 3),
      'labor_revenue', round(greatest(revenue - adjusted_parts_revenue, 0), 3),
      'revenue_composition_source',
        case
          when coalesce(p_authoritative_parts_sale, 0) > 0
            then 'work_order_parts_sell_price'
          when parts_cost > 0 and old_parts_revenue > 0 and old_labor_revenue > 0
            then 'explicit_mixed_invoice_items'
          else 'actual_parts_cost_fallback'
        end,
      'revenue_composition_warning',
        case
          when parts_cost = 0 and old_parts_revenue > 0
            then 'parts_sale_without_linked_purchase_reallocated_to_labor'
          when old_parts_revenue = 0 and parts_cost > 0
            then 'parts_purchase_without_explicit_sale_inferred_at_cost'
          when old_labor_revenue = 0 and revenue > adjusted_parts_revenue
            then 'ambiguous_single_category_invoice_reallocated'
          else null
        end
    )
  from allocation;
$$;

revoke all on function public.adjust_monthly_vehicle_revenue_composition(jsonb,numeric)
  from public, anon, authenticated;

create or replace function public.monthly_vehicle_profitability_v3_rpc(
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
  v_result jsonb;
  v_rows jsonb;
  v_scan jsonb;
  v_scan_row jsonb;
  v_adjusted_row jsonb;
  v_aggregates jsonb;
  v_scan_page integer := 1;
  v_scan_pages integer := 1;
  v_parts_delta numeric := 0;
  v_labor_delta numeric := 0;
begin
  -- v2 preserves invoice references on rows; authorization and tenant isolation
  -- remain enforced by the underlying report function.
  v_result := public.monthly_vehicle_profitability_v2_rpc(
    p_from, p_to, p_business_type, p_search, p_page, p_page_size
  );

  select coalesce(
    jsonb_agg(
      public.adjust_monthly_vehicle_revenue_composition(
        entry.row_data,
        public.monthly_vehicle_parts_sale_basis(entry.row_data)
      )
      order by entry.ordinality
    ),
    '[]'::jsonb
  )
  into v_rows
  from jsonb_array_elements(coalesce(v_result->'rows', '[]'::jsonb))
       with ordinality as entry(row_data, ordinality);

  -- Aggregates must cover every filtered row, not only the visible page.
  loop
    v_scan := public.monthly_vehicle_profitability_rpc(
      p_from, p_to, p_business_type, p_search, v_scan_page, 500
    );
    v_scan_pages := greatest(coalesce((v_scan#>>'{pagination,totalPages}')::integer, 1), 1);

    for v_scan_row in
      select value from jsonb_array_elements(coalesce(v_scan->'rows', '[]'::jsonb))
    loop
      v_adjusted_row := public.adjust_monthly_vehicle_revenue_composition(
        v_scan_row,
        public.monthly_vehicle_parts_sale_basis(v_scan_row)
      );
      v_parts_delta := v_parts_delta
        + coalesce((v_adjusted_row->>'parts_revenue')::numeric, 0)
        - coalesce((v_scan_row->>'parts_revenue')::numeric, 0);
      v_labor_delta := v_labor_delta
        + coalesce((v_adjusted_row->>'labor_revenue')::numeric, 0)
        - coalesce((v_scan_row->>'labor_revenue')::numeric, 0);
    end loop;

    exit when v_scan_page >= v_scan_pages;
    v_scan_page := v_scan_page + 1;
  end loop;

  v_aggregates := coalesce(v_result->'aggregates', '{}'::jsonb)
    || jsonb_build_object(
      'parts_revenue', round(
        coalesce((v_result#>>'{aggregates,parts_revenue}')::numeric, 0) + v_parts_delta,
        3
      ),
      'labor_revenue', round(
        coalesce((v_result#>>'{aggregates,labor_revenue}')::numeric, 0) + v_labor_delta,
        3
      )
    );

  return v_result
    || jsonb_build_object(
      'rows', v_rows,
      'aggregates', v_aggregates,
      'basis', 'payment-month recognition; work-order parts sales use the saved quantity and selling price, parts purchases use actual matched expense cost, and the remainder of recognized net invoice revenue is labour/service revenue'
    );
end;
$$;

revoke all on function public.monthly_vehicle_profitability_v3_rpc(date,date,text,text,integer,integer)
  from public, anon;
grant execute on function public.monthly_vehicle_profitability_v3_rpc(date,date,text,text,integer,integer)
  to authenticated;

comment on function public.monthly_vehicle_profitability_v3_rpc(date,date,text,text,integer,integer) is
  'Monthly vehicle profitability: parts purchase from actual expense cost, parts sale from saved work-order selling price, and remaining net revenue as labour/service. Total revenue, VAT, direct costs and profit are unchanged.';
