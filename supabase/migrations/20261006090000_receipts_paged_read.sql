-- Read-only, tenant-scoped receipt list. The three payment sources remain the
-- source of truth; this function neither copies nor changes financial rows.
create or replace function public.list_accounting_receipts_page_rpc(
  p_tenant_id uuid,
  p_page integer default 1,
  p_page_size integer default 50,
  p_source text default 'all',
  p_method text default 'all',
  p_date_from date default null,
  p_date_to date default null,
  p_search text default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
with authorized as materialized (
  select p_tenant_id as tenant_id
  where auth.uid() is not null
    and p_tenant_id = public.get_user_tenant_id()
), receipts as (
  select ('sales:' || sp.id::text) as id, 'sales'::text as source,
    coalesce(sp.payment_number, 'PAY-' || left(sp.id::text, 8)) as number,
    sp.date as receipt_date, sp.amount,
    coalesce(sd.customer_name, 'عميل') as payer_name,
    'sales_invoice'::text as category_id, 'cloud'::text as cashbox_id,
    coalesce(sp.method, 'cash') as payment_method,
    concat_ws(' — ', nullif(sd.doc_number, ''), nullif(sp.reference, ''), nullif(sp.notes, '')) as notes,
    sp.created_at
  from public.sales_payments sp
  join authorized a on a.tenant_id = sp.tenant_id
  left join public.sales_documents sd on sd.id = sp.sales_document_id and sd.tenant_id = sp.tenant_id
  union all
  select ('claim:' || cp.id::text), 'claim'::text,
    coalesce(cp.payment_number, 'CP-' || left(cp.id::text, 8)),
    cp.payment_date, cp.amount,
    coalesce(ic.insurance_company, 'شركة تأمين'),
    'insurance_claim'::text, 'cloud'::text,
    cp.payment_method::text,
    concat_ws(' — ', nullif(ic.claim_number, ''), nullif(cp.notes, '')),
    cp.created_at
  from public.claim_payments cp
  join authorized a on a.tenant_id = cp.tenant_id
  left join public.insurance_claims ic on ic.id = cp.claim_id and ic.tenant_id = cp.tenant_id
  union all
  select ('manual:' || ar.id::text), 'manual'::text,
    ar.receipt_number, ar.receipt_date, ar.amount,
    ar.payer_name, ar.category_id, ar.cashbox_id,
    ar.payment_method, coalesce(ar.notes, ''), ar.created_at
  from public.accounting_receipts ar
  join authorized a on a.tenant_id = ar.tenant_id
  where ar.deleted_at is null and ar.archived_at is null
), filtered as materialized (
  select * from receipts r
  where (coalesce(p_source, 'all') = 'all' or r.source = p_source)
    and (coalesce(p_method, 'all') = 'all' or r.payment_method = p_method)
    and (p_date_from is null or r.receipt_date >= p_date_from)
    and (p_date_to is null or r.receipt_date <= p_date_to)
    and (nullif(trim(p_search), '') is null or
      concat_ws(' ', r.number, r.payer_name, r.notes, r.source, r.payment_method)
        ilike '%' || trim(p_search) || '%')
), page_rows as (
  select * from filtered
  order by receipt_date desc, created_at desc, id desc
  limit least(greatest(coalesce(p_page_size, 50), 1), 100)
  offset (greatest(coalesce(p_page, 1), 1) - 1) * least(greatest(coalesce(p_page_size, 50), 1), 100)
)
select jsonb_build_object(
  'totalCount', (select count(*) from filtered),
  'totalAmount', (select coalesce(sum(amount), 0) from filtered),
  'latestNumber', (select number from filtered order by receipt_date desc, created_at desc, id desc limit 1),
  'items', coalesce((select jsonb_agg(to_jsonb(p) order by p.receipt_date desc, p.created_at desc, p.id desc) from page_rows p), '[]'::jsonb)
);
$$;

revoke all on function public.list_accounting_receipts_page_rpc(uuid, integer, integer, text, text, date, date, text) from public, anon;
grant execute on function public.list_accounting_receipts_page_rpc(uuid, integer, integer, text, text, date, date, text) to authenticated;
