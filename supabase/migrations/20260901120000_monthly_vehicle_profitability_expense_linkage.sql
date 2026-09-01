-- Restore work-order expense linkage in monthly vehicle profitability.
--
-- This is a read-model correction only:
--   * no historical expense is updated or reclassified;
--   * explicit operating expenses remain workshop-level overhead;
--   * legacy expenses with a real work-order/vehicle link are treated as
--     direct costs by the reporting view while retaining their source row;
--   * archived work orders remain valid historical parents (deleted or
--     cancelled parents are still excluded);
--   * accounting_mapping_key is exposed as the direct-cost classifier so
--     parts_direct_cost is not guessed from translated category labels.

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
    ) as has_work_order_reference
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
  'Eligible expense facts with compatibility linkage for legacy work-order expenses. Operating expenses stay workshop-level; deleted/cancelled parent chains remain excluded; archived work orders remain reportable.';
