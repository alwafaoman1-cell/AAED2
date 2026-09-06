-- One source of truth for expense totals and work-order classification.
-- expenses.amount is the final amount actually paid, inclusive of VAT.
-- VAT is split from it only when the supplier has a tax number.

create or replace function public.sync_expense_financial_totals()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_total numeric(12,3);
  v_subtotal numeric(12,3);
  v_tax_number text;
begin
  v_total := round(coalesce(new.amount, 0)::numeric, 3);

  if new.supplier_id is not null then
    select nullif(btrim(coalesce(s.tax_number, '')), '')
      into v_tax_number
    from public.suppliers s
    where s.id = new.supplier_id and s.tenant_id = new.tenant_id;
  else
    v_tax_number := nullif(btrim(coalesce(
      new.supplier_tax_number,
      new.meta ->> 'supplierTaxNumber',
      ''
    )), '');
  end if;

  new.amount := v_total;
  new.supplier_tax_number := v_tax_number;
  new.is_vat_applicable := v_tax_number is not null;

  if new.is_vat_applicable then
    v_subtotal := round(v_total / 1.05, 3);
    new.subtotal := v_subtotal;
    new.vat_amount := round(v_total - v_subtotal, 3);
  else
    new.subtotal := v_total;
    new.vat_amount := 0;
  end if;

  new.total := v_total;
  return new;
end;
$$;

drop trigger if exists sync_expense_financial_totals_trigger on public.expenses;
create trigger sync_expense_financial_totals_trigger
before insert or update of amount, supplier_id, supplier_tax_number,
  is_vat_applicable, subtotal, vat_amount, total
on public.expenses
for each row
execute function public.sync_expense_financial_totals();

-- Legacy clients saved an exact work-order reference but did not populate
-- expense_scope. Resolve only real, active orders in the same tenant. No
-- category, amount, date, voucher or supplier is inferred or replaced.
alter table public.expenses disable trigger derive_expense_work_order_context_trigger;

update public.expenses e
set work_order_id = j.id,
    linked_work_order_id = j.order_number,
    expense_scope = 'work_order',
    work_order_channel = case
      when j.claim_id is not null
        or lower(coalesce(j.work_order_type, '')) = 'insurance'
        or exists (
          select 1 from public.insurance_claims c
          where c.tenant_id = e.tenant_id and c.deleted_at is null
            and (c.job_order_id = j.id or c.auto_job_order_id = j.id)
        )
      then 'insurance'
      else 'cash'
    end,
    vehicle_id = coalesce(e.vehicle_id, j.vehicle_id),
    customer_id = coalesce(e.customer_id, j.customer_id),
    claim_id = coalesce(
      e.claim_id,
      j.claim_id,
      (
        select c.id from public.insurance_claims c
        where c.tenant_id = e.tenant_id and c.deleted_at is null
          and (c.job_order_id = j.id or c.auto_job_order_id = j.id)
        limit 1
      )
    )
from public.job_orders j
where e.tenant_id = j.tenant_id
  and e.deleted_at is null
  and j.deleted_at is null
  and (
    e.work_order_id = j.id
    or nullif(btrim(coalesce(e.linked_work_order_id, '')), '') in (j.id::text, j.order_number)
    or nullif(btrim(coalesce(e.meta ->> 'sourceWorkOrderId', '')), '') in (j.id::text, j.order_number)
  )
  and (
    e.work_order_id is distinct from j.id
    or e.linked_work_order_id is distinct from j.order_number
    or e.expense_scope is distinct from 'work_order'
  );

alter table public.expenses enable trigger derive_expense_work_order_context_trigger;

-- Rebuild derived totals for active rows. The trigger keeps amount unchanged
-- and obtains VAT eligibility from the authoritative supplier record.
update public.expenses
set amount = round(coalesce(amount, 0)::numeric, 3)
where deleted_at is null;

alter table public.expenses
  drop constraint if exists expenses_vat_requires_supplier_tax_number_check;
alter table public.expenses
  add constraint expenses_vat_requires_supplier_tax_number_check
  check (
    not coalesce(is_vat_applicable, false)
    or nullif(btrim(coalesce(supplier_tax_number, '')), '') is not null
  ) not valid;

comment on function public.sync_expense_financial_totals() is
  'Treats expenses.amount as VAT-inclusive paid total; splits Oman VAT only for suppliers with a tax number.';
