-- A work order can acquire a claim after it was created. The INSERT-only
-- allocator left that order with a cash number even though it was insurance.
-- Reassign only when a typed C/I number disagrees with the authoritative
-- post-update channel. UUIDs, invoice numbers and historical numbers remain
-- unchanged. All number/reference changes are in the same transaction.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  v_missing text;
begin
  select format('%s.%s', r.table_name, r.column_name) into v_missing
  from (values
    ('job_orders', 'id'), ('job_orders', 'tenant_id'),
    ('job_orders', 'order_number'), ('job_orders', 'work_order_type'),
    ('job_orders', 'claim_id'), ('job_orders', 'deleted_at'),
    ('sales_documents', 'tenant_id'), ('sales_documents', 'deleted_at'),
    ('sales_documents', 'doc_type'), ('sales_documents', 'work_order_id'),
    ('sales_documents', 'metadata'),
    ('insurance_invoices', 'tenant_id'), ('insurance_invoices', 'claim_id'),
    ('insurance_claims', 'tenant_id'), ('insurance_claims', 'deleted_at'),
    ('insurance_claims', 'job_order_id'), ('insurance_claims', 'auto_job_order_id'),
    ('expenses', 'tenant_id'), ('expenses', 'deleted_at'),
    ('expenses', 'linked_work_order_id'), ('expenses', 'work_order_id'),
    ('expenses', 'work_order_channel'), ('expenses', 'meta'),
    ('work_order_number_renumber_audit', 'tenant_id'),
    ('work_order_number_renumber_audit', 'old_order_number'),
    ('work_order_number_renumber_audit', 'new_order_number')
  ) as r(table_name, column_name)
  where not exists (
    select 1 from information_schema.columns c
    where c.table_schema = 'public' and c.table_name = r.table_name
      and c.column_name = r.column_name
  )
  limit 1;
  if v_missing is not null then
    raise exception 'WORK_ORDER_CHANNEL_ALIGNMENT_SCHEMA_INCOMPLETE: %', v_missing;
  end if;
  if to_regprocedure('public.allocate_typed_work_order_number(uuid,text,date)') is null
     or not exists (
       select 1 from pg_trigger
       where tgrelid = 'public.job_orders'::regclass
         and tgname = 'trg_enforce_job_order_type' and not tgisinternal
     )
     or not exists (
       select 1 from pg_indexes
       where schemaname = 'public' and tablename = 'job_orders'
         and indexname = 'uq_job_orders_tenant_order_number'
     ) then
    raise exception 'WORK_ORDER_CHANNEL_ALIGNMENT_DEPENDENCY_MISSING';
  end if;
end
$$;

create or replace function public.align_work_order_number_with_channel()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_old_channel text;
  v_new_channel text;
  v_year integer;
  v_invoice_ref_column text;
  v_has_invoice boolean;
begin
  if new.tenant_id is distinct from old.tenant_id or new.id is distinct from old.id then
    raise exception 'WORK_ORDER_IDENTITY_CHANGE_DENIED';
  end if;

  -- Deleted rows and historical pre-typed numbers are not silently renumbered.
  if old.deleted_at is not null or new.deleted_at is not null then
    return new;
  end if;
  v_old_channel := substring(upper(btrim(old.order_number)) from '^WO-([CI])-[0-9]{2}-[0-9]{4}$');
  if v_old_channel is null then
    return new;
  end if;

  -- trg_enforce_job_order_type runs first, so this includes claims resolved
  -- from insurance_claim_number and changes made by claim-link synchronization.
  v_new_channel := case when new.claim_id is not null or new.work_order_type = 'insurance' then 'I' else 'C' end;
  if new.claim_id is not null
     and (new.claim_id is distinct from old.claim_id or v_new_channel <> v_old_channel)
     and not exists (
       select 1 from public.insurance_claims c
       where c.id = new.claim_id and c.tenant_id = new.tenant_id
         and c.deleted_at is null
     ) then
    raise exception 'WORK_ORDER_CLAIM_TENANT_MISMATCH';
  end if;
  if v_new_channel = v_old_channel then
    -- The visible number is not editable as an ordinary form field.
    new.order_number := old.order_number;
    return new;
  end if;

  if v_new_channel = 'I' and exists (
    select 1 from public.sales_documents s
    where s.tenant_id = old.tenant_id
      and s.deleted_at is null
      and s.doc_type = 'invoice'
      and (
        s.work_order_id::text in (old.id::text, old.order_number, 'WO-' || old.id::text)
        or s.metadata ->> 'fromDocId' in (old.order_number, 'WO-' || old.id::text)
        or s.metadata ->> 'costCenter' in (old.order_number, old.id::text)
      )
  ) then
    raise exception 'WORK_ORDER_CHANNEL_CHANGE_HAS_CASH_INVOICE';
  end if;

  if v_new_channel = 'I' then
    for v_invoice_ref_column in
      select c.column_name from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'sales_documents'
        and c.column_name in ('from_doc_id', 'work_order_number')
        and c.data_type in ('text', 'character varying', 'character')
    loop
      execute format(
        'select exists (select 1 from public.sales_documents s '
        'where s.tenant_id = $1 and s.deleted_at is null and s.doc_type = ''invoice'' and s.%I = $2)',
        v_invoice_ref_column
      ) into v_has_invoice using old.tenant_id, old.order_number;
      if v_has_invoice then
        raise exception 'WORK_ORDER_CHANNEL_CHANGE_HAS_CASH_INVOICE';
      end if;
    end loop;
  end if;

  if v_new_channel = 'C' and (
    exists (
      select 1 from public.insurance_invoices i
      where i.tenant_id = old.tenant_id and i.claim_id = old.claim_id
    )
    or exists (
      select 1 from public.insurance_claims c
      where c.tenant_id = old.tenant_id and c.deleted_at is null
        and (c.job_order_id = old.id or c.auto_job_order_id = old.id)
    )
  ) then
    raise exception 'WORK_ORDER_CHANNEL_CHANGE_HAS_INSURANCE_LINK';
  end if;

  -- A legacy expense without a UUID link cannot be safely reclassified by
  -- number alone. Fail the entire transaction for manual reconciliation.
  if exists (
    select 1 from public.expenses e
    where e.tenant_id = old.tenant_id and e.deleted_at is null
      and (
        e.linked_work_order_id = old.order_number
        or e.meta ->> 'sourceWorkOrderId' = old.order_number
      )
      and e.work_order_id is distinct from old.id
  ) then
    raise exception 'WORK_ORDER_CHANNEL_CHANGE_HAS_UNRESOLVED_EXPENSE';
  end if;

  -- The old order's year remains authoritative. Reclassification never moves
  -- an order into the current calendar year's sequence just because it is
  -- being edited today. Allocation is atomic per tenant/year/channel.
  v_year := 2000 + substring(upper(btrim(old.order_number)) from '^WO-[CI]-([0-9]{2})-')::integer;
  new.order_number := public.allocate_typed_work_order_number(
    new.tenant_id,
    case when v_new_channel = 'I' then 'insurance' else 'general_customer' end,
    make_date(v_year, 1, 1)
  );
  return new;
end
$$;

revoke all on function public.align_work_order_number_with_channel() from public, anon, authenticated;

drop trigger if exists trg_reassign_work_order_number_for_channel on public.job_orders;
create trigger trg_reassign_work_order_number_for_channel
before update of work_order_type, claim_id, insurance_claim_number, insurance_company, order_number, status
on public.job_orders
for each row execute function public.align_work_order_number_with_channel();

create or replace function public.record_work_order_channel_number_change()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_ref record;
  v_channel text;
begin
  if new.order_number is not distinct from old.order_number then
    return new;
  end if;

  insert into public.work_order_number_renumber_audit (
    tenant_id, job_order_id, old_order_number, new_order_number, renumber_year
  ) values (
    new.tenant_id, new.id, old.order_number, new.order_number,
    'CHANNEL:' || upper(btrim(old.order_number))
  );

  -- These references are display identifiers; UUID relationships stay intact.
  -- Optional legacy columns are checked before updating. An error rolls back
  -- the work-order update and the number reservation together.
  for v_ref in
    select * from (values
      ('message_logs', 'work_order_id'),
      ('sales_documents', 'work_order_id'),
      ('sales_documents', 'from_doc_id'),
      ('sales_documents', 'work_order_number'),
      ('technician_notes', 'work_order_id'),
      ('technician_time_logs', 'work_order_id'),
      ('vehicle_stay_notifications', 'work_order_number'),
      ('whatsapp_conversations', 'work_order_id'),
      ('work_order_closing_audit', 'work_order_id')
    ) as refs(table_name, column_name)
  loop
    if to_regclass(format('public.%I', v_ref.table_name)) is not null
       and exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = v_ref.table_name
           and c.column_name = v_ref.column_name
           and c.data_type in ('text', 'character varying', 'character')
       )
       and exists (
         select 1 from information_schema.columns c
         where c.table_schema = 'public'
           and c.table_name = v_ref.table_name
           and c.column_name = 'tenant_id'
       ) then
      if exists (
        select 1 from information_schema.columns c
        where c.table_schema = 'public'
          and c.table_name = v_ref.table_name
          and c.column_name = 'deleted_at'
      ) then
        execute format(
          'update public.%I t set %I = $1 where t.tenant_id = $2 and t.%I = $3 and t.deleted_at is null',
          v_ref.table_name, v_ref.column_name, v_ref.column_name
        ) using new.order_number, new.tenant_id, old.order_number;
      else
        execute format(
          'update public.%I t set %I = $1 where t.tenant_id = $2 and t.%I = $3',
          v_ref.table_name, v_ref.column_name, v_ref.column_name
        ) using new.order_number, new.tenant_id, old.order_number;
      end if;
    end if;
  end loop;

  -- Re-derive the linked expense's claim/channel from the same canonical UUID.
  -- Expense validation is allowed to reject an incompatible classification;
  -- in that case the entire conversion rolls back without a false success.
  v_channel := case when new.claim_id is not null or new.work_order_type = 'insurance' then 'insurance' else 'cash' end;
  update public.expenses e
  set linked_work_order_id = new.order_number,
      work_order_channel = v_channel
  where e.tenant_id = new.tenant_id
    and e.deleted_at is null
    and e.work_order_id = new.id
    and (e.linked_work_order_id is distinct from new.order_number
         or e.work_order_channel is distinct from v_channel);

  return new;
end
$$;

revoke all on function public.record_work_order_channel_number_change() from public, anon, authenticated;

drop trigger if exists trg_record_work_order_channel_number_change on public.job_orders;
create trigger trg_record_work_order_channel_number_change
after update on public.job_orders
for each row
when (old.order_number is distinct from new.order_number)
execute function public.record_work_order_channel_number_change();

commit;
