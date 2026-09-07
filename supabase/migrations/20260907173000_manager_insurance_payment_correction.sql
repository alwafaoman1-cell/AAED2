-- Manager-only, atomic correction for an existing insurance payment.
-- The issued invoice itself is never edited: its collection state is recalculated
-- from claim_payments by the existing payment SSOT trigger.

alter table public.claim_payments
  add column if not exists edit_version bigint not null default 0;

drop function if exists public.update_insurance_payment_by_manager(
  uuid,timestamptz,numeric,public.claim_payment_method,date,text,text,date,
  public.claim_payment_status,text,numeric,text,text
);

create or replace function public.update_insurance_payment_by_manager(
  p_payment_id uuid,
  p_expected_updated_at timestamptz,
  p_expected_edit_version bigint,
  p_amount numeric,
  p_payment_method public.claim_payment_method,
  p_payment_date date,
  p_reference_number text,
  p_bank_name text,
  p_cheque_due_date date,
  p_status public.claim_payment_status,
  p_notes text,
  p_settlement_discount_amount numeric,
  p_settlement_discount_reason text,
  p_edit_reason text
)
returns public.claim_payments
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_role text := public.get_user_role()::text;
  v_payment public.claim_payments%rowtype;
  v_updated public.claim_payments%rowtype;
  v_invoice public.insurance_invoices%rowtype;
  v_other_paid numeric := 0;
  v_other_discount numeric := 0;
  v_amount numeric := round(coalesce(p_amount, 0), 3);
  v_discount numeric := round(coalesce(p_settlement_discount_amount, 0), 3);
  v_effective_paid numeric := 0;
  v_effective_discount numeric := 0;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'AUTH_REQUIRED';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'PAYMENT_EDIT_MANAGER_REQUIRED';
  end if;
  if btrim(coalesce(p_edit_reason, '')) = '' then
    raise exception 'PAYMENT_EDIT_REASON_REQUIRED';
  end if;
  if v_amount <= 0 then
    raise exception 'PAYMENT_AMOUNT_INVALID';
  end if;
  if v_discount < 0 then
    raise exception 'SETTLEMENT_DISCOUNT_INVALID';
  end if;

  select * into v_payment
  from public.claim_payments
  where tenant_id = v_tenant and id = p_payment_id
  for update;
  if not found then
    raise exception 'INSURANCE_PAYMENT_NOT_FOUND';
  end if;

  if p_expected_updated_at is null
     or p_expected_edit_version is null
     or v_payment.edit_version <> p_expected_edit_version
     or v_payment.updated_at is distinct from p_expected_updated_at then
    raise exception 'PAYMENT_CHANGED_BY_ANOTHER_USER';
  end if;

  select * into v_invoice
  from public.insurance_invoices i
  where i.tenant_id = v_tenant
    and i.claim_id = v_payment.claim_id
    and (v_payment.offset_against_invoice_id is null or i.id = v_payment.offset_against_invoice_id)
    and lower(coalesce(i.status, 'issued')) not in ('cancelled', 'canceled', 'void', 'deleted')
  order by (i.id = v_payment.offset_against_invoice_id) desc nulls last,
           i.issued_at desc nulls last,
           i.created_at desc
  limit 1
  for update;
  if not found then
    raise exception 'INSURANCE_INVOICE_NOT_FOUND';
  end if;

  if v_discount > 0 then
    if p_payment_method = 'cheque' or p_status <> 'cleared' then
      raise exception 'SETTLEMENT_DISCOUNT_REQUIRES_CLEARED_NON_CHEQUE';
    end if;
    if btrim(coalesce(p_settlement_discount_reason, '')) = '' then
      raise exception 'SETTLEMENT_DISCOUNT_REASON_REQUIRED';
    end if;
  end if;

  select coalesce(sum(amount), 0), coalesce(sum(settlement_discount_amount), 0)
    into v_other_paid, v_other_discount
  from public.claim_payments
  where tenant_id = v_tenant
    and claim_id = v_payment.claim_id
    and id <> v_payment.id
    and status = 'cleared';

  if p_status = 'cleared' then
    v_effective_paid := v_amount;
    v_effective_discount := v_discount;
  end if;

  if v_other_paid + v_other_discount + v_effective_paid + v_effective_discount
       > v_invoice.total + 0.001 then
    raise exception 'PAYMENT_EXCEEDS_INVOICE_TOTAL';
  end if;
  if v_discount > 0
     and abs((v_other_paid + v_other_discount + v_effective_paid + v_effective_discount) - v_invoice.total) > 0.001 then
    raise exception 'SETTLEMENT_DISCOUNT_MUST_CLOSE_INVOICE';
  end if;

  update public.claim_payments
  set amount = v_amount,
      payment_method = p_payment_method,
      payment_date = p_payment_date,
      reference_number = nullif(btrim(p_reference_number), ''),
      bank_name = nullif(btrim(p_bank_name), ''),
      cheque_due_date = case when p_payment_method = 'cheque' then p_cheque_due_date else null end,
      status = p_status,
      notes = nullif(btrim(p_notes), ''),
      settlement_discount_amount = v_discount,
      settlement_discount_reason = case when v_discount > 0 then nullif(btrim(p_settlement_discount_reason), '') else null end,
      settlement_approved_by = case when v_discount > 0 then auth.uid() else null end,
      edit_version = v_payment.edit_version + 1,
      updated_at = clock_timestamp()
  where tenant_id = v_tenant and id = v_payment.id
  returning * into v_updated;

  insert into public.claim_audit_logs(tenant_id, claim_id, action, details, user_id)
  values (
    v_tenant,
    v_payment.claim_id,
    'insurance_payment_corrected',
    jsonb_build_object(
      'payment_id', v_payment.id,
      'payment_number', v_payment.payment_number,
      'invoice_id', v_invoice.id,
      'reason', btrim(p_edit_reason),
      'before', jsonb_build_object(
        'amount', v_payment.amount,
        'payment_method', v_payment.payment_method,
        'payment_date', v_payment.payment_date,
        'reference_number', v_payment.reference_number,
        'bank_name', v_payment.bank_name,
        'cheque_due_date', v_payment.cheque_due_date,
        'status', v_payment.status,
        'notes', v_payment.notes,
        'settlement_discount_amount', v_payment.settlement_discount_amount,
        'settlement_discount_reason', v_payment.settlement_discount_reason,
        'edit_version', v_payment.edit_version
      ),
      'after', jsonb_build_object(
        'amount', v_updated.amount,
        'payment_method', v_updated.payment_method,
        'payment_date', v_updated.payment_date,
        'reference_number', v_updated.reference_number,
        'bank_name', v_updated.bank_name,
        'cheque_due_date', v_updated.cheque_due_date,
        'status', v_updated.status,
        'notes', v_updated.notes,
        'settlement_discount_amount', v_updated.settlement_discount_amount,
        'settlement_discount_reason', v_updated.settlement_discount_reason,
        'edit_version', v_updated.edit_version
      )
    ),
    auth.uid()
  );

  return v_updated;
end;
$$;

revoke all on function public.update_insurance_payment_by_manager(
  uuid,timestamptz,bigint,numeric,public.claim_payment_method,date,text,text,date,
  public.claim_payment_status,text,numeric,text,text
) from public, anon;

grant execute on function public.update_insurance_payment_by_manager(
  uuid,timestamptz,bigint,numeric,public.claim_payment_method,date,text,text,date,
  public.claim_payment_status,text,numeric,text,text
) to authenticated, service_role;

comment on function public.update_insurance_payment_by_manager(
  uuid,timestamptz,bigint,numeric,public.claim_payment_method,date,text,text,date,
  public.claim_payment_status,text,numeric,text,text
) is 'Manager-only atomic insurance payment correction with optimistic concurrency and audit history.';
