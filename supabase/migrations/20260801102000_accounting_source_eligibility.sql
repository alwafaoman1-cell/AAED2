-- Central accounting source eligibility. Future reports and posting RPCs must use this rule.

create or replace function public.accounting_json_record_is_active(p_record jsonb)
returns boolean
language sql
immutable
set search_path = pg_catalog
as $$
  select p_record is not null
    and nullif(p_record->>'deleted_at','') is null
    and nullif(p_record->>'deleted_by','') is null
    and nullif(p_record->>'archived_at','') is null
    and lower(coalesce(p_record->>'archived','false')) not in ('true','1','yes')
    and lower(coalesce(p_record->>'is_deleted','false')) not in ('true','1','yes')
    and lower(coalesce(p_record->>'status','')) not in (
      'cancelled','canceled','void','deleted','failed','bounced','reversed','archived'
    );
$$;

create or replace function public.is_accounting_source_eligible(
  p_tenant_id uuid,
  p_source_type text,
  p_source_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_source jsonb;
  v_parent jsonb;
  v_parent_id text;
begin
  if p_tenant_id is null or p_source_id is null then
    return false;
  end if;
  if auth.uid() is not null and p_tenant_id <> public.get_user_tenant_id() then
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
$$;

comment on function public.is_accounting_source_eligible(uuid,text,uuid) is
  'Authoritative source eligibility. Excludes deleted/cancelled/void records and records whose work-order, claim, or invoice parent is ineligible.';

revoke all on function public.accounting_json_record_is_active(jsonb) from public, anon;
revoke all on function public.is_accounting_source_eligible(uuid,text,uuid) from public, anon;
grant execute on function public.accounting_json_record_is_active(jsonb) to authenticated;
grant execute on function public.is_accounting_source_eligible(uuid,text,uuid) to authenticated;

create or replace function public.accounting_validate_source_link()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if not public.is_accounting_source_eligible(new.tenant_id, new.source_type, new.source_id) then
    raise exception 'ACCOUNTING_SOURCE_INELIGIBLE';
  end if;
  return new;
end;
$$;

drop trigger if exists accounting_source_links_validate on public.accounting_source_links;
create trigger accounting_source_links_validate
before insert or update on public.accounting_source_links
for each row execute function public.accounting_validate_source_link();
