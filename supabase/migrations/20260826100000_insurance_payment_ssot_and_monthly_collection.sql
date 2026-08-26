-- Insurance collection SSOT hardening.
-- Revenue remains invoice-date based; collection remains actual payment-date based.
-- Legacy paid_amount differences are converted once into traceable claim_payments.

create unique index if not exists uq_claim_payments_legacy_reconciliation
  on public.claim_payments (tenant_id, offset_against_invoice_id, reference_number)
  where reference_number like 'LEGACY-PAID:%';

with payment_totals as materialized (
  select
    tenant_id,
    claim_id,
    coalesce(sum(amount) filter (where status = 'cleared'), 0)::numeric as cleared_amount
  from public.claim_payments
  group by tenant_id, claim_id
),
candidates as materialized (
  select
    i.tenant_id,
    i.id as invoice_id,
    i.claim_id,
    i.insurance_company_id,
    round((coalesce(i.paid_amount, 0) - coalesce(p.cleared_amount, 0))::numeric, 3) as missing_amount,
    least(
      coalesce(i.last_payment_date::date, i.updated_at::date, i.invoice_date, i.issued_at::date, current_date),
      current_date
    ) as inferred_payment_date
  from public.insurance_invoices i
  left join payment_totals p
    on p.tenant_id = i.tenant_id
   and p.claim_id = i.claim_id
  where lower(coalesce(i.status, 'issued')) not in ('cancelled', 'canceled', 'void', 'deleted')
    and coalesce(i.paid_amount, 0) - coalesce(p.cleared_amount, 0) > 0.001
),
inserted as (
  insert into public.claim_payments (
    tenant_id,
    claim_id,
    insurance_company_id,
    payment_number,
    amount,
    payment_method,
    payment_date,
    reference_number,
    offset_against_invoice_id,
    status,
    notes
  )
  select
    c.tenant_id,
    c.claim_id,
    c.insurance_company_id,
    'IP-REC-' || upper(left(replace(c.invoice_id::text, '-', ''), 12)),
    c.missing_amount,
    'bank_transfer'::public.claim_payment_method,
    c.inferred_payment_date,
    'LEGACY-PAID:' || c.invoice_id::text,
    c.invoice_id,
    'cleared'::public.claim_payment_status,
    'Reconciled from legacy insurance invoice paid amount; original payment method was not stored.'
  from candidates c
  on conflict (tenant_id, offset_against_invoice_id, reference_number)
    where reference_number like 'LEGACY-PAID:%'
  do nothing
  returning id, tenant_id, claim_id, offset_against_invoice_id, amount, payment_date
)
insert into public.claim_audit_logs (
  tenant_id,
  claim_id,
  action,
  details
)
select
  i.tenant_id,
  i.claim_id,
  'insurance_payment_legacy_reconciled',
  jsonb_build_object(
    'payment_id', i.id,
    'invoice_id', i.offset_against_invoice_id,
    'amount', i.amount,
    'payment_date', i.payment_date,
    'source', 'insurance_invoices.paid_amount',
    'method_provenance', 'unknown_legacy_value_recorded_as_bank_transfer'
  )
from inserted i;

create or replace function public.recalc_invoice_on_claim_payment()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_claim_id uuid;
  v_tenant_id uuid;
  v_paid numeric;
  v_last timestamptz;
  v_inv_id uuid;
  v_inv_total numeric;
  v_inv_status text;
begin
  v_claim_id := coalesce(new.claim_id, old.claim_id);
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  if v_claim_id is null or v_tenant_id is null then
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount), 0), max(payment_date::timestamptz)
    into v_paid, v_last
  from public.claim_payments
  where tenant_id = v_tenant_id
    and claim_id = v_claim_id
    and status = 'cleared';

  select id, total
    into v_inv_id, v_inv_total
  from public.insurance_invoices
  where tenant_id = v_tenant_id
    and claim_id = v_claim_id
    and lower(coalesce(status, 'issued')) not in ('cancelled', 'canceled', 'void', 'deleted')
  order by issued_at desc nulls last, created_at desc
  limit 1;

  if v_inv_id is not null then
    v_inv_status := case
      when v_inv_total > 0 and v_paid >= v_inv_total - 0.001 then 'paid'
      when v_paid > 0 then 'partial'
      else 'issued'
    end;

    perform set_config('app.insurance_payment_sync', 'on', true);
    update public.insurance_invoices
       set paid_amount = v_paid,
           status = v_inv_status,
           last_payment_date = v_last,
           updated_at = now()
     where tenant_id = v_tenant_id
       and id = v_inv_id;

    if v_inv_status = 'paid' then
      update public.insurance_claims
         set status = 'paid',
             paid_at = coalesce(paid_at, v_last, now()),
             updated_at = now()
       where tenant_id = v_tenant_id
         and id = v_claim_id
         and status <> 'paid';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.recalc_invoice_on_claim_payment()
  from public, anon, authenticated;

create or replace function public.protect_insurance_invoice_payment_ssot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_paid numeric;
begin
  if current_setting('app.insurance_payment_sync', true) = 'on' then
    return new;
  end if;

  if new.paid_amount is distinct from old.paid_amount then
    raise exception 'INSURANCE_PAID_AMOUNT_REQUIRES_PAYMENT_RECORD'
      using errcode = '23514';
  end if;

  if new.status is distinct from old.status
     and lower(coalesce(new.status, '')) in ('paid', 'partial', 'partially_paid') then
    raise exception 'INSURANCE_PAYMENT_STATUS_REQUIRES_PAYMENT_RECORD'
      using errcode = '23514';
  end if;

  select coalesce(sum(p.amount), 0)
    into v_paid
  from public.claim_payments p
  where p.tenant_id = new.tenant_id
    and p.claim_id = new.claim_id
    and p.status = 'cleared';

  new.paid_amount := v_paid;
  if lower(coalesce(new.status, 'issued')) not in ('cancelled', 'canceled', 'void', 'deleted') then
    if new.total > 0 and v_paid >= new.total - 0.001 then
      new.status := 'paid';
    elsif v_paid > 0 then
      new.status := 'partial';
    elsif lower(coalesce(new.status, '')) not in ('overdue') then
      new.status := 'issued';
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.protect_insurance_invoice_payment_ssot()
  from public, anon, authenticated;

drop trigger if exists trg_protect_insurance_invoice_payment_ssot on public.insurance_invoices;
create trigger trg_protect_insurance_invoice_payment_ssot
before update of paid_amount, status, total, claim_id on public.insurance_invoices
for each row execute function public.protect_insurance_invoice_payment_ssot();

comment on function public.protect_insurance_invoice_payment_ssot() is
  'Keeps insurance invoice paid amount and settlement status derived exclusively from cleared claim_payments.';
