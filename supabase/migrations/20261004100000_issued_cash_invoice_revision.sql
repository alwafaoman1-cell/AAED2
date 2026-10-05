-- Correct an issued cash invoice without changing its official number or
-- silently rewriting a posted journal. No existing invoice is modified here.
create table if not exists public.sales_invoice_revisions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete restrict,
  -- Keep the historical UUID even if an administrator later hard-removes the
  -- source; an audit record must not break existing deletion workflows.
  sales_document_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  invoice_number text not null,
  reason text not null check (length(btrim(reason)) >= 4),
  before_snapshot jsonb not null,
  after_snapshot jsonb not null,
  revised_by uuid not null,
  revised_at timestamptz not null default clock_timestamp(),
  unique (tenant_id, sales_document_id, revision_number)
);

create index if not exists idx_sales_invoice_revisions_document
  on public.sales_invoice_revisions (tenant_id, sales_document_id, revision_number desc);

alter table public.sales_invoice_revisions enable row level security;
revoke all on public.sales_invoice_revisions from public, anon, authenticated;
grant select on public.sales_invoice_revisions to authenticated;
grant all on public.sales_invoice_revisions to service_role;

drop policy if exists sales_invoice_revisions_manager_read on public.sales_invoice_revisions;
create policy sales_invoice_revisions_manager_read on public.sales_invoice_revisions
  for select to authenticated
  using (tenant_id = public.get_user_tenant_id()
    and public.get_user_role()::text in ('admin', 'manager'));

create or replace function public.guard_issued_cash_invoice_content()
returns trigger language plpgsql
set search_path = public, pg_temp
as $$
begin
  if old.doc_type = 'invoice' and (old.issued_at is not null or old.invoice_status in ('issued', 'credited'))
     and new.doc_number is distinct from old.doc_number then
    raise exception 'ISSUED_CASH_INVOICE_NUMBER_IMMUTABLE' using errcode = '42501';
  end if;
  if old.doc_type = 'invoice'
     and (old.invoice_status in ('issued', 'credited') or old.issued_at is not null)
     and current_setting('app.issued_cash_invoice_revision', true) is distinct from 'allowed'
     and (new.issued_at, new.customer_id, new.customer_name, new.customer_phone, new.date, new.due_date,
          new.items, new.subtotal, new.discount_total, new.tax_total, new.total,
          new.notes, new.vehicle_plate, new.vehicle_make, new.vehicle_model,
          new.metadata->'customerAddress', new.metadata->'customerTaxNo', new.metadata->'currency',
          new.metadata->'terms', new.metadata->'vehicle', new.metadata->'customField',
          new.metadata->'paymentTerms', new.metadata->'headerLines')
         is distinct from
         (old.issued_at, old.customer_id, old.customer_name, old.customer_phone, old.date, old.due_date,
          old.items, old.subtotal, old.discount_total, old.tax_total, old.total,
          old.notes, old.vehicle_plate, old.vehicle_make, old.vehicle_model,
          old.metadata->'customerAddress', old.metadata->'customerTaxNo', old.metadata->'currency',
          old.metadata->'terms', old.metadata->'vehicle', old.metadata->'customField',
          old.metadata->'paymentTerms', old.metadata->'headerLines') then
    raise exception 'ISSUED_CASH_INVOICE_REVISION_REQUIRED' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_guard_issued_cash_invoice_content on public.sales_documents;
create trigger trg_guard_issued_cash_invoice_content
  before update on public.sales_documents
  for each row execute function public.guard_issued_cash_invoice_content();

create or replace function public.revise_issued_cash_invoice(
  p_source_id uuid,
  p_expected_updated_at timestamptz,
  p_reason text,
  p_changes jsonb
)
returns public.sales_documents
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_old public.sales_documents%rowtype;
  v_new public.sales_documents%rowtype;
  v_item jsonb;
  v_meta_patch jsonb := p_changes->'metadata';
  v_meta jsonb;
  v_customer_id uuid;
  v_date date;
  v_due_date date;
  v_qty numeric;
  v_unit numeric;
  v_discount numeric;
  v_rate numeric;
  v_subtotal numeric := 0;
  v_discount_total numeric := 0;
  v_tax_total numeric := 0;
  v_total numeric;
  v_paid numeric;
  v_registry_year smallint;
  v_revision integer;
  v_before jsonb;
  v_after jsonb;
begin
  if auth.uid() is null or v_tenant is null
     or public.get_user_role()::text not in ('admin', 'manager') then
    raise exception 'INVOICE_REVISION_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_source_id is null or p_expected_updated_at is null
     or length(btrim(coalesce(p_reason, ''))) < 4
     or jsonb_typeof(p_changes) is distinct from 'object' then
    raise exception 'INVOICE_REVISION_INPUT_REQUIRED' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(p_changes) as entry(field_name)
             where entry.field_name not in ('customer_id', 'customer_name', 'customer_phone', 'date', 'due_date',
               'items', 'notes', 'vehicle_plate', 'vehicle_make', 'vehicle_model', 'metadata')) then
    raise exception 'INVOICE_REVISION_FIELD_NOT_ALLOWED' using errcode = '22023';
  end if;

  select d.* into v_old from public.sales_documents d
   where d.id = p_source_id and d.tenant_id = v_tenant for update;
  if not found then raise exception 'INVOICE_REVISION_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_old.doc_type <> 'invoice' or v_old.invoice_status <> 'issued'
     or v_old.deleted_at is not null
     or v_old.archived_at is not null or v_old.pdf_snapshot_url is not null
     or v_old.invoice_hash is not null or v_old.invoice_snapshot_json is not null
     or v_old.status in ('cancelled', 'canceled', 'void', 'deleted') then
    raise exception 'INVOICE_REVISION_NOT_ISSUED_CASH' using errcode = '55000';
  end if;
  if v_old.updated_at is distinct from p_expected_updated_at then
    raise exception 'INVOICE_REVISION_STALE' using errcode = '40001';
  end if;
  if exists (
    select 1 from public.accounting_source_links s
    join public.accounting_journal_entries e
      on e.tenant_id = s.tenant_id and e.id = s.journal_entry_id
    where s.tenant_id = v_tenant and s.source_type = 'sales_invoice'
      and s.source_id = p_source_id and e.status::text <> 'reversed'
  ) then
    raise exception 'INVOICE_REVISION_ACCOUNTING_POSTED' using errcode = '55000';
  end if;

  if nullif(btrim(coalesce(p_changes->>'customer_name', '')), '') is null
     or nullif(p_changes->>'date', '') is null
     or jsonb_typeof(p_changes->'items') is distinct from 'array'
     or jsonb_array_length(p_changes->'items') = 0 then
    raise exception 'INVOICE_REVISION_CUSTOMER_DATE_ITEMS_REQUIRED' using errcode = '22023';
  end if;
  v_date := (p_changes->>'date')::date;
  v_due_date := nullif(p_changes->>'due_date', '')::date;
  v_customer_id := nullif(p_changes->>'customer_id', '')::uuid;
  if v_customer_id is not null and not exists (
    select 1 from public.customers c where c.id = v_customer_id and c.tenant_id = v_tenant
  ) then
    raise exception 'INVOICE_REVISION_CUSTOMER_NOT_FOUND' using errcode = '22023';
  end if;
  select r.invoice_year into v_registry_year
    from public.invoice_number_registry r
   where r.tenant_id = v_tenant and r.source_table = 'sales_documents'
     and r.source_id = p_source_id and r.invoice_number = v_old.doc_number;
  if found then
    if extract(year from v_date)::smallint <> v_registry_year then
      raise exception 'INVOICE_REVISION_NUMBER_YEAR_MISMATCH' using errcode = '22023';
    end if;
  elsif extract(year from v_date) <> extract(year from v_old.date) then
    raise exception 'INVOICE_REVISION_NUMBER_YEAR_MISMATCH' using errcode = '22023';
  end if;

  for v_item in select value from jsonb_array_elements(p_changes->'items') loop
    if jsonb_typeof(v_item) is distinct from 'object'
       or coalesce(nullif(btrim(v_item->>'description'), ''),
                   nullif(btrim(v_item->>'itemName'), '')) is null then
      raise exception 'INVOICE_REVISION_INVALID_ITEM' using errcode = '22023';
    end if;
    v_qty := (v_item->>'quantity')::numeric;
    v_unit := (v_item->>'unitPrice')::numeric;
    v_discount := coalesce((v_item->>'discount')::numeric, 0);
    v_rate := coalesce((v_item->>'tax')::numeric, 0);
    if v_qty is null or v_qty <= 0 or v_qty::text in ('NaN', 'Infinity', '-Infinity')
       or v_unit is null or v_unit < 0 or v_unit::text in ('NaN', 'Infinity', '-Infinity')
       or v_discount::text in ('NaN', 'Infinity', '-Infinity')
       or v_rate::text in ('NaN', 'Infinity', '-Infinity')
       or v_discount < 0 or v_discount > 100 or v_rate < 0 or v_rate > 100 then
      raise exception 'INVOICE_REVISION_INVALID_ITEM' using errcode = '22023';
    end if;
    v_subtotal := v_subtotal + v_qty * v_unit;
    v_discount_total := v_discount_total + v_qty * v_unit * v_discount / 100;
    v_tax_total := v_tax_total + v_qty * v_unit * (1 - v_discount / 100) * v_rate / 100;
  end loop;
  v_subtotal := round(v_subtotal, 3);
  v_discount_total := round(v_discount_total, 3);
  v_tax_total := round(v_tax_total, 3);
  v_total := round(v_subtotal - v_discount_total + v_tax_total, 3);
  if (v_date is distinct from v_old.date or p_changes->'items' is distinct from v_old.items
      or v_total is distinct from v_old.total or v_tax_total is distinct from v_old.tax_total)
     and exists (
       select 1 from public.accounting_periods ap
        where ap.tenant_id = v_tenant and ap.status in ('closed', 'locked')
          and (v_old.date between ap.start_date and ap.end_date
            or v_date between ap.start_date and ap.end_date)
     ) then
    raise exception 'INVOICE_REVISION_PERIOD_CLOSED' using errcode = '55000';
  end if;

  select round(coalesce(sum(p.amount), 0), 3) into v_paid
    from public.sales_payments p
   where p.tenant_id = v_tenant and p.sales_document_id = p_source_id;
  if v_total < v_paid then
    raise exception 'INVOICE_REVISION_BELOW_PAID' using errcode = '22023';
  end if;
  if v_meta_patch is not null and jsonb_typeof(v_meta_patch) is distinct from 'object' then
    raise exception 'INVOICE_REVISION_INVALID_METADATA' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(v_meta_patch, '{}'::jsonb)) as entry(field_name)
             where entry.field_name not in ('customerAddress', 'customerTaxNo', 'currency', 'terms',
               'documentReference', 'vehicle', 'customField', 'paymentTerms', 'headerLines')) then
    raise exception 'INVOICE_REVISION_INVALID_METADATA' using errcode = '22023';
  end if;
  if v_meta_patch ? 'currency' and v_meta_patch->'currency' is distinct from
     coalesce(v_old.metadata->'currency', '"OMR"'::jsonb) then
    raise exception 'INVOICE_REVISION_CURRENCY_IMMUTABLE' using errcode = '22023';
  end if;
  v_meta := coalesce(v_old.metadata, '{}'::jsonb) || coalesce(v_meta_patch, '{}'::jsonb);
  v_before := jsonb_build_object('customer_id', v_old.customer_id, 'customer_name', v_old.customer_name,
    'customer_phone', v_old.customer_phone,
    'date', v_old.date, 'due_date', v_old.due_date, 'items', v_old.items, 'notes', v_old.notes,
    'subtotal', v_old.subtotal, 'discount_total', v_old.discount_total,
    'tax_total', v_old.tax_total, 'total', v_old.total, 'paid_amount', v_old.paid_amount,
    'vehicle_plate', v_old.vehicle_plate, 'vehicle_make', v_old.vehicle_make,
    'vehicle_model', v_old.vehicle_model,
    'metadata', coalesce(v_old.metadata, '{}'::jsonb) - 'attachments' - 'noteEntries' - 'appointments' - 'payments');

  perform set_config('app.issued_cash_invoice_revision', 'allowed', true);
  update public.sales_documents d set
    customer_id = v_customer_id,
    customer_name = btrim(p_changes->>'customer_name'),
    customer_phone = nullif(btrim(coalesce(p_changes->>'customer_phone', '')), ''),
    date = v_date,
    due_date = v_due_date,
    items = p_changes->'items',
    notes = p_changes->>'notes',
    subtotal = v_subtotal,
    discount_total = v_discount_total,
    tax_total = v_tax_total,
    total = v_total,
    vehicle_plate = p_changes->>'vehicle_plate',
    vehicle_make = p_changes->>'vehicle_make',
    vehicle_model = p_changes->>'vehicle_model',
    metadata = v_meta
  where d.id = p_source_id and d.tenant_id = v_tenant
  returning d.* into v_new;
  perform set_config('app.issued_cash_invoice_revision', '', true);

  v_after := jsonb_build_object('customer_id', v_new.customer_id, 'customer_name', v_new.customer_name,
    'customer_phone', v_new.customer_phone,
    'date', v_new.date, 'due_date', v_new.due_date, 'items', v_new.items, 'notes', v_new.notes,
    'subtotal', v_new.subtotal, 'discount_total', v_new.discount_total,
    'tax_total', v_new.tax_total, 'total', v_new.total, 'paid_amount', v_new.paid_amount,
    'vehicle_plate', v_new.vehicle_plate, 'vehicle_make', v_new.vehicle_make,
    'vehicle_model', v_new.vehicle_model,
    'metadata', coalesce(v_new.metadata, '{}'::jsonb) - 'attachments' - 'noteEntries' - 'appointments' - 'payments');
  if v_before = v_after then
    raise exception 'INVOICE_REVISION_NO_CHANGES' using errcode = '22023';
  end if;
  select coalesce(max(r.revision_number), 0) + 1 into v_revision
    from public.sales_invoice_revisions r
   where r.tenant_id = v_tenant and r.sales_document_id = p_source_id;
  insert into public.sales_invoice_revisions (
    tenant_id, sales_document_id, revision_number, invoice_number,
    reason, before_snapshot, after_snapshot, revised_by
  ) values (
    v_tenant, p_source_id, v_revision, v_old.doc_number,
    btrim(p_reason), v_before, v_after, auth.uid()
  );
  return v_new;
end;
$$;

revoke all on function public.revise_issued_cash_invoice(uuid,timestamptz,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.revise_issued_cash_invoice(uuid,timestamptz,text,jsonb)
  to authenticated, service_role;
