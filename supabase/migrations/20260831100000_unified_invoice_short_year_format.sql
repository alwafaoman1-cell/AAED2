-- Short-year display format for the central customer invoice sequence.
--
-- Scope and guarantees:
--   * Only registry-backed official 2026 invoices are renamed.
--   * Sequence numbers, source UUIDs, amounts, VAT, statuses and dates do not change.
--   * Cash and insurance sources are updated from the same registry mapping.
--   * The original number remains in the immutable allocation audit event and is
--     accepted by find_unified_invoice_number as a backwards-compatible alias.
--   * Historical invoices without a registry row remain untouched.

select pg_advisory_xact_lock(hashtextextended('unified-invoice-short-year-format', 0));

create temporary table invoice_short_year_map on commit drop as
select
  r.id as registry_id,
  r.tenant_id,
  r.source_table,
  r.source_id,
  r.invoice_number as old_number,
  regexp_replace(r.invoice_number, '^INV-2026-', 'INV-26-') as new_number
from public.invoice_number_registry r
where r.invoice_year = 2026
  and r.invoice_number ~ '^INV-2026-[0-9]{6,}$';

do $$
begin
  if exists (
    select 1
    from invoice_short_year_map m
    group by m.tenant_id, m.new_number
    having count(*) > 1
  ) then
    raise exception 'INVOICE_SHORT_YEAR_DUPLICATE_MAPPING' using errcode = '23505';
  end if;

  if exists (
    select 1
    from invoice_short_year_map m
    join public.invoice_number_registry r
      on r.tenant_id = m.tenant_id
     and r.invoice_number = m.new_number
     and r.id <> m.registry_id
  ) then
    raise exception 'INVOICE_SHORT_YEAR_NUMBER_COLLISION' using errcode = '23505';
  end if;
end;
$$;

alter table public.invoice_number_registry
  drop constraint if exists invoice_number_registry_invoice_number_check;
alter table public.invoice_number_registry
  add constraint invoice_number_registry_invoice_number_check
  check (invoice_number ~ '^INV-([0-9]{2}|[0-9]{4})-[0-9]{6,}$');

alter table public.invoice_number_audit_events
  drop constraint if exists invoice_number_audit_events_event_type_check;
alter table public.invoice_number_audit_events
  add constraint invoice_number_audit_events_event_type_check
  check (event_type in ('allocated', 'renumbered', 'cancelled', 'void', 'reversed'));

alter table public.invoice_number_registry
  disable trigger trg_invoice_number_registry_immutable;

update public.invoice_number_registry r
set invoice_number = m.new_number
from invoice_short_year_map m
where r.id = m.registry_id;

alter table public.invoice_number_registry
  enable trigger trg_invoice_number_registry_immutable;

-- Source-number triggers read the already-updated registry and therefore keep
-- the official source rows aligned without changing any financial column.
update public.sales_documents sd
set doc_number = m.new_number
from invoice_short_year_map m
where m.source_table = 'sales_documents'
  and sd.tenant_id = m.tenant_id
  and sd.id = m.source_id
  and sd.doc_number is distinct from m.new_number;

update public.insurance_invoices ii
set invoice_number = m.new_number
from invoice_short_year_map m
where m.source_table = 'insurance_invoices'
  and ii.tenant_id = m.tenant_id
  and ii.id = m.source_id
  and ii.invoice_number is distinct from m.new_number;

insert into public.invoice_number_audit_events (
  tenant_id, registry_id, source_table, source_id, invoice_number,
  event_type, event_at, event_by, details
)
select
  m.tenant_id, m.registry_id, m.source_table, m.source_id, m.new_number,
  'renumbered', clock_timestamp(), null,
  jsonb_build_object(
    'reason', 'short_year_format_approved',
    'old_invoice_number', m.old_number,
    'new_invoice_number', m.new_number
  )
from invoice_short_year_map m
on conflict (tenant_id, source_table, source_id, event_type) do nothing;

do $$
begin
  if exists (
    select 1
    from invoice_short_year_map m
    left join public.sales_documents sd
      on m.source_table = 'sales_documents'
     and sd.tenant_id = m.tenant_id
     and sd.id = m.source_id
    left join public.insurance_invoices ii
      on m.source_table = 'insurance_invoices'
     and ii.tenant_id = m.tenant_id
     and ii.id = m.source_id
    where (m.source_table = 'sales_documents' and sd.id is not null and sd.doc_number <> m.new_number)
       or (m.source_table = 'insurance_invoices' and ii.id is not null and ii.invoice_number <> m.new_number)
  ) then
    raise exception 'INVOICE_SHORT_YEAR_SOURCE_ALIGNMENT_FAILED' using errcode = '55000';
  end if;
end;
$$;

alter table public.invoice_numbering_settings
  drop constraint if exists invoice_numbering_settings_format_check;
alter table public.invoice_numbering_settings
  alter column numbering_format set default 'INV-YY-NNNNNN';
update public.invoice_numbering_settings
set numbering_format = 'INV-YY-NNNNNN'
where numbering_format is distinct from 'INV-YY-NNNNNN';
alter table public.invoice_numbering_settings
  add constraint invoice_numbering_settings_format_check
  check (numbering_format = 'INV-YY-NNNNNN');

alter table public.invoice_numbering_settings
  drop column if exists first_invoice_number;
alter table public.invoice_numbering_settings
  add column first_invoice_number text generated always as (
    prefix || '-' || right(cutover_year::text, 2) || '-' ||
    lpad(first_sequence::text, greatest(padding, 6), '0')
  ) stored;

create or replace function public.allocate_invoice_number_internal(
  p_tenant_id uuid,
  p_source_table text,
  p_source_id uuid,
  p_invoice_type text,
  p_issue_date date,
  p_issued_at timestamptz,
  p_issued_by uuid
)
returns public.invoice_number_registry
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.invoice_number_registry%rowtype;
  v_settings public.invoice_numbering_settings%rowtype;
  v_year smallint;
  v_sequence bigint;
  v_number text;
  v_result public.invoice_number_registry%rowtype;
begin
  if p_tenant_id is null or p_source_id is null then
    raise exception 'tenant_id and source_id are required' using errcode = '22004';
  end if;
  if p_source_table not in ('sales_documents', 'insurance_invoices') then
    raise exception 'unsupported invoice source: %', p_source_table using errcode = '22023';
  end if;
  if p_invoice_type not in ('cash', 'insurance') then
    raise exception 'unsupported invoice type: %', p_invoice_type using errcode = '22023';
  end if;
  if (p_source_table = 'sales_documents' and p_invoice_type <> 'cash')
     or (p_source_table = 'insurance_invoices' and p_invoice_type <> 'insurance') then
    raise exception 'invoice type does not match source table' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_tenant_id::text || ':' || p_source_table || ':' || p_source_id::text, 0)
  );

  select * into v_existing
  from public.invoice_number_registry
  where tenant_id = p_tenant_id
    and source_table = p_source_table
    and source_id = p_source_id;
  if found then return v_existing; end if;

  select * into v_settings
  from public.invoice_numbering_settings
  where tenant_id = p_tenant_id
    and activated_at <= clock_timestamp()
  for share;
  if not found then
    raise exception 'unified invoice numbering is not active for this tenant' using errcode = '55000';
  end if;

  v_year := extract(year from p_issue_date)::smallint;
  insert into public.invoice_number_sequences (tenant_id, invoice_year, next_value, updated_at)
  values (
    p_tenant_id, v_year,
    case when v_year = v_settings.cutover_year then v_settings.first_sequence + 1 else 2 end,
    clock_timestamp()
  )
  on conflict (tenant_id, invoice_year) do update
    set next_value = public.invoice_number_sequences.next_value + 1,
        updated_at = clock_timestamp()
  returning next_value - 1 into v_sequence;

  v_number := v_settings.prefix || '-' || right(v_year::text, 2) || '-' ||
    lpad(v_sequence::text, greatest(v_settings.padding, 6), '0');

  insert into public.invoice_number_registry (
    tenant_id, invoice_year, sequence_number, invoice_number,
    invoice_type, source_table, source_id, issued_at, issued_by
  ) values (
    p_tenant_id, v_year, v_sequence, v_number,
    p_invoice_type, p_source_table, p_source_id,
    coalesce(p_issued_at, clock_timestamp()), p_issued_by
  ) returning * into v_result;

  insert into public.invoice_number_audit_events (
    tenant_id, registry_id, source_table, source_id, invoice_number,
    event_type, event_at, event_by
  ) values (
    p_tenant_id, v_result.id, p_source_table, p_source_id, v_result.invoice_number,
    'allocated', v_result.issued_at, p_issued_by
  );
  return v_result;
end;
$$;

revoke all on function public.allocate_invoice_number_internal(uuid,text,uuid,text,date,timestamptz,uuid)
  from public, anon, authenticated;
grant execute on function public.allocate_invoice_number_internal(uuid,text,uuid,text,date,timestamptz,uuid)
  to service_role;

create or replace function public.activate_unified_invoice_numbering(
  p_year smallint,
  p_first_sequence bigint,
  p_padding smallint default 6
)
returns public.invoice_numbering_settings
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
  v_role text;
  v_highest_sales bigint := 0;
  v_highest_insurance bigint := 0;
  v_highest_history bigint := 0;
  v_result public.invoice_numbering_settings%rowtype;
  v_short_year text;
begin
  v_tenant_id := public.get_user_tenant_id();
  v_role := public.get_user_role()::text;
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_role not in ('admin', 'manager') then
    raise exception 'invoice numbering activation requires admin or manager' using errcode = '42501';
  end if;
  if p_year not between 2000 and 9999 or p_first_sequence < 1 or p_padding not between 6 and 12 then
    raise exception 'invalid cutover parameters' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_tenant_id::text || ':invoice-numbering-activation', 0));
  if exists (select 1 from public.invoice_numbering_settings where tenant_id = v_tenant_id) then
    raise exception 'unified invoice numbering is already activated for this tenant' using errcode = '55000';
  end if;
  if not exists (select 1 from public.profiles p where p.tenant_id = v_tenant_id) then
    raise exception 'INVOICE_NUMBERING_TENANT_HAS_NO_USERS' using errcode = '55000';
  end if;

  v_short_year := right(p_year::text, 2);
  select coalesce(max(
    case
      when btrim(sd.doc_number) ~ ('^INV-' || p_year::text || '-[0-9]+$')
        then substring(btrim(sd.doc_number) from '^INV-' || p_year::text || '-([0-9]+)$')::bigint
      when btrim(sd.doc_number) ~ ('^INV-' || v_short_year || '-[0-9]+$')
        then substring(btrim(sd.doc_number) from '^INV-' || v_short_year || '-([0-9]+)$')::bigint
      else null
    end
  ), 0) into v_highest_sales
  from public.sales_documents sd
  where sd.tenant_id = v_tenant_id and sd.doc_type = 'invoice';

  select coalesce(max(
    case
      when btrim(ii.invoice_number) ~ '^[0-9]+$' then btrim(ii.invoice_number)::bigint
      when btrim(ii.invoice_number) ~ ('^INV-' || p_year::text || '-[0-9]+$')
        then substring(btrim(ii.invoice_number) from '^INV-' || p_year::text || '-([0-9]+)$')::bigint
      when btrim(ii.invoice_number) ~ ('^INV-' || v_short_year || '-[0-9]+$')
        then substring(btrim(ii.invoice_number) from '^INV-' || v_short_year || '-([0-9]+)$')::bigint
      else null
    end
  ), 0) into v_highest_insurance
  from public.insurance_invoices ii
  where ii.tenant_id = v_tenant_id;

  v_highest_history := greatest(v_highest_sales, v_highest_insurance);
  if p_first_sequence <= v_highest_history then
    raise exception 'INVOICE_SEQUENCE_START_COLLIDES_WITH_HISTORY: start %, highest %',
      p_first_sequence, v_highest_history using errcode = '22023';
  end if;

  insert into public.invoice_numbering_settings (
    tenant_id, activated_at, activated_by, cutover_year, first_sequence, padding, numbering_format
  ) values (
    v_tenant_id, clock_timestamp(), auth.uid(), p_year, p_first_sequence, p_padding, 'INV-YY-NNNNNN'
  ) returning * into v_result;

  insert into public.invoice_number_sequences (tenant_id, invoice_year, next_value)
  values (v_tenant_id, p_year, p_first_sequence)
  on conflict (tenant_id, invoice_year) do nothing;
  return v_result;
end;
$$;

revoke all on function public.activate_unified_invoice_numbering(smallint,bigint,smallint)
  from public, anon;
grant execute on function public.activate_unified_invoice_numbering(smallint,bigint,smallint)
  to authenticated, service_role;

drop function if exists public.find_unified_invoice_number(text);
create function public.find_unified_invoice_number(p_invoice_number text)
returns table (
  source_type text,
  source_id uuid,
  invoice_number text,
  invoice_type text,
  tenant_id uuid,
  is_historical boolean,
  invoice_date date,
  route text,
  ambiguous_historical_number boolean
)
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid := public.get_user_tenant_id();
  v_number text := upper(btrim(coalesce(p_invoice_number, '')));
begin
  if auth.uid() is null or v_tenant_id is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_number = '' then return; end if;

  if exists (
    select 1 from public.invoice_number_registry r
    where r.tenant_id = v_tenant_id and upper(r.invoice_number) = v_number
  ) then
    return query
    select r.source_table, r.source_id, r.invoice_number, r.invoice_type, r.tenant_id,
      false, r.issued_at::date,
      case when r.source_table = 'sales_documents'
        then '/sales/invoices/' || r.source_id::text
        else '/insurance/accounting?invoice=' || r.source_id::text end,
      false
    from public.invoice_number_registry r
    where r.tenant_id = v_tenant_id and upper(r.invoice_number) = v_number;
    return;
  end if;

  -- Old official number remains a lookup alias through its immutable allocation event.
  if exists (
    select 1
    from public.invoice_number_audit_events e
    join public.invoice_number_registry r on r.id = e.registry_id and r.tenant_id = e.tenant_id
    where e.tenant_id = v_tenant_id
      and e.event_type = 'allocated'
      and upper(e.invoice_number) = v_number
  ) then
    return query
    select r.source_table, r.source_id, r.invoice_number, r.invoice_type, r.tenant_id,
      false, r.issued_at::date,
      case when r.source_table = 'sales_documents'
        then '/sales/invoices/' || r.source_id::text
        else '/insurance/accounting?invoice=' || r.source_id::text end,
      false
    from public.invoice_number_audit_events e
    join public.invoice_number_registry r on r.id = e.registry_id and r.tenant_id = e.tenant_id
    where e.tenant_id = v_tenant_id
      and e.event_type = 'allocated'
      and upper(e.invoice_number) = v_number;
    return;
  end if;

  return query
  with historical as (
    select 'sales_documents'::text source_type, sd.id source_id, sd.doc_number invoice_number,
      'cash'::text invoice_type, sd.tenant_id, sd.date invoice_date,
      '/sales/invoices/' || sd.id::text route
    from public.sales_documents sd
    where sd.tenant_id = v_tenant_id and sd.doc_type = 'invoice'
      and upper(btrim(sd.doc_number)) = v_number
    union all
    select 'insurance_invoices', ii.id, ii.invoice_number, 'insurance', ii.tenant_id,
      coalesce(ii.invoice_date, ii.issued_at::date, ii.created_at::date),
      '/insurance/accounting?invoice=' || ii.id::text
    from public.insurance_invoices ii
    where ii.tenant_id = v_tenant_id and upper(btrim(ii.invoice_number)) = v_number
    union all
    select 'invoices', i.id, i.invoice_number, 'legacy', i.tenant_id, i.created_at::date,
      '/work-orders/' || i.job_order_id::text
    from public.invoices i
    where i.tenant_id = v_tenant_id and upper(btrim(i.invoice_number)) = v_number
  ), counted as (
    select h.*, count(*) over () > 1 as is_ambiguous from historical h
  )
  select c.source_type, c.source_id, c.invoice_number, c.invoice_type, c.tenant_id,
    true, c.invoice_date, c.route, c.is_ambiguous
  from counted c
  order by c.invoice_date desc nulls last, c.source_type, c.source_id;
end;
$$;

revoke all on function public.find_unified_invoice_number(text) from public, anon;
grant execute on function public.find_unified_invoice_number(text) to authenticated, service_role;

comment on function public.find_unified_invoice_number(text) is
  'Tenant-isolated lookup for current short-year invoice numbers, prior official aliases, and historical sources.';
