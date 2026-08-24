-- Expense classification eligibility hardening (Development first).
-- Additive/read-model only: no expense rows are updated, reclassified, posted,
-- or backfilled. Operating expenses remain workshop-level costs and are never
-- assigned to a vehicle by this view.

create or replace view public.reports_expense_facts_v1
with (security_invoker = true) as
select
  e.tenant_id,
  e.id,
  e.voucher_number,
  e.date,
  coalesce(sub.name_en, cat.name_en, e.category_name) category_name,
  case
    when e.classification_status = 'classified' and e.expense_scope = 'operating'
      then 'workshop_general'
    when e.classification_status = 'classified' and e.expense_scope = 'work_order'
      then 'work_order_direct'
    else coalesce(nullif(e.expense_type, ''), 'unassigned')
  end expense_type,
  e.description,
  e.beneficiary,
  e.payment_method,
  e.supplier_id,
  coalesce(e.claim_id, jo.claim_id) claim_id,
  case when e.expense_scope = 'work_order' then coalesce(e.work_order_id, jo.id) end work_order_id,
  case when e.expense_scope = 'work_order' then coalesce(e.vehicle_id, jo.vehicle_id) end vehicle_id,
  coalesce(
    e.work_order_channel,
    public.reports_classify_business_type(
      coalesce(e.claim_id, jo.claim_id),
      'expense',
      jo.work_order_type
    )
  ) business_type,
  coalesce(nullif(e.subtotal, 0), e.amount, 0)::numeric subtotal,
  coalesce(e.vat_amount, 0)::numeric vat,
  coalesce(nullif(e.total, 0), nullif(e.subtotal, 0), e.amount, 0)::numeric total,
  e.deleted_at,
  e.archived_at,
  e.expense_scope,
  e.accounting_mapping_key,
  e.classification_status,
  e.department_id,
  e.expense_category_id,
  e.subcategory_id,
  e.cost_center_id
from public.expenses e
left join lateral (
  select j.*
  from public.job_orders j
  where j.tenant_id = e.tenant_id
    and (
      j.id = e.work_order_id
      or j.id::text = e.linked_work_order_id
      or j.order_number = e.linked_work_order_id
    )
  order by (j.id = e.work_order_id) desc, j.created_at desc
  limit 1
) jo on true
left join public.insurance_claims claim
  on claim.id = coalesce(e.claim_id, jo.claim_id)
 and claim.tenant_id = e.tenant_id
left join public.expense_categories cat
  on cat.id = e.expense_category_id
 and cat.tenant_id = e.tenant_id
left join public.expense_categories sub
  on sub.id = e.subcategory_id
 and sub.tenant_id = e.tenant_id
where e.deleted_at is null
  and e.archived_at is null
  and lower(coalesce(e.status, 'active')) not in ('cancelled', 'canceled', 'void', 'invalid', 'deleted')
  and (
    e.expense_scope is distinct from 'work_order'
    or (
      jo.id is not null
      and jo.deleted_at is null
      and jo.archived_at is null
      and lower(coalesce(jo.status::text, 'active')) not in ('cancelled', 'canceled', 'void', 'deleted')
    )
  )
  and (
    coalesce(e.claim_id, jo.claim_id) is null
    or (
      claim.id is not null
      and claim.deleted_at is null
      and lower(coalesce(claim.status::text, 'active')) not in ('cancelled', 'canceled', 'void', 'deleted', 'rejected')
    )
  );

revoke all on public.reports_expense_facts_v1 from public, anon;
grant select on public.reports_expense_facts_v1 to authenticated;

comment on view public.reports_expense_facts_v1 is
  'Eligible expense facts only. Vehicle P&L receives classified work-order expenses; operating expenses remain workshop-level and deleted/cancelled parent chains are excluded.';
