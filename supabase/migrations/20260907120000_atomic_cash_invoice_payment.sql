-- Atomically register cash-invoice payments using OMR precision.
-- Locking the invoice prevents concurrent requests from spending the same
-- remaining balance. The caller-supplied UUID makes a retried request safe.

create or replace function public.create_sales_payment_atomic(
  p_payment_id uuid,
  p_document_id uuid,
  p_amount numeric,
  p_date date,
  p_method text,
  p_reference text default null,
  p_notes text default null
) returns table (
  id uuid,
  date date,
  amount numeric,
  method text,
  reference text,
  notes text
)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_document public.sales_documents%rowtype;
  v_paid numeric(18,3);
  v_remaining numeric(18,3);
  v_amount numeric(18,3) := round(coalesce(p_amount, 0), 3);
  v_existing public.sales_payments%rowtype;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'PAYMENT_AUTH_REQUIRED';
  end if;

  if public.get_user_role()::text not in ('admin', 'manager', 'insurance') then
    raise exception 'PAYMENT_PERMISSION_DENIED';
  end if;

  select p.* into v_existing
    from public.sales_payments p
   where p.id = p_payment_id;
  if found then
    if v_existing.tenant_id <> v_tenant or v_existing.sales_document_id <> p_document_id then
      raise exception 'PAYMENT_IDEMPOTENCY_CONFLICT';
    end if;
    return query select v_existing.id, v_existing.date, round(v_existing.amount, 3),
      v_existing.method, v_existing.reference, v_existing.notes;
    return;
  end if;

  select d.* into v_document
    from public.sales_documents d
   where d.id = p_document_id
     and d.tenant_id = v_tenant
   for update;

  if not found then raise exception 'INVOICE_NOT_FOUND'; end if;
  if v_document.doc_type <> 'invoice' then raise exception 'PAYMENT_TARGET_NOT_INVOICE'; end if;
  if lower(coalesce(v_document.status, '')) in ('cancelled', 'canceled', 'void', 'deleted') then
    raise exception 'INVOICE_NOT_PAYABLE';
  end if;
  if v_amount <= 0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;

  select round(coalesce(sum(p.amount), 0), 3) into v_paid
    from public.sales_payments p
   where p.tenant_id = v_tenant
     and p.sales_document_id = p_document_id;
  v_remaining := greatest(round(coalesce(v_document.total, 0), 3) - v_paid, 0);

  if v_remaining <= 0 then raise exception 'INVOICE_ALREADY_FULLY_PAID'; end if;
  if v_amount > v_remaining then raise exception 'PAYMENT_EXCEEDS_REMAINING'; end if;

  return query
  insert into public.sales_payments (
    id, tenant_id, payment_number, sales_document_id, date, amount,
    method, reference, notes, created_by
  ) values (
    p_payment_id,
    v_tenant,
    'PAY-' || extract(year from coalesce(p_date, current_date))::integer::text || '-' || upper(substr(replace(p_payment_id::text, '-', ''), 1, 8)),
    p_document_id,
    coalesce(p_date, current_date),
    v_amount,
    coalesce(nullif(trim(p_method), ''), 'cash'),
    nullif(trim(p_reference), ''),
    nullif(trim(p_notes), ''),
    auth.uid()
  )
  returning sales_payments.id, sales_payments.date, round(sales_payments.amount, 3),
    sales_payments.method, sales_payments.reference, sales_payments.notes;
end;
$$;

revoke all on function public.create_sales_payment_atomic(uuid, uuid, numeric, date, text, text, text)
  from public, anon;
grant execute on function public.create_sales_payment_atomic(uuid, uuid, numeric, date, text, text, text)
  to authenticated, service_role;

comment on function public.create_sales_payment_atomic(uuid, uuid, numeric, date, text, text, text) is
  'Idempotently inserts one OMR-rounded cash invoice payment under an invoice row lock and rejects overpayment.';
