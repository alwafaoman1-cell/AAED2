-- Phase 2: manual posting preview and source posting engine.
-- No source-table triggers, no backfill, and no posting rules are activated here.

alter table public.accounting_posting_rules
  add column if not exists description_ar text,
  add column if not exists description_en text,
  add column if not exists effective_from date,
  add column if not exists effective_to date;

alter table public.accounting_posting_rules
  drop constraint if exists accounting_posting_rules_dates_check;
alter table public.accounting_posting_rules
  add constraint accounting_posting_rules_dates_check
  check (effective_to is null or effective_from is null or effective_from <= effective_to);

create index if not exists accounting_posting_rules_runtime_lookup_idx
  on public.accounting_posting_rules
  (tenant_id, source_type, event_type, is_active, priority)
  where is_active;

create table if not exists public.accounting_posting_requests (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  idempotency_key text not null,
  source_type text not null,
  source_id uuid not null,
  event_type text not null,
  accounting_date date not null,
  status text not null default 'processing'
    check (status in ('processing','completed','failed')),
  journal_entry_id uuid,
  preview_hash text,
  error_code text,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  constraint accounting_posting_requests_key_not_blank
    check (btrim(idempotency_key) <> '' and length(idempotency_key) <= 200),
  constraint accounting_posting_requests_tenant_key
    unique (tenant_id, idempotency_key),
  constraint accounting_posting_requests_source_event_key
    unique (tenant_id, source_type, source_id, event_type),
  constraint accounting_posting_requests_journal_fk
    foreign key (tenant_id, journal_entry_id)
    references public.accounting_journal_entries(tenant_id, id) on delete restrict
);

create index if not exists accounting_posting_requests_source_idx
  on public.accounting_posting_requests (tenant_id, source_type, source_id, event_type);

alter table public.accounting_posting_requests enable row level security;
revoke all on table public.accounting_posting_requests from public, anon, authenticated;
grant select on table public.accounting_posting_requests to authenticated;
grant all on table public.accounting_posting_requests to service_role;

drop policy if exists accounting_posting_requests_read on public.accounting_posting_requests;
create policy accounting_posting_requests_read
  on public.accounting_posting_requests
  for select
  to authenticated
  using (
    tenant_id = public.get_user_tenant_id()
    and public.accounting_has_permission('accounting.view_journal')
  );

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
        and (lower(coalesce(d.invoice_status, '')) = 'issued' or d.issued_at is not null)
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
        and (lower(coalesce(d.invoice_status, '')) = 'issued' or d.issued_at is not null);

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
        'net_amount', round(e.subtotal::numeric, 3),
        'vat_amount', round(e.vat_amount::numeric, 3),
        'total_amount', round(e.total::numeric, 3),
        'amount', round(e.total::numeric, 3),
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
        and e.total > 0;

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

create or replace function public.preview_accounting_source_posting(
  p_source_type text,
  p_source_id uuid,
  p_event_type text,
  p_accounting_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_rule public.accounting_posting_rules%rowtype;
  v_source jsonb;
  v_templates jsonb;
  v_template jsonb;
  v_lines jsonb := '[]'::jsonb;
  v_side text;
  v_mapping_key text;
  v_amount_key text;
  v_amount numeric(18,3);
  v_account_id uuid;
  v_debit numeric(18,3) := 0;
  v_credit numeric(18,3) := 0;
  v_line_no integer := 0;
begin
  if v_tenant is null
     or not public.accounting_has_permission('accounting.view_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;
  if p_source_id is null or btrim(coalesce(p_event_type, '')) = '' then
    raise exception 'ACCOUNTING_POSTING_PREVIEW_INPUT_REQUIRED';
  end if;

  v_source := public.accounting_get_source_posting_snapshot(
    v_tenant, lower(btrim(p_source_type)), p_source_id
  );

  select * into v_rule
  from public.accounting_posting_rules r
  where r.tenant_id = v_tenant
    and r.source_type = lower(btrim(p_source_type))
    and r.event_type = lower(btrim(p_event_type))
    and r.is_active
    and (r.effective_from is null or r.effective_from <= p_accounting_date)
    and (r.effective_to is null or r.effective_to >= p_accounting_date)
  order by r.priority asc, r.created_at asc
  limit 1;

  if not found then
    raise exception 'ACCOUNTING_POSTING_RULE_NOT_FOUND';
  end if;

  v_templates := v_rule.configuration->'lines';
  if jsonb_typeof(v_templates) <> 'array' or jsonb_array_length(v_templates) = 0 then
    v_templates := jsonb_build_array(
      jsonb_build_object('side','debit','mapping_key',v_rule.debit_mapping_key,'amount','total_amount'),
      jsonb_build_object('side','credit','mapping_key',v_rule.credit_mapping_key,'amount','total_amount')
    );
  end if;
  if jsonb_array_length(v_templates) > 20 then
    raise exception 'ACCOUNTING_POSTING_RULE_TOO_MANY_LINES';
  end if;

  for v_template in select value from jsonb_array_elements(v_templates)
  loop
    v_side := lower(coalesce(v_template->>'side', ''));
    v_mapping_key := btrim(coalesce(v_template->>'mapping_key', ''));
    v_amount_key := btrim(coalesce(v_template->>'amount', ''));

    if v_side not in ('debit','credit') then
      raise exception 'ACCOUNTING_POSTING_RULE_SIDE_INVALID';
    end if;
    if v_mapping_key = '$receivable' then
      v_mapping_key := v_source->>'receivable_mapping_key';
    elsif v_mapping_key = '$revenue' then
      v_mapping_key := v_source->>'revenue_mapping_key';
    elsif v_mapping_key = '$payment_account' then
      v_mapping_key := v_source->>'payment_mapping_key';
    elsif v_mapping_key = '$expense_account' then
      v_mapping_key := v_source->>'expense_mapping_key';
    end if;
    if btrim(coalesce(v_mapping_key, '')) = '' then
      raise exception 'ACCOUNTING_POSTING_RULE_MAPPING_INVALID';
    end if;
    if v_amount_key not in ('net_amount','vat_amount','total_amount','amount') then
      raise exception 'ACCOUNTING_POSTING_RULE_AMOUNT_INVALID';
    end if;

    v_amount := round(coalesce((v_source->>v_amount_key)::numeric, 0), 3);
    if v_amount = 0 and coalesce((v_template->>'omit_if_zero')::boolean, true) then
      continue;
    end if;
    if v_amount <= 0 then
      raise exception 'ACCOUNTING_POSTING_LINE_AMOUNT_INVALID';
    end if;

    v_account_id := public.resolve_accounting_account_mapping(
      v_mapping_key,
      nullif(v_source->>'business_type', ''),
      null,
      null,
      p_accounting_date
    );
    v_line_no := v_line_no + 1;
    if v_side = 'debit' then
      v_debit := v_debit + v_amount;
    else
      v_credit := v_credit + v_amount;
    end if;

    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'line_number', v_line_no,
      'side', v_side,
      'mapping_key', v_mapping_key,
      'account_id', v_account_id,
      'description', coalesce(v_template->>'description', v_source->>'source_number'),
      'debit', case when v_side = 'debit' then v_amount else 0 end,
      'credit', case when v_side = 'credit' then v_amount else 0 end,
      'party_type', nullif(v_source->>'party_type', ''),
      'party_id', nullif(v_source->>'party_id', ''),
      'claim_id', nullif(v_source->>'claim_id', ''),
      'work_order_id', nullif(v_source->>'work_order_id', ''),
      'vehicle_id', nullif(v_source->>'vehicle_id', ''),
      'invoice_id', nullif(v_source->>'invoice_id', ''),
      'expense_id', nullif(v_source->>'expense_id', ''),
      'payment_id', nullif(v_source->>'payment_id', '')
    ));
  end loop;

  if v_line_no < 2 or v_debit = 0 or v_debit <> v_credit then
    raise exception 'ACCOUNTING_POSTING_PREVIEW_UNBALANCED';
  end if;

  return jsonb_build_object(
    'tenant_id', v_tenant,
    'source_type', lower(btrim(p_source_type)),
    'source_id', p_source_id,
    'event_type', lower(btrim(p_event_type)),
    'accounting_date', p_accounting_date,
    'rule_id', v_rule.id,
    'rule_key', v_rule.rule_key,
    'source', v_source,
    'lines', v_lines,
    'total_debit', v_debit,
    'total_credit', v_credit,
    'balanced', true,
    'write_performed', false
  );
end;
$$;

create or replace function public.post_accounting_source(
  p_source_type text,
  p_source_id uuid,
  p_event_type text,
  p_accounting_date date,
  p_idempotency_key text
)
returns public.accounting_journal_entries
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_request public.accounting_posting_requests%rowtype;
  v_existing public.accounting_journal_entries%rowtype;
  v_entry public.accounting_journal_entries%rowtype;
  v_preview jsonb;
  v_line jsonb;
  v_year_id uuid;
  v_period_id uuid;
  v_source jsonb;
begin
  if v_tenant is null
     or not public.accounting_has_permission('accounting.create_journal')
     or not public.accounting_has_permission('accounting.approve_journal')
     or not public.accounting_has_permission('accounting.post_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;
  if btrim(coalesce(p_idempotency_key, '')) = '' or length(p_idempotency_key) > 200 then
    raise exception 'ACCOUNTING_IDEMPOTENCY_KEY_REQUIRED';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':' || p_idempotency_key, 0));
  perform pg_advisory_xact_lock(hashtextextended(
    v_tenant::text || ':' || lower(btrim(p_source_type)) || ':' || p_source_id::text || ':' || lower(btrim(p_event_type)),
    0
  ));

  select * into v_request
  from public.accounting_posting_requests
  where tenant_id = v_tenant and idempotency_key = p_idempotency_key
  for update;

  if found then
    if v_request.source_type <> lower(btrim(p_source_type))
       or v_request.source_id <> p_source_id
       or v_request.event_type <> lower(btrim(p_event_type)) then
      raise exception 'ACCOUNTING_IDEMPOTENCY_KEY_CONFLICT';
    end if;
    if v_request.journal_entry_id is not null then
      select * into v_existing
      from public.accounting_journal_entries
      where tenant_id = v_tenant and id = v_request.journal_entry_id;
      if found then return v_existing; end if;
    end if;
  end if;

  select e.* into v_existing
  from public.accounting_source_links s
  join public.accounting_journal_entries e
    on e.tenant_id = s.tenant_id and e.id = s.journal_entry_id
  where s.tenant_id = v_tenant
    and s.source_type = lower(btrim(p_source_type))
    and s.source_id = p_source_id
    and s.is_primary
  order by s.linked_at asc
  limit 1
  for update of e;

  if found then
    insert into public.accounting_posting_requests(
      tenant_id,idempotency_key,source_type,source_id,event_type,accounting_date,
      status,journal_entry_id,completed_at,created_by
    ) values (
      v_tenant,p_idempotency_key,lower(btrim(p_source_type)),p_source_id,
      lower(btrim(p_event_type)),p_accounting_date,'completed',v_existing.id,now(),auth.uid()
    )
    on conflict do nothing;
    return v_existing;
  end if;

  insert into public.accounting_posting_requests(
    tenant_id,idempotency_key,source_type,source_id,event_type,accounting_date,status,created_by
  ) values (
    v_tenant,p_idempotency_key,lower(btrim(p_source_type)),p_source_id,
    lower(btrim(p_event_type)),p_accounting_date,'processing',auth.uid()
  )
  on conflict (tenant_id,idempotency_key) do nothing;

  v_preview := public.preview_accounting_source_posting(
    p_source_type,p_source_id,p_event_type,p_accounting_date
  );
  v_source := v_preview->'source';

  select y.id, p.id into v_year_id, v_period_id
  from public.accounting_fiscal_years y
  join public.accounting_periods p
    on p.tenant_id = y.tenant_id and p.fiscal_year_id = y.id
  where y.tenant_id = v_tenant
    and y.status = 'open'
    and p.status = 'open'
    and p_accounting_date between y.start_date and y.end_date
    and p_accounting_date between p.start_date and p.end_date
  order by p.sequence asc
  limit 1;
  if v_year_id is null or v_period_id is null then
    raise exception 'ACCOUNTING_DATE_OUTSIDE_OPEN_PERIOD';
  end if;

  v_entry := public.create_accounting_journal_entry(
    v_year_id,
    v_period_id,
    p_accounting_date,
    nullif(v_source->>'document_date', '')::date,
    'automatic',
    'ترحيل ' || coalesce(v_source->>'source_number', p_source_id::text),
    'Posting ' || coalesce(v_source->>'source_number', p_source_id::text),
    v_source->>'source_number',
    lower(btrim(p_source_type)),
    p_source_id::text
  );

  for v_line in select value from jsonb_array_elements(v_preview->'lines')
  loop
    insert into public.accounting_journal_lines(
      tenant_id,journal_entry_id,account_id,line_number,description,debit,credit,
      party_type,party_id,claim_id,work_order_id,vehicle_id,invoice_id,expense_id,
      payment_id,reconciliation_reference,created_by
    ) values (
      v_tenant,v_entry.id,(v_line->>'account_id')::uuid,(v_line->>'line_number')::integer,
      v_line->>'description',(v_line->>'debit')::numeric,(v_line->>'credit')::numeric,
      nullif(v_line->>'party_type',''),nullif(v_line->>'party_id','')::uuid,
      nullif(v_line->>'claim_id','')::uuid,nullif(v_line->>'work_order_id','')::uuid,
      nullif(v_line->>'vehicle_id','')::uuid,nullif(v_line->>'invoice_id','')::uuid,
      nullif(v_line->>'expense_id','')::uuid,nullif(v_line->>'payment_id','')::uuid,
      v_source->>'source_number',auth.uid()
    );
  end loop;

  insert into public.accounting_source_links(
    tenant_id,journal_entry_id,source_type,source_id,source_number_snapshot,
    source_status_snapshot,linked_by,is_primary
  ) values (
    v_tenant,v_entry.id,lower(btrim(p_source_type)),p_source_id,
    v_source->>'source_number',v_source->>'source_status',auth.uid(),true
  );

  v_entry := public.approve_accounting_journal_entry(v_entry.id);
  v_entry := public.post_accounting_journal_entry(v_entry.id);

  update public.accounting_posting_requests
  set status='completed', journal_entry_id=v_entry.id,
      preview_hash=md5(v_preview::text), completed_at=now(), error_code=null
  where tenant_id=v_tenant and idempotency_key=p_idempotency_key;

  insert into public.accounting_audit_logs(
    tenant_id,user_id,action,entity_type,entity_id,after_snapshot,request_context
  ) values (
    v_tenant,auth.uid(),'source.post','accounting_source',p_source_id,
    jsonb_build_object('journal_entry_id',v_entry.id,'source_type',lower(btrim(p_source_type))),
    jsonb_build_object('event_type',lower(btrim(p_event_type)),'idempotency_key',p_idempotency_key)
  );

  return v_entry;
end;
$$;

create or replace function public.reverse_accounting_source_posting(
  p_source_type text,
  p_source_id uuid,
  p_reversal_date date,
  p_reason text
)
returns public.accounting_journal_entries
language plpgsql
volatile
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_entry_id uuid;
  v_reversal public.accounting_journal_entries%rowtype;
begin
  if v_tenant is null
     or not public.accounting_has_permission('accounting.reverse_journal') then
    raise exception 'ACCOUNTING_PERMISSION_DENIED';
  end if;

  select e.id into v_entry_id
  from public.accounting_source_links s
  join public.accounting_journal_entries e
    on e.tenant_id=s.tenant_id and e.id=s.journal_entry_id
  where s.tenant_id=v_tenant
    and s.source_type=lower(btrim(p_source_type))
    and s.source_id=p_source_id
    and s.is_primary
    and e.status='posted'
  order by s.linked_at asc
  limit 1;
  if v_entry_id is null then
    raise exception 'ACCOUNTING_SOURCE_POSTING_NOT_FOUND';
  end if;

  v_reversal := public.reverse_accounting_journal_entry(v_entry_id,p_reversal_date,p_reason);
  insert into public.accounting_audit_logs(
    tenant_id,user_id,action,entity_type,entity_id,after_snapshot,reason
  ) values (
    v_tenant,auth.uid(),'source.reverse','accounting_source',p_source_id,
    jsonb_build_object('journal_entry_id',v_entry_id,'reversal_entry_id',v_reversal.id),p_reason
  );
  return v_reversal;
end;
$$;

comment on function public.preview_accounting_source_posting(text,uuid,text,date) is
  'Read-only manual preview. Resolves active rules and mappings without creating a journal.';
comment on function public.post_accounting_source(text,uuid,text,date,text) is
  'Explicit manual source posting. Atomic and idempotent; never called by source-table triggers.';

revoke all on function public.accounting_get_source_posting_snapshot(uuid,text,uuid)
  from public, anon;
revoke all on function public.preview_accounting_source_posting(text,uuid,text,date)
  from public, anon;
revoke all on function public.post_accounting_source(text,uuid,text,date,text)
  from public, anon;
revoke all on function public.reverse_accounting_source_posting(text,uuid,date,text)
  from public, anon;

grant execute on function public.accounting_get_source_posting_snapshot(uuid,text,uuid)
  to authenticated;
grant execute on function public.preview_accounting_source_posting(text,uuid,text,date)
  to authenticated;
grant execute on function public.post_accounting_source(text,uuid,text,date,text)
  to authenticated;
grant execute on function public.reverse_accounting_source_posting(text,uuid,date,text)
  to authenticated;
