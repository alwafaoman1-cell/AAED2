-- Work Order closing financial review + invoice enforcement support.
-- Non-destructive migration: adds audit/message tables and reporting views only.

create table if not exists public.work_order_closing_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  work_order_id text not null,
  invoice_id text,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.message_logs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  user_id uuid,
  work_order_id text,
  invoice_id text,
  channel text not null default 'whatsapp',
  recipient_phone text,
  template_key text,
  message text not null,
  status text not null default 'queued',
  error text,
  sent_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index if not exists idx_work_order_closing_audit_work_order
  on public.work_order_closing_audit (work_order_id, created_at desc);

create index if not exists idx_message_logs_invoice_template_sent
  on public.message_logs (invoice_id, template_key, sent_at desc);

create or replace view public.completed_work_orders_without_invoice_view as
select
  jo.id::text as work_order_id,
  coalesce(jo.order_number, jo.id::text) as work_order_number,
  jo.tenant_id,
  jo.customer_id,
  jo.vehicle_id,
  jo.status,
  jo.updated_at as closed_at,
  latest_audit.details ->> 'skipInvoiceReason' as skip_invoice_reason,
  latest_audit.details ->> 'approvedByRole' as approved_by_role
from public.job_orders jo
left join lateral (
  select a.details
  from public.work_order_closing_audit a
  where a.work_order_id = jo.id::text
  order by a.created_at desc
  limit 1
) latest_audit on true
where lower(coalesce(jo.status::text, '')) in ('ready', 'completed', 'delivered', 'closed')
  and not exists (
    select 1
    from public.sales_documents sd
    where sd.work_order_id::text = jo.id::text
      and lower(coalesce(sd.doc_type, 'invoice')) = 'invoice'
      and lower(coalesce(sd.status, '')) not in ('cancelled', 'canceled', 'draft')
  );

create or replace view public.overdue_invoices_view as
select
  sd.id::text as invoice_id,
  sd.tenant_id,
  sd.doc_number as invoice_number,
  sd.customer_id,
  sd.customer_name,
  sd.status,
  sd.total,
  coalesce(sd.paid_amount, 0) as paid_total,
  coalesce(sd.balance_due, sd.total - coalesce(sd.paid_amount, 0)) as balance_due,
  sd.due_date,
  greatest(0, (current_date - sd.due_date::date))::int as days_overdue
from public.sales_documents sd
where lower(coalesce(sd.doc_type, 'invoice')) = 'invoice'
  and lower(coalesce(sd.status, '')) not in ('paid', 'cancelled', 'canceled', 'draft')
  and coalesce(sd.balance_due, sd.total - coalesce(sd.paid_amount, 0)) > 0
  and sd.due_date::date < current_date;

alter table public.work_order_closing_audit enable row level security;
alter table public.message_logs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_order_closing_audit' and policyname = 'tenant read work order closing audit') then
    create policy "tenant read work order closing audit"
    on public.work_order_closing_audit
    for select to authenticated
    using (tenant_id is null or tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'work_order_closing_audit' and policyname = 'tenant insert work order closing audit') then
    create policy "tenant insert work order closing audit"
    on public.work_order_closing_audit
    for insert to authenticated
    with check (tenant_id is null or tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_logs' and policyname = 'tenant read message logs') then
    create policy "tenant read message logs"
    on public.message_logs
    for select to authenticated
    using (tenant_id is null or tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_logs' and policyname = 'tenant insert message logs') then
    create policy "tenant insert message logs"
    on public.message_logs
    for insert to authenticated
    with check (tenant_id is null or tenant_id = public.get_user_tenant_id());
  end if;
end $$;
