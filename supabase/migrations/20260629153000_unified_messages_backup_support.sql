-- Non-destructive support for unified message center.
-- Adds nullable columns and indexes only; no data deletion or type changes.

alter table public.message_logs
  add column if not exists customer_id uuid,
  add column if not exists vehicle_id uuid,
  add column if not exists claim_id uuid,
  add column if not exists template_type text,
  add column if not exists recipient_email text,
  add column if not exists short_link text,
  add column if not exists provider_response jsonb not null default '{}'::jsonb,
  add column if not exists created_by uuid,
  add column if not exists body text,
  add column if not exists call_result text,
  add column if not exists call_notes text,
  add column if not exists follow_up_at timestamptz;

update public.message_logs
set body = coalesce(body, message)
where body is null;

create index if not exists idx_message_logs_tenant_created
  on public.message_logs (tenant_id, created_at desc);

create index if not exists idx_message_logs_customer_created
  on public.message_logs (customer_id, created_at desc);

create index if not exists idx_message_logs_work_order_created
  on public.message_logs (work_order_id, created_at desc);

create index if not exists idx_message_logs_claim_created
  on public.message_logs (claim_id, created_at desc);

create index if not exists idx_message_logs_duplicate_guard
  on public.message_logs (tenant_id, customer_id, work_order_id, claim_id, invoice_id, channel, template_type, created_at desc);
