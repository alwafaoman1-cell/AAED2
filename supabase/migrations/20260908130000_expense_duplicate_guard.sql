-- Central, tenant-scoped duplicate protection for expenses.
-- Exact supplier-document duplicates are rejected atomically. Similar records
-- are returned by a read-only RPC for user review before saving.

create or replace function public.normalize_expense_document_value(p_value text)
returns text
language sql
immutable
parallel safe
set search_path = pg_catalog
as $$
  select regexp_replace(lower(btrim(coalesce(p_value, ''))), '[^[:alnum:]]+', '', 'g');
$$;

alter table public.expenses
  add column if not exists document_sha256 text;

create table if not exists public.expense_duplicate_audit_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  expense_id uuid not null references public.expenses(id) on delete cascade,
  user_id uuid not null,
  action text not null check (action in ('potential_duplicate_override')),
  reason text not null,
  candidate_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.expense_duplicate_audit_logs enable row level security;

drop policy if exists expense_duplicate_audit_read on public.expense_duplicate_audit_logs;
create policy expense_duplicate_audit_read
on public.expense_duplicate_audit_logs for select to authenticated
using (
  tenant_id = public.get_user_tenant_id()
  and exists (
    select 1 from public.profiles p
    where p.user_id = auth.uid()
      and p.tenant_id = expense_duplicate_audit_logs.tenant_id
      and p.role::text in ('admin', 'manager')
  )
);

revoke all on public.expense_duplicate_audit_logs from public, anon;
grant select on public.expense_duplicate_audit_logs to authenticated;

create index if not exists idx_expense_duplicate_audit_tenant_created
  on public.expense_duplicate_audit_logs (tenant_id, created_at desc);

create index if not exists idx_expenses_duplicate_supplier_document
  on public.expenses (
    tenant_id,
    supplier_id,
    public.normalize_expense_document_value(supplier_invoice_number)
  )
  where deleted_at is null and archived_at is null
    and nullif(btrim(supplier_invoice_number), '') is not null;

create index if not exists idx_expenses_duplicate_document_hash
  on public.expenses (tenant_id, document_sha256)
  where deleted_at is null and archived_at is null
    and nullif(btrim(document_sha256), '') is not null;

create or replace function public.expense_duplicate_candidates_rpc(
  p_candidate jsonb,
  p_exclude_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_supplier_id uuid;
  v_supplier_tax text := public.normalize_expense_document_value(p_candidate->>'supplier_tax_number');
  v_beneficiary text := public.normalize_expense_document_value(p_candidate->>'beneficiary');
  v_invoice text := public.normalize_expense_document_value(p_candidate->>'supplier_invoice_number');
  v_hash text := lower(btrim(coalesce(p_candidate->>'document_sha256', '')));
  v_batch text := nullif(btrim(p_candidate->>'duplicate_batch_id'), '');
  v_total numeric := coalesce(nullif(p_candidate->>'total', '')::numeric, 0);
  v_date date := coalesce(nullif(p_candidate->>'supplier_invoice_date', '')::date, nullif(p_candidate->>'date', '')::date);
  v_work_order text := coalesce(nullif(p_candidate->>'work_order_id', ''), nullif(p_candidate->>'linked_work_order_id', ''));
  v_rows jsonb;
begin
  if v_tenant is null then raise exception 'EXPENSE_TENANT_REQUIRED'; end if;
  if coalesce(p_candidate->>'supplier_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    v_supplier_id := (p_candidate->>'supplier_id')::uuid;
  end if;

  select coalesce(jsonb_agg(to_jsonb(m) order by m.score desc, m.date desc), '[]'::jsonb)
  into v_rows
  from (
    select e.id, e.voucher_number, e.date,
      e.supplier_invoice_date, e.supplier_invoice_number,
      coalesce(nullif(e.total, 0), e.amount, 0) as total,
      coalesce(s.name, e.beneficiary, '') as supplier_name,
      coalesce(j.order_number, e.linked_work_order_id, '') as order_number,
      case
        when v_hash <> '' and lower(btrim(coalesce(e.document_sha256, ''))) = v_hash then 'exact'
        when v_invoice <> ''
          and public.normalize_expense_document_value(e.supplier_invoice_number) = v_invoice
          and (
            (v_supplier_id is not null and e.supplier_id = v_supplier_id)
            or (v_supplier_tax <> '' and public.normalize_expense_document_value(e.supplier_tax_number) = v_supplier_tax)
            or (v_supplier_id is null and v_supplier_tax = '' and v_beneficiary <> '' and public.normalize_expense_document_value(e.beneficiary) = v_beneficiary)
          ) then 'exact'
        else 'potential'
      end as match_type,
      case
        when v_hash <> '' and lower(btrim(coalesce(e.document_sha256, ''))) = v_hash then 100
        when v_invoice <> ''
          and public.normalize_expense_document_value(e.supplier_invoice_number) = v_invoice then 100
        when v_work_order <> '' and (e.work_order_id::text = v_work_order or e.linked_work_order_id = v_work_order) then 85
        else 75
      end as score
    from public.expenses e
    left join public.suppliers s on s.id = e.supplier_id and s.tenant_id = e.tenant_id
    left join public.job_orders j on j.id = e.work_order_id and j.tenant_id = e.tenant_id
    where e.tenant_id = v_tenant
      and e.id is distinct from p_exclude_id
      and e.deleted_at is null and e.archived_at is null
      and lower(coalesce(e.status, 'active')) not in ('cancelled', 'void', 'invalid')
      and (v_batch is null or coalesce(e.meta->>'duplicateBatchId', '') <> v_batch)
      and (
        (v_hash <> '' and lower(btrim(coalesce(e.document_sha256, ''))) = v_hash)
        or
        (
          v_invoice <> ''
          and public.normalize_expense_document_value(e.supplier_invoice_number) = v_invoice
          and (
            (v_supplier_id is not null and e.supplier_id = v_supplier_id)
            or (v_supplier_tax <> '' and public.normalize_expense_document_value(e.supplier_tax_number) = v_supplier_tax)
            or (v_supplier_id is null and v_supplier_tax = '' and v_beneficiary <> '' and public.normalize_expense_document_value(e.beneficiary) = v_beneficiary)
          )
        )
        or (
          abs(coalesce(nullif(e.total, 0), e.amount, 0) - v_total) < 0.0005
          and coalesce(e.supplier_invoice_date, e.date) = v_date
          and (
            (v_supplier_id is not null and e.supplier_id = v_supplier_id)
            or (v_supplier_tax <> '' and public.normalize_expense_document_value(e.supplier_tax_number) = v_supplier_tax)
            or (v_beneficiary <> '' and public.normalize_expense_document_value(e.beneficiary) = v_beneficiary)
            or (v_work_order <> '' and (e.work_order_id::text = v_work_order or e.linked_work_order_id = v_work_order))
          )
        )
      )
    order by score desc, e.date desc
    limit 10
  ) m;

  return jsonb_build_object(
    'exact', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_rows) x where x->>'match_type' = 'exact'), '[]'::jsonb),
    'potential', coalesce((select jsonb_agg(x) from jsonb_array_elements(v_rows) x where x->>'match_type' = 'potential'), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.expense_duplicate_candidates_rpc(jsonb, uuid) from public, anon;
grant execute on function public.expense_duplicate_candidates_rpc(jsonb, uuid) to authenticated;

create or replace function public.guard_expense_duplicate_document()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_invoice text := public.normalize_expense_document_value(new.supplier_invoice_number);
  v_hash text := lower(btrim(coalesce(new.document_sha256, '')));
  v_identity text;
  v_batch text := coalesce(new.meta->>'duplicateBatchId', '');
  v_existing record;
  v_override_reason text := btrim(coalesce(new.meta->>'duplicateOverrideReason', ''));
  v_role text;
begin
  if new.deleted_at is not null or new.archived_at is not null then return new; end if;

  if v_override_reason <> '' then
    select p.role::text into v_role from public.profiles p
    where p.user_id = auth.uid() and p.tenant_id = new.tenant_id limit 1;
    if coalesce(v_role, '') not in ('admin', 'manager') then
      raise exception using errcode = '42501', message = 'EXPENSE_DUPLICATE_OVERRIDE_FORBIDDEN';
    end if;
  end if;

  if v_hash <> '' then
    perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || '|document|' || v_hash, 0));
    select e.id, e.voucher_number into v_existing
    from public.expenses e
    where e.tenant_id = new.tenant_id and e.id is distinct from new.id
      and e.deleted_at is null and e.archived_at is null
      and lower(coalesce(e.status, 'active')) not in ('cancelled', 'void', 'invalid')
      and lower(btrim(coalesce(e.document_sha256, ''))) = v_hash
      and (v_batch = '' or coalesce(e.meta->>'duplicateBatchId', '') <> v_batch)
    limit 1;
    if v_existing.id is not null then
      raise exception using errcode = '23505', message = 'EXPENSE_DUPLICATE_EXACT',
        detail = jsonb_build_object('expense_id', v_existing.id, 'voucher_number', v_existing.voucher_number)::text;
    end if;
  end if;

  if v_invoice = '' then return new; end if;
  v_identity := case
    -- Prefer the tax number so two concurrent clients still share the same lock
    -- when one client has resolved supplier_id and the other has not yet.
    when public.normalize_expense_document_value(new.supplier_tax_number) <> '' then 'tax:' || public.normalize_expense_document_value(new.supplier_tax_number)
    when new.supplier_id is not null then 'supplier:' || new.supplier_id::text
    else 'name:' || public.normalize_expense_document_value(new.beneficiary)
  end;
  if v_identity = 'name:' then return new; end if;

  perform pg_advisory_xact_lock(hashtextextended(new.tenant_id::text || '|' || v_identity || '|' || v_invoice, 0));

  select e.id, e.voucher_number into v_existing
  from public.expenses e
  where e.tenant_id = new.tenant_id
    and e.id is distinct from new.id
    and e.deleted_at is null and e.archived_at is null
    and lower(coalesce(e.status, 'active')) not in ('cancelled', 'void', 'invalid')
    and public.normalize_expense_document_value(e.supplier_invoice_number) = v_invoice
    and (v_batch = '' or coalesce(e.meta->>'duplicateBatchId', '') <> v_batch)
    and (
      (new.supplier_id is not null and e.supplier_id = new.supplier_id)
      or (public.normalize_expense_document_value(new.supplier_tax_number) <> ''
          and public.normalize_expense_document_value(e.supplier_tax_number) = public.normalize_expense_document_value(new.supplier_tax_number))
      or (new.supplier_id is null and public.normalize_expense_document_value(new.supplier_tax_number) = ''
          and public.normalize_expense_document_value(e.beneficiary) = public.normalize_expense_document_value(new.beneficiary))
    )
  limit 1;

  if v_existing.id is not null then
    raise exception using
      errcode = '23505',
      message = 'EXPENSE_DUPLICATE_EXACT',
      detail = jsonb_build_object('expense_id', v_existing.id, 'voucher_number', v_existing.voucher_number)::text;
  end if;
  return new;
end;
$$;

drop trigger if exists guard_expense_duplicate_document_trigger on public.expenses;
create trigger guard_expense_duplicate_document_trigger
before insert or update of supplier_id, supplier_tax_number, supplier_invoice_number, beneficiary, document_sha256, deleted_at, archived_at, meta
on public.expenses for each row execute function public.guard_expense_duplicate_document();

create or replace function public.audit_expense_duplicate_override()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_reason text := btrim(coalesce(new.meta->>'duplicateOverrideReason', ''));
  v_previous_reason text := '';
begin
  if tg_op = 'UPDATE' then
    v_previous_reason := btrim(coalesce(old.meta->>'duplicateOverrideReason', ''));
  end if;
  if v_reason <> '' and (tg_op = 'INSERT' or v_reason is distinct from v_previous_reason) then
    insert into public.expense_duplicate_audit_logs(tenant_id, expense_id, user_id, action, reason, candidate_snapshot)
    values (new.tenant_id, new.id, auth.uid(), 'potential_duplicate_override', v_reason,
      jsonb_build_object('voucher_number', new.voucher_number, 'date', new.date, 'total', coalesce(nullif(new.total, 0), new.amount),
        'supplier_id', new.supplier_id, 'supplier_invoice_number', new.supplier_invoice_number, 'work_order_id', new.work_order_id));
  end if;
  return new;
end;
$$;

drop trigger if exists audit_expense_duplicate_override_trigger on public.expenses;
create trigger audit_expense_duplicate_override_trigger
after insert or update of meta on public.expenses
for each row execute function public.audit_expense_duplicate_override();
