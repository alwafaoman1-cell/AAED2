-- Authorization guards only. No operational row/number/posting changes.
-- Version aligned to the confirmed Development migration ledger.
-- Reviewed against Development and matching Production source fingerprints.
-- Existing signatures, grants, search paths and business bodies are preserved.
set local lock_timeout = '2s';
do $preflight$
begin
  if md5(replace(pg_get_functiondef('public.accounting_get_source_posting_snapshot_base(uuid,text,uuid)'::regprocedure), chr(13), '')) is distinct from '6c92d377cc5ac9d67024af4182c70f48' then
    raise exception 'ACCOUNTING_GUARD_DEFINITION_DRIFT: accounting_get_source_posting_snapshot_base(uuid,text,uuid)';
  end if;
  if md5(replace(pg_get_functiondef('public.is_accounting_source_eligible(uuid,text,uuid)'::regprocedure), chr(13), '')) is distinct from 'e50565db3180cdd916c464a3f36995ac' then
    raise exception 'ACCOUNTING_GUARD_DEFINITION_DRIFT: is_accounting_source_eligible(uuid,text,uuid)';
  end if;
  if md5(replace(pg_get_functiondef('public.reserve_receipt_number_rpc(uuid)'::regprocedure), chr(13), '')) is distinct from 'c9979504fb5a9df39ca539cfd84590e0' then
    raise exception 'ACCOUNTING_GUARD_DEFINITION_DRIFT: reserve_receipt_number_rpc(uuid)';
  end if;
end;
$preflight$;

CREATE OR REPLACE FUNCTION public.accounting_get_source_posting_snapshot_base(p_tenant_id uuid, p_source_type text, p_source_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_result jsonb;
begin
  if auth.uid() is null or p_tenant_id is null or p_source_id is null
     or p_tenant_id is distinct from public.get_user_tenant_id() then
    raise exception 'ACCOUNTING_SOURCE_ACCESS_DENIED';
  end if;
  if public.accounting_has_permission('accounting.view_journal') is distinct from true then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
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
$function$;

CREATE OR REPLACE FUNCTION public.is_accounting_source_eligible(p_tenant_id uuid, p_source_type text, p_source_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_source jsonb;
  v_parent jsonb;
  v_parent_id text;
begin
  if p_tenant_id is null or p_source_id is null then
    return false;
  end if;
  if auth.uid() is not null and p_tenant_id is distinct from public.get_user_tenant_id() then
    return false;
  end if;

  case lower(p_source_type)
    when 'sales_invoice' then
      select to_jsonb(d) into v_source from public.sales_documents d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'cash_invoice' then
      select to_jsonb(d) into v_source from public.invoices d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'insurance_invoice' then
      select to_jsonb(d) into v_source from public.insurance_invoices d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'expense' then
      select to_jsonb(d) into v_source from public.expenses d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'supplier_invoice' then
      select to_jsonb(d) into v_source from public.purchase_invoices d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'sales_payment' then
      select to_jsonb(d) into v_source from public.sales_payments d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'claim_payment' then
      select to_jsonb(d) into v_source from public.claim_payments d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'supplier_payment' then
      select to_jsonb(d) into v_source from public.supplier_payments d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'work_order' then
      select to_jsonb(d) into v_source from public.job_orders d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'claim' then
      select to_jsonb(d) into v_source from public.insurance_claims d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'vehicle' then
      select to_jsonb(d) into v_source from public.vehicles d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'customer' then
      select to_jsonb(d) into v_source from public.customers d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'supplier' then
      select to_jsonb(d) into v_source from public.suppliers d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'manual_journal' then
      return true;
    when 'opening_balance' then
      select to_jsonb(d) into v_source from public.accounting_opening_balances d
      where d.id = p_source_id and d.tenant_id = p_tenant_id;
    when 'reversal' then
      select to_jsonb(d) into v_source from public.accounting_journal_entries d
      where d.id = p_source_id and d.tenant_id = p_tenant_id and d.status = 'posted';
    else
      return false;
  end case;

  if not public.accounting_json_record_is_active(v_source) then
    return false;
  end if;

  -- Resolve invoice/expense parent work order when present.
  v_parent_id := coalesce(v_source->>'work_order_id', v_source->>'linked_work_order_id');
  if nullif(v_parent_id, '') is not null then
    if v_parent_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select to_jsonb(w) into v_parent from public.job_orders w
      where w.id = v_parent_id::uuid and w.tenant_id = p_tenant_id;
    else
      select to_jsonb(w) into v_parent from public.job_orders w
      where w.order_number = v_parent_id and w.tenant_id = p_tenant_id
      order by w.created_at desc limit 1;
    end if;
    if not public.accounting_json_record_is_active(v_parent) then return false; end if;
  end if;

  -- Resolve claim parent when present.
  v_parent_id := v_source->>'claim_id';
  if nullif(v_parent_id, '') is not null then
    select to_jsonb(c) into v_parent from public.insurance_claims c
    where c.id = v_parent_id::uuid and c.tenant_id = p_tenant_id;
    if not public.accounting_json_record_is_active(v_parent) then return false; end if;
  end if;

  -- A payment is eligible only when its financial parent is eligible.
  if lower(p_source_type) = 'sales_payment' then
    v_parent_id := v_source->>'sales_document_id';
    return v_parent_id is not null
      and public.is_accounting_source_eligible(p_tenant_id, 'sales_invoice', v_parent_id::uuid);
  elsif lower(p_source_type) = 'supplier_payment' then
    v_parent_id := v_source->>'purchase_invoice_id';
    return v_parent_id is not null
      and public.is_accounting_source_eligible(p_tenant_id, 'supplier_invoice', v_parent_id::uuid);
  elsif lower(p_source_type) = 'claim_payment' then
    v_parent_id := coalesce(v_source->>'offset_against_invoice_id', v_source->>'invoice_id');
    if nullif(v_parent_id, '') is not null then
      return public.is_accounting_source_eligible(p_tenant_id, 'insurance_invoice', v_parent_id::uuid);
    end if;
    v_parent_id := v_source->>'claim_id';
    return v_parent_id is not null
      and public.is_accounting_source_eligible(p_tenant_id, 'claim', v_parent_id::uuid);
  end if;

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.reserve_receipt_number_rpc(p_tenant_id uuid)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$ declare v_user_id uuid := auth.uid(); v_year integer := extract(year from current_timestamp at time zone 'Asia/Muscat')::integer; v_prefix text; v_padding integer; v_settings jsonb; v_next_from_settings bigint; v_highest_receipt bigint; v_highest_deposit bigint; v_floor bigint; v_allocated bigint; begin if v_user_id is null or p_tenant_id is null or p_tenant_id is distinct from public.get_user_tenant_id() then raise exception 'RECEIPT_TENANT_DENIED' using errcode = '42501'; end if; select value into v_settings from public.tenant_settings where tenant_id = p_tenant_id and key = 'alwafa_voucher_settings_v1'; v_prefix := upper(coalesce(nullif(trim(v_settings->>'receiptPrefix'), ''), 'RCV')); if v_prefix !~ '^[A-Z0-9]{1,10}$' then raise exception 'INVALID_RECEIPT_PREFIX' using errcode = '22023'; end if; v_padding := greatest(3, least(10, coalesce((v_settings->>'numberPadding')::integer, 4))); v_next_from_settings := greatest(1, coalesce((v_settings->>'receiptNextNumber')::bigint, 1)); select coalesce(max(split_part(receipt_number, '-', 3)::bigint), 0) into v_highest_receipt from public.accounting_receipts where tenant_id = p_tenant_id and receipt_number ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$'); select coalesce(max(split_part(entry->>'receiptNumber', '-', 3)::bigint), 0) into v_highest_deposit from public.tenant_settings settings, jsonb_array_elements(case when jsonb_typeof(settings.value) = 'array' then settings.value else '[]'::jsonb end) entry where settings.tenant_id = p_tenant_id and settings.key = 'alwafa_deposits_v1' and entry->>'receiptNumber' ~ ('^' || v_prefix || '-' || v_year::text || '-[0-9]+$'); v_floor := greatest(v_next_from_settings, v_highest_receipt + 1, v_highest_deposit + 1); insert into public.receipt_number_sequences (tenant_id, receipt_year, prefix, next_number) values (p_tenant_id, v_year, v_prefix, v_floor + 1) on conflict (tenant_id, receipt_year, prefix) do update set next_number = greatest(public.receipt_number_sequences.next_number, v_floor) + 1, updated_at = now() returning next_number - 1 into v_allocated; return v_prefix || '-' || v_year::text || '-' || lpad(v_allocated::text, v_padding, '0'); end; $function$;

