-- Complete Phase 2 source coverage for supplier invoices and actual supplier payments.
-- No rules are activated and no historical source is posted by this migration.

do $$
begin
  if to_regprocedure('public.accounting_get_source_posting_snapshot_phase2_core(uuid,text,uuid)') is null
     and to_regprocedure('public.accounting_get_source_posting_snapshot(uuid,text,uuid)') is not null then
    alter function public.accounting_get_source_posting_snapshot(uuid,text,uuid)
      rename to accounting_get_source_posting_snapshot_phase2_core;
  end if;
end;
$$;

create or replace function public.accounting_get_source_posting_snapshot(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_result jsonb;
begin
  if p_tenant_id is null or p_source_id is null
     or p_tenant_id <> public.get_user_tenant_id() then
    raise exception 'ACCOUNTING_SOURCE_ACCESS_DENIED';
  end if;

  if lower(btrim(p_source_type)) = 'supplier_invoice' then
    if not public.is_accounting_source_eligible(p_tenant_id, 'supplier_invoice', p_source_id) then
      raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
    end if;

    select jsonb_build_object(
      'source_type', 'supplier_invoice',
      'source_id', i.id,
      'source_number', coalesce(nullif(i.supplier_invoice_number, ''), i.invoice_number),
      'source_status', i.status,
      'document_date', i.date,
      'net_amount', round(greatest(i.total - i.vat, 0), 3),
      'vat_amount', round(greatest(i.vat, 0), 3),
      'total_amount', round(i.total, 3),
      'amount', round(i.total, 3),
      'party_type', 'supplier',
      'party_id', i.supplier_id,
      'supplier_id', i.supplier_id,
      'purchase_invoice_id', i.id,
      'invoice_id', null,
      'business_type', 'purchase',
      'payment_mapping_key', null
    ) into v_result
    from public.purchase_invoices i
    where i.id = p_source_id
      and i.tenant_id = p_tenant_id
      and lower(coalesce(i.status, 'draft')) in ('received','approved','issued','partial','paid','overdue')
      and i.total > 0;

  elsif lower(btrim(p_source_type)) = 'supplier_payment' then
    if not public.is_accounting_source_eligible(p_tenant_id, 'supplier_payment', p_source_id) then
      raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
    end if;

    select jsonb_build_object(
      'source_type', 'supplier_payment',
      'source_id', p.id,
      'source_number', p.payment_number,
      'source_status', 'paid',
      'document_date', p.payment_date,
      'net_amount', round(p.amount, 3),
      'vat_amount', 0,
      'total_amount', round(p.amount, 3),
      'amount', round(p.amount, 3),
      'party_type', 'supplier',
      'party_id', coalesce(p.supplier_id, i.supplier_id),
      'supplier_id', coalesce(p.supplier_id, i.supplier_id),
      'purchase_invoice_id', p.purchase_invoice_id,
      'payment_id', p.id,
      'business_type', 'purchase',
      'payment_mapping_key', case lower(coalesce(p.payment_method, 'cash'))
        when 'cash' then 'cash_on_hand'
        when 'cash_payment' then 'cash_on_hand'
        when 'bank' then 'bank_account'
        when 'bank_transfer' then 'bank_account'
        when 'transfer' then 'bank_account'
        when 'cheque' then 'bank_account'
        when 'check' then 'bank_account'
        when 'card' then 'bank_account'
        else 'payment_clearing'
      end
    ) into v_result
    from public.supplier_payments p
    join public.purchase_invoices i
      on i.id = p.purchase_invoice_id and i.tenant_id = p.tenant_id
    where p.id = p_source_id
      and p.tenant_id = p_tenant_id
      and p.amount > 0;

  else
    v_result := public.accounting_get_source_posting_snapshot_phase2_core(
      p_tenant_id, lower(btrim(p_source_type)), p_source_id
    );
  end if;

  if v_result is null then
    raise exception 'ACCOUNTING_SOURCE_NOT_POSTABLE';
  end if;
  if coalesce((v_result->>'total_amount')::numeric, 0) <= 0 then
    raise exception 'ACCOUNTING_SOURCE_AMOUNT_INVALID';
  end if;
  return v_result;
end;
$$;

comment on function public.accounting_get_source_posting_snapshot(uuid,text,uuid) is
  'Normalized Phase 2 posting snapshot for sales, insurance, expenses, receipts, supplier invoices, and supplier payments.';

revoke all on function public.accounting_get_source_posting_snapshot_phase2_core(uuid,text,uuid) from public, anon;
revoke all on function public.accounting_get_source_posting_snapshot(uuid,text,uuid) from public, anon;
grant execute on function public.accounting_get_source_posting_snapshot_phase2_core(uuid,text,uuid) to authenticated;
grant execute on function public.accounting_get_source_posting_snapshot(uuid,text,uuid) to authenticated;
