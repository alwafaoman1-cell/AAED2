-- Align the accounting posting snapshot with legacy operational rows.
-- This migration does not update operational records and does not infer VAT.

create or replace function public.accounting_get_source_posting_snapshot_phase2_core(
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
  v_source_type text := lower(btrim(coalesce(p_source_type, '')));
  v_result jsonb;
begin
  if p_tenant_id is null or p_source_id is null then
    raise exception 'ACCOUNTING_SOURCE_REQUIRED';
  end if;
  if p_tenant_id <> public.get_user_tenant_id()
     or not public.accounting_has_permission('accounting.view_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;
  if not public.is_accounting_source_eligible(p_tenant_id, v_source_type, p_source_id) then
    raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
  end if;

  case v_source_type
    when 'sales_invoice' then
      select jsonb_build_object(
        'source_number', d.doc_number,
        'source_status', coalesce(nullif(d.invoice_status, ''), d.status),
        'document_date', d.date,
        'net_amount', round((d.total - d.tax_total)::numeric, 3),
        'vat_amount', round(d.tax_total::numeric, 3),
        'total_amount', round(d.total::numeric, 3),
        'amount', round(d.total::numeric, 3),
        'business_type', 'cash',
        'receivable_mapping_key', 'cash_customer_receivable',
        'revenue_mapping_key', 'cash_revenue',
        'work_order_id', d.work_order_id,
        'invoice_id', d.id,
        'party_type', 'customer',
        'party_id', d.customer_id
      ) into v_result
      from public.sales_documents d
      where d.tenant_id = p_tenant_id
        and d.id = p_source_id
        and lower(coalesce(d.doc_type, '')) = 'invoice'
        and (
          lower(coalesce(d.invoice_status, '')) = 'issued'
          or d.issued_at is not null
          or lower(coalesce(d.status, '')) in
             ('unpaid','partial','partially_paid','paid','overdue','sent','issued')
        )
        and d.total > 0;

    when 'cash_invoice' then
      select jsonb_build_object(
        'source_number', d.invoice_number,
        'source_status', d.status::text,
        'document_date', d.created_at::date,
        'net_amount', round((d.total - d.vat)::numeric, 3),
        'vat_amount', round(d.vat::numeric, 3),
        'total_amount', round(d.total::numeric, 3),
        'amount', round(d.total::numeric, 3),
        'business_type', 'cash',
        'receivable_mapping_key', 'cash_customer_receivable',
        'revenue_mapping_key', 'cash_revenue',
        'work_order_id', d.job_order_id,
        'invoice_id', d.id,
        'party_type', 'customer',
        'party_id', w.customer_id,
        'vehicle_id', w.vehicle_id
      ) into v_result
      from public.invoices d
      join public.job_orders w
        on w.id = d.job_order_id and w.tenant_id = d.tenant_id
      where d.tenant_id = p_tenant_id
        and d.id = p_source_id
        and d.status::text in ('sent','paid','overdue')
        and d.total > 0;

    when 'insurance_invoice' then
      select jsonb_build_object(
        'source_number', d.invoice_number,
        'source_status', d.status,
        'document_date', coalesce(d.invoice_date, d.issued_at::date),
        'net_amount', round((d.total - d.vat)::numeric, 3),
        'vat_amount', round(d.vat::numeric, 3),
        'total_amount', round(d.total::numeric, 3),
        'amount', round(d.total::numeric, 3),
        'business_type', 'insurance',
        'receivable_mapping_key', 'insurance_receivable',
        'revenue_mapping_key', 'insurance_revenue',
        'claim_id', d.claim_id,
        'work_order_id', coalesce(c.job_order_id, c.auto_job_order_id),
        'vehicle_id', c.vehicle_id,
        'invoice_id', d.id,
        'party_type', 'insurance_company',
        'party_id', d.insurance_company_id
      ) into v_result
      from public.insurance_invoices d
      join public.insurance_claims c
        on c.id = d.claim_id and c.tenant_id = d.tenant_id
      where d.tenant_id = p_tenant_id
        and d.id = p_source_id
        and lower(coalesce(d.status, '')) in ('issued','partial','paid','overdue')
        and d.total > 0;

    when 'sales_payment' then
      select jsonb_build_object(
        'source_number', p.payment_number,
        'source_status', 'cleared',
        'document_date', p.date,
        'net_amount', round(p.amount::numeric, 3),
        'vat_amount', 0::numeric,
        'total_amount', round(p.amount::numeric, 3),
        'amount', round(p.amount::numeric, 3),
        'business_type', 'cash',
        'receivable_mapping_key', 'cash_customer_receivable',
        'payment_mapping_key', case
          when lower(coalesce(p.method, '')) in ('bank','bank_transfer','cheque','check','card') then 'bank'
          when lower(coalesce(p.method, '')) = 'cash' then 'cash'
          else 'payment_clearing'
        end,
        'payment_method', p.method,
        'work_order_id', d.work_order_id,
        'invoice_id', d.id,
        'payment_id', p.id,
        'party_type', 'customer',
        'party_id', d.customer_id
      ) into v_result
      from public.sales_payments p
      join public.sales_documents d
        on d.id = p.sales_document_id and d.tenant_id = p.tenant_id
      where p.tenant_id = p_tenant_id
        and p.id = p_source_id
        and p.amount > 0
        and lower(coalesce(d.doc_type, '')) = 'invoice'
        and (
          lower(coalesce(d.invoice_status, '')) = 'issued'
          or d.issued_at is not null
          or lower(coalesce(d.status, '')) in
             ('unpaid','partial','partially_paid','paid','overdue','sent','issued')
        );

    when 'claim_payment' then
      select jsonb_build_object(
        'source_number', p.payment_number,
        'source_status', p.status::text,
        'document_date', p.payment_date,
        'net_amount', round(p.amount::numeric, 3),
        'vat_amount', 0::numeric,
        'total_amount', round(p.amount::numeric, 3),
        'amount', round(p.amount::numeric, 3),
        'business_type', 'insurance',
        'receivable_mapping_key', 'insurance_receivable',
        'payment_mapping_key', case
          when p.payment_method::text in ('bank_transfer','cheque') then 'bank'
          when p.payment_method::text = 'cash' then 'cash'
          else 'payment_clearing'
        end,
        'payment_method', p.payment_method::text,
        'claim_id', p.claim_id,
        'work_order_id', coalesce(c.job_order_id, c.auto_job_order_id),
        'vehicle_id', c.vehicle_id,
        'invoice_id', i.id,
        'payment_id', p.id,
        'party_type', 'insurance_company',
        'party_id', coalesce(p.insurance_company_id, i.insurance_company_id)
      ) into v_result
      from public.claim_payments p
      join public.insurance_claims c
        on c.id = p.claim_id and c.tenant_id = p.tenant_id
      left join lateral (
        select ii.id, ii.insurance_company_id
        from public.insurance_invoices ii
        where ii.tenant_id = p.tenant_id
          and ii.claim_id = p.claim_id
          and (p.offset_against_invoice_id is null or ii.id = p.offset_against_invoice_id)
          and lower(coalesce(ii.status, '')) in ('issued','partial','paid','overdue')
        order by
          (ii.id = p.offset_against_invoice_id) desc nulls last,
          coalesce(ii.invoice_date, ii.issued_at::date) desc,
          ii.created_at desc
        limit 1
      ) i on true
      where p.tenant_id = p_tenant_id
        and p.id = p_source_id
        and p.status::text = 'cleared'
        and p.amount > 0
        and i.id is not null;

    when 'expense' then
      select jsonb_build_object(
        'source_number', e.voucher_number,
        'source_status', 'recognized',
        'document_date', e.date,
        'net_amount', round(
          case when coalesce(e.total, 0) > 0 then e.subtotal else e.amount end::numeric,
          3
        ),
        'vat_amount', round(
          case when coalesce(e.total, 0) > 0 then e.vat_amount else 0 end::numeric,
          3
        ),
        'total_amount', round(
          case when coalesce(e.total, 0) > 0 then e.total else e.amount end::numeric,
          3
        ),
        'amount', round(
          case when coalesce(e.total, 0) > 0 then e.total else e.amount end::numeric,
          3
        ),
        'business_type', coalesce(nullif(e.expense_type, ''), 'general'),
        'expense_mapping_key', case
          when lower(coalesce(e.expense_type, '')) like '%part%' then 'parts_cost'
          when lower(coalesce(e.expense_type, '')) like '%labor%' then 'labor_cost'
          when lower(coalesce(e.expense_type, '')) like '%transport%' then 'transport_cost'
          else 'operating_expense'
        end,
        'payment_mapping_key', case
          when lower(coalesce(e.payment_method, '')) in ('bank','bank_transfer','cheque','check','card') then 'bank'
          when lower(coalesce(e.payment_method, '')) = 'cash' then 'cash'
          else 'payment_clearing'
        end,
        'payment_method', e.payment_method,
        'claim_id', e.claim_id,
        'work_order_id', e.linked_work_order_id,
        'vehicle_id', e.vehicle_id,
        'invoice_id', e.invoice_id,
        'expense_id', e.id,
        'party_type', case when e.supplier_id is null then null else 'supplier' end,
        'party_id', e.supplier_id
      ) into v_result
      from public.expenses e
      where e.tenant_id = p_tenant_id
        and e.id = p_source_id
        and coalesce(nullif(e.total, 0), e.amount, 0) > 0;

    else
      raise exception 'ACCOUNTING_SOURCE_TYPE_UNSUPPORTED';
  end case;

  if v_result is null then
    raise exception 'ACCOUNTING_SOURCE_NOT_POSTABLE';
  end if;
  if coalesce((v_result->>'total_amount')::numeric, 0) <= 0 then
    raise exception 'ACCOUNTING_SOURCE_AMOUNT_INVALID';
  end if;
  return v_result;
end;
$$;

comment on function public.accounting_get_source_posting_snapshot_phase2_core(uuid,text,uuid) is
  'Phase 2 operational posting snapshot with non-mutating legacy invoice and expense compatibility.';

revoke all on function public.accounting_get_source_posting_snapshot_phase2_core(uuid,text,uuid)
  from public, anon;
grant execute on function public.accounting_get_source_posting_snapshot_phase2_core(uuid,text,uuid)
  to authenticated;
