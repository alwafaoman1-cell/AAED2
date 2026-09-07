-- Insurance early-settlement discounts are internal accounting adjustments.
-- They never change the issued invoice total, subtotal, VAT, items, or PDF.

alter table public.claim_payments
  add column if not exists settlement_discount_amount numeric(14,3) not null default 0,
  add column if not exists settlement_discount_reason text,
  add column if not exists settlement_approved_by uuid;

alter table public.claim_payments
  drop constraint if exists claim_payments_settlement_discount_nonnegative;
alter table public.claim_payments
  add constraint claim_payments_settlement_discount_nonnegative
  check (settlement_discount_amount >= 0);

alter table public.insurance_invoices
  add column if not exists settlement_discount_amount numeric(14,3) not null default 0;

alter table public.insurance_invoices
  drop constraint if exists insurance_invoices_settlement_discount_nonnegative;
alter table public.insurance_invoices
  add constraint insurance_invoices_settlement_discount_nonnegative
  check (settlement_discount_amount >= 0);

create index if not exists idx_claim_payments_invoice_settlement
  on public.claim_payments (tenant_id, offset_against_invoice_id)
  where status = 'cleared' and settlement_discount_amount > 0;

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
  v_discount numeric;
  v_last timestamptz;
  v_inv_id uuid;
  v_inv_total numeric;
  v_inv_status text;
begin
  v_claim_id := coalesce(new.claim_id, old.claim_id);
  v_tenant_id := coalesce(new.tenant_id, old.tenant_id);
  if v_claim_id is null or v_tenant_id is null then return coalesce(new, old); end if;

  select
    coalesce(sum(amount), 0),
    coalesce(sum(settlement_discount_amount), 0),
    max(payment_date::timestamptz)
  into v_paid, v_discount, v_last
  from public.claim_payments
  where tenant_id = v_tenant_id
    and claim_id = v_claim_id
    and status = 'cleared';

  select id, total into v_inv_id, v_inv_total
  from public.insurance_invoices
  where tenant_id = v_tenant_id
    and claim_id = v_claim_id
    and lower(coalesce(status, 'issued')) not in ('cancelled','canceled','void','deleted')
  order by issued_at desc nulls last, created_at desc
  limit 1;

  if v_inv_id is not null then
    v_inv_status := case
      when v_inv_total > 0 and v_paid + v_discount >= v_inv_total - 0.001 then 'paid'
      when v_paid > 0 or v_discount > 0 then 'partial'
      else 'issued'
    end;

    perform set_config('app.insurance_payment_sync', 'on', true);
    update public.insurance_invoices
       set paid_amount = round(v_paid, 3),
           settlement_discount_amount = round(v_discount, 3),
           status = v_inv_status,
           last_payment_date = v_last,
           updated_at = now()
     where tenant_id = v_tenant_id and id = v_inv_id;

    if v_inv_status = 'paid' then
      update public.insurance_claims
         set status = 'paid', paid_at = coalesce(paid_at, v_last, now()), updated_at = now()
       where tenant_id = v_tenant_id and id = v_claim_id and status <> 'paid';
    elsif exists (
      select 1 from public.insurance_claims
      where tenant_id = v_tenant_id and id = v_claim_id and status = 'paid'
    ) then
      update public.insurance_claims
         set status = 'approved', paid_at = null, updated_at = now()
       where tenant_id = v_tenant_id and id = v_claim_id;
    end if;
  end if;
  return coalesce(new, old);
end;
$$;

create or replace function public.validate_insurance_settlement_discount()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  new.amount := round(coalesce(new.amount,0),3);
  new.settlement_discount_amount := round(coalesce(new.settlement_discount_amount,0),3);
  if new.settlement_discount_amount = 0 then
    new.settlement_discount_reason := null;
    new.settlement_approved_by := null;
    return new;
  end if;
  if auth.role() <> 'service_role' and public.get_user_role()::text not in ('admin','manager') then
    raise exception 'SETTLEMENT_DISCOUNT_APPROVAL_REQUIRED';
  end if;
  if new.status <> 'cleared' or btrim(coalesce(new.settlement_discount_reason,'')) = '' then
    raise exception 'SETTLEMENT_DISCOUNT_REASON_REQUIRED';
  end if;
  if auth.role() <> 'service_role' then new.settlement_approved_by := auth.uid(); end if;
  if new.settlement_approved_by is null then raise exception 'SETTLEMENT_DISCOUNT_APPROVER_REQUIRED'; end if;
  return new;
end;
$$;

drop trigger if exists trg_validate_insurance_settlement_discount on public.claim_payments;
create trigger trg_validate_insurance_settlement_discount
before insert or update of amount, status, settlement_discount_amount, settlement_discount_reason
on public.claim_payments
for each row execute function public.validate_insurance_settlement_discount();

create or replace function public.protect_insurance_invoice_payment_ssot()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare v_paid numeric; v_discount numeric;
begin
  if current_setting('app.insurance_payment_sync', true) = 'on' then return new; end if;
  if new.paid_amount is distinct from old.paid_amount
     or new.settlement_discount_amount is distinct from old.settlement_discount_amount then
    raise exception 'INSURANCE_SETTLEMENT_REQUIRES_PAYMENT_RECORD' using errcode = '23514';
  end if;
  if new.status is distinct from old.status
     and lower(coalesce(new.status, '')) in ('paid','partial','partially_paid') then
    raise exception 'INSURANCE_PAYMENT_STATUS_REQUIRES_PAYMENT_RECORD' using errcode = '23514';
  end if;
  select coalesce(sum(p.amount),0), coalesce(sum(p.settlement_discount_amount),0)
    into v_paid, v_discount
  from public.claim_payments p
  where p.tenant_id = new.tenant_id and p.claim_id = new.claim_id and p.status = 'cleared';
  new.paid_amount := round(v_paid,3);
  new.settlement_discount_amount := round(v_discount,3);
  if lower(coalesce(new.status,'issued')) not in ('cancelled','canceled','void','deleted') then
    if new.total > 0 and v_paid + v_discount >= new.total - 0.001 then new.status := 'paid';
    elsif v_paid > 0 or v_discount > 0 then new.status := 'partial';
    elsif lower(coalesce(new.status,'')) <> 'overdue' then new.status := 'issued';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_protect_insurance_invoice_payment_ssot on public.insurance_invoices;
create trigger trg_protect_insurance_invoice_payment_ssot
before update of paid_amount, settlement_discount_amount, status, total, claim_id
on public.insurance_invoices
for each row execute function public.protect_insurance_invoice_payment_ssot();

create or replace function public.create_insurance_payment_with_settlement(
  p_claim_id uuid,
  p_amount numeric,
  p_payment_method public.claim_payment_method,
  p_payment_date date,
  p_invoice_id uuid default null,
  p_insurance_company_id uuid default null,
  p_reference_number text default null,
  p_bank_name text default null,
  p_cheque_due_date date default null,
  p_status public.claim_payment_status default 'cleared',
  p_notes text default null,
  p_settlement_discount_amount numeric default 0,
  p_settlement_discount_reason text default null,
  p_payment_id uuid default gen_random_uuid()
)
returns public.claim_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_role text := public.get_user_role()::text;
  v_invoice public.insurance_invoices%rowtype;
  v_payment public.claim_payments%rowtype;
  v_paid numeric;
  v_discount numeric;
  v_remaining numeric;
  v_amount numeric := round(coalesce(p_amount,0),3);
  v_new_discount numeric := round(coalesce(p_settlement_discount_amount,0),3);
begin
  if auth.uid() is null or v_tenant is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_role not in ('admin','manager','insurance') then raise exception 'INSURANCE_PAYMENT_PERMISSION_DENIED'; end if;
  if v_amount <= 0 then raise exception 'PAYMENT_AMOUNT_INVALID'; end if;
  if v_new_discount < 0 then raise exception 'SETTLEMENT_DISCOUNT_INVALID'; end if;
  if v_new_discount > 0 and v_role not in ('admin','manager') then
    raise exception 'SETTLEMENT_DISCOUNT_APPROVAL_REQUIRED';
  end if;
  if v_new_discount > 0 and (p_status <> 'cleared' or btrim(coalesce(p_settlement_discount_reason,'')) = '') then
    raise exception 'SETTLEMENT_DISCOUNT_REASON_REQUIRED';
  end if;

  select * into v_payment from public.claim_payments
  where tenant_id=v_tenant and id=p_payment_id;
  if found then return v_payment; end if;

  select * into v_invoice
  from public.insurance_invoices i
  where i.tenant_id=v_tenant and i.claim_id=p_claim_id
    and (p_invoice_id is null or i.id=p_invoice_id)
    and lower(coalesce(i.status,'issued')) not in ('cancelled','canceled','void','deleted')
  order by (i.id=p_invoice_id) desc nulls last, i.issued_at desc nulls last, i.created_at desc
  limit 1 for update;
  if not found then raise exception 'INSURANCE_INVOICE_NOT_FOUND'; end if;

  select coalesce(sum(amount),0), coalesce(sum(settlement_discount_amount),0)
    into v_paid, v_discount
  from public.claim_payments
  where tenant_id=v_tenant and claim_id=p_claim_id and status='cleared';
  v_remaining := round(greatest(v_invoice.total-v_paid-v_discount,0),3);
  if v_remaining <= 0.001 then raise exception 'INSURANCE_INVOICE_ALREADY_SETTLED'; end if;
  if v_amount + v_new_discount > v_remaining + 0.001 then raise exception 'PAYMENT_EXCEEDS_REMAINING'; end if;
  if v_new_discount > 0 and abs((v_amount+v_new_discount)-v_remaining) > 0.001 then
    raise exception 'SETTLEMENT_DISCOUNT_MUST_CLOSE_INVOICE';
  end if;

  insert into public.claim_payments(
    id,tenant_id,claim_id,insurance_company_id,payment_number,amount,payment_method,
    payment_date,reference_number,bank_name,cheque_due_date,offset_against_invoice_id,
    status,notes,settlement_discount_amount,settlement_discount_reason,settlement_approved_by
  ) values (
    p_payment_id,v_tenant,p_claim_id,coalesce(p_insurance_company_id,v_invoice.insurance_company_id),'',v_amount,p_payment_method,
    p_payment_date,nullif(btrim(p_reference_number),''),nullif(btrim(p_bank_name),''),p_cheque_due_date,v_invoice.id,
    p_status,nullif(btrim(p_notes),''),v_new_discount,nullif(btrim(p_settlement_discount_reason),''),
    case when v_new_discount>0 then auth.uid() else null end
  ) returning * into v_payment;

  if v_new_discount > 0 then
    insert into public.claim_audit_logs(tenant_id,claim_id,action,details,user_id)
    values(v_tenant,p_claim_id,'insurance_early_settlement_discount',jsonb_build_object(
      'invoice_id',v_invoice.id,'payment_id',v_payment.id,'invoice_total',v_invoice.total,
      'cash_received',v_amount,'settlement_discount',v_new_discount,'reason',p_settlement_discount_reason
    ),auth.uid());
  end if;
  return v_payment;
end;
$$;

revoke all on function public.create_insurance_payment_with_settlement(uuid,numeric,public.claim_payment_method,date,uuid,uuid,text,text,date,public.claim_payment_status,text,numeric,text,uuid) from public, anon;
grant execute on function public.create_insurance_payment_with_settlement(uuid,numeric,public.claim_payment_method,date,uuid,uuid,text,text,date,public.claim_payment_status,text,numeric,text,uuid) to authenticated, service_role;

-- Preserve the existing source resolver for every source except claim_payment,
-- then enrich claim payments so cloud posting debits actual cash and the
-- internal discount separately while clearing the full insurance receivable.
do $$
begin
  if to_regprocedure('public.accounting_get_source_posting_snapshot_base(uuid,text,uuid)') is null
     and to_regprocedure('public.accounting_get_source_posting_snapshot(uuid,text,uuid)') is not null then
    alter function public.accounting_get_source_posting_snapshot(uuid,text,uuid)
      rename to accounting_get_source_posting_snapshot_base;
  end if;
end;
$$;

create or replace function public.accounting_get_source_posting_snapshot(
  p_tenant_id uuid,p_source_type text,p_source_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare v_result jsonb;
begin
  if lower(btrim(coalesce(p_source_type,''))) <> 'claim_payment' then
    return public.accounting_get_source_posting_snapshot_base(p_tenant_id,p_source_type,p_source_id);
  end if;
  if p_tenant_id is null or p_source_id is null then raise exception 'ACCOUNTING_SOURCE_REQUIRED'; end if;
  if p_tenant_id <> public.get_user_tenant_id()
     or not public.accounting_has_permission('accounting.view_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;
  if not public.is_accounting_source_eligible(p_tenant_id,'claim_payment',p_source_id) then
    raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
  end if;

  select jsonb_build_object(
    'source_number',p.payment_number,'source_status',p.status::text,'document_date',p.payment_date,
    'net_amount',round(p.settlement_discount_amount::numeric,3),'vat_amount',0::numeric,
    'total_amount',round((p.amount+p.settlement_discount_amount)::numeric,3),
    'amount',round(p.amount::numeric,3),'business_type','insurance',
    'receivable_mapping_key','insurance_receivable','payment_mapping_key',case
      when p.payment_method::text in ('bank_transfer','cheque') then 'bank'
      when p.payment_method::text='cash' then 'cash' else 'payment_clearing' end,
    'payment_method',p.payment_method::text,'claim_id',p.claim_id,
    'work_order_id',coalesce(c.job_order_id,c.auto_job_order_id),'vehicle_id',c.vehicle_id,
    'invoice_id',i.id,'payment_id',p.id,'party_type','insurance_company',
    'party_id',coalesce(p.insurance_company_id,i.insurance_company_id),
    'settlement_discount_reason',p.settlement_discount_reason
  ) into v_result
  from public.claim_payments p
  join public.insurance_claims c on c.id=p.claim_id and c.tenant_id=p.tenant_id
  left join lateral (
    select ii.id,ii.insurance_company_id from public.insurance_invoices ii
    where ii.tenant_id=p.tenant_id and ii.claim_id=p.claim_id
      and (p.offset_against_invoice_id is null or ii.id=p.offset_against_invoice_id)
      and lower(coalesce(ii.status,'')) in ('issued','partial','paid','overdue')
    order by (ii.id=p.offset_against_invoice_id) desc nulls last,
      coalesce(ii.invoice_date,ii.issued_at::date) desc,ii.created_at desc limit 1
  ) i on true
  where p.tenant_id=p_tenant_id and p.id=p_source_id and p.status='cleared' and p.amount>0 and i.id is not null;
  if v_result is null then raise exception 'ACCOUNTING_SOURCE_NOT_FOUND'; end if;
  return v_result;
end;
$$;

revoke all on function public.accounting_get_source_posting_snapshot(uuid,text,uuid) from public,anon;
grant execute on function public.accounting_get_source_posting_snapshot(uuid,text,uuid) to authenticated;

update public.accounting_posting_rules
set configuration='{"lines":[{"side":"debit","mapping_key":"$payment_account","amount":"amount"},{"side":"debit","mapping_key":"discounts","amount":"net_amount","omit_if_zero":true},{"side":"credit","mapping_key":"$receivable","amount":"total_amount"}]}'::jsonb,
    updated_at=now()
where source_type='claim_payment' and event_type='clear' and rule_key='claim-payment-clear';

comment on column public.insurance_invoices.settlement_discount_amount is
  'Internal early-settlement adjustment; excluded from issued invoice totals and PDF.';
