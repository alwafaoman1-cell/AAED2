-- WhatsApp Cloud API readiness foundation.
-- Non-destructive: only adds missing columns, tables, indexes, and RLS policies.

alter table public.message_logs
  add column if not exists direction text not null default 'outbound',
  add column if not exists message_type text not null default 'text',
  add column if not exists provider text,
  add column if not exists provider_message_id text,
  add column if not exists idempotency_key text,
  add column if not exists customer_id uuid,
  add column if not exists vehicle_id uuid,
  add column if not exists claim_id uuid,
  add column if not exists recipient_email text,
  add column if not exists body text,
  add column if not exists short_link text,
  add column if not exists provider_response jsonb not null default '{}'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb,
  add column if not exists queued_at timestamptz,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_reason text,
  add column if not exists conversation_id uuid;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.message_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.message_logs drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.message_logs
  add constraint message_logs_status_whatsapp_ready_check
  check (status in ('pending','queued','sent','delivered','read','failed','received','dry_run','cancelled')) not valid;

alter table public.whatsapp_logs
  add column if not exists message_log_id uuid,
  add column if not exists meta_message_id text,
  add column if not exists idempotency_key text,
  add column if not exists direction text not null default 'outbound',
  add column if not exists payload jsonb not null default '{}'::jsonb,
  add column if not exists provider_response jsonb not null default '{}'::jsonb,
  add column if not exists delivered_at timestamptz,
  add column if not exists read_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_code text,
  add column if not exists failure_reason text;

do $$
declare
  c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.whatsapp_logs'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%status%'
  loop
    execute format('alter table public.whatsapp_logs drop constraint if exists %I', c.conname);
  end loop;
end $$;

alter table public.whatsapp_logs
  add constraint whatsapp_logs_status_whatsapp_ready_check
  check (status in ('pending','queued','sent','delivered','read','failed','received','dry_run','cancelled')) not valid;

alter table public.tenant_integrations
  add column if not exists webhook_url text,
  add column if not exists last_health_check_at timestamptz,
  add column if not exists last_error text,
  add column if not exists token_expires_at timestamptz,
  add column if not exists webhook_status text,
  add column if not exists templates_sync_status text,
  add column if not exists templates_synced_at timestamptz;

create table if not exists public.message_idempotency_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  idempotency_key text not null,
  channel text not null,
  recipient text,
  logical_action text,
  message_log_id uuid,
  status text not null default 'reserved',
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours'),
  unique (tenant_id, idempotency_key)
);

create table if not exists public.whatsapp_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  customer_id uuid,
  vehicle_id uuid,
  work_order_id text,
  claim_id uuid,
  phone text not null,
  customer_name_snapshot text,
  last_message_at timestamptz,
  last_message_preview text,
  unread_count integer not null default 0,
  assigned_user_id uuid,
  status text not null default 'open',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, phone)
);

create table if not exists public.whatsapp_webhook_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid,
  event_hash text not null,
  event_type text not null,
  phone_number_id text,
  meta_message_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null default 'received',
  error text,
  payload jsonb not null default '{}'::jsonb,
  unique (event_hash)
);

create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  meta_template_id text,
  name text not null,
  language text not null default 'ar',
  category text,
  status text not null default 'unknown',
  header_type text,
  header_content text,
  body text,
  footer text,
  buttons jsonb not null default '[]'::jsonb,
  variables_schema jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, name, language)
);

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  message_log_id uuid,
  whatsapp_log_id uuid,
  storage_path text,
  public_url text,
  file_name text,
  mime_type text,
  file_size bigint,
  attachment_type text not null default 'document',
  provider_media_id text,
  direction text not null default 'outbound',
  created_at timestamptz not null default now()
);

alter table public.message_attachments
  add constraint message_attachments_https_url_check
  check (public_url is null or public_url ~* '^https://') not valid;

alter table public.message_attachments
  add constraint message_attachments_mime_check
  check (
    mime_type is null or mime_type in (
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp',
      'audio/mpeg',
      'audio/ogg'
    )
  ) not valid;

alter table public.message_attachments
  add constraint message_attachments_size_check
  check (file_size is null or file_size <= 12582912) not valid;

create index if not exists idx_message_logs_tenant_status_created
  on public.message_logs (tenant_id, status, created_at desc);

create unique index if not exists uq_message_logs_tenant_idempotency
  on public.message_logs (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_whatsapp_logs_message_log
  on public.whatsapp_logs (message_log_id);

create unique index if not exists uq_whatsapp_logs_tenant_idempotency
  on public.whatsapp_logs (tenant_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists idx_whatsapp_conversations_tenant_last
  on public.whatsapp_conversations (tenant_id, last_message_at desc);

create index if not exists idx_whatsapp_webhook_events_tenant_received
  on public.whatsapp_webhook_events (tenant_id, received_at desc);

create index if not exists idx_whatsapp_templates_tenant_status
  on public.whatsapp_templates (tenant_id, status);

create index if not exists idx_message_attachments_message
  on public.message_attachments (message_log_id);

alter table public.message_idempotency_keys enable row level security;
alter table public.whatsapp_conversations enable row level security;
alter table public.whatsapp_webhook_events enable row level security;
alter table public.whatsapp_templates enable row level security;
alter table public.message_attachments enable row level security;

create or replace function public.reserve_message_idempotency(
  p_tenant_id uuid,
  p_idempotency_key text,
  p_channel text,
  p_recipient text,
  p_logical_action text
)
returns table(message_log_id uuid, status text, inserted boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.message_idempotency_keys (
    tenant_id,
    idempotency_key,
    channel,
    recipient,
    logical_action,
    status
  )
  values (
    p_tenant_id,
    p_idempotency_key,
    p_channel,
    p_recipient,
    p_logical_action,
    'reserved'
  )
  on conflict (tenant_id, idempotency_key) do nothing;

  return query
  select k.message_log_id, k.status, (k.message_log_id is null and k.status = 'reserved') as inserted
  from public.message_idempotency_keys k
  where k.tenant_id = p_tenant_id and k.idempotency_key = p_idempotency_key
  limit 1;
end;
$$;

do $$
begin
  drop policy if exists "tenant read message idempotency" on public.message_idempotency_keys;
  drop policy if exists "tenant insert message idempotency" on public.message_idempotency_keys;

  drop policy if exists "Tenant read whatsapp logs" on public.whatsapp_logs;
  drop policy if exists "Staff insert whatsapp logs" on public.whatsapp_logs;
  drop policy if exists "Staff update whatsapp logs" on public.whatsapp_logs;
  drop policy if exists "Admin delete whatsapp logs" on public.whatsapp_logs;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_logs' and policyname = 'admin read provider whatsapp logs') then
    create policy "admin read provider whatsapp logs" on public.whatsapp_logs
      for select to authenticated using (
        tenant_id = public.get_user_tenant_id()
        and exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.tenant_id = public.whatsapp_logs.tenant_id
            and p.role in ('owner','admin','super_admin')
        )
      );
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_conversations' and policyname = 'tenant read whatsapp conversations') then
    create policy "tenant read whatsapp conversations" on public.whatsapp_conversations
      for select to authenticated using (tenant_id = public.get_user_tenant_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_conversations' and policyname = 'tenant update whatsapp conversations') then
    create policy "tenant update whatsapp conversations" on public.whatsapp_conversations
      for update to authenticated using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id());
  end if;

  drop policy if exists "tenant read whatsapp webhook events" on public.whatsapp_webhook_events;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_webhook_events' and policyname = 'admin read whatsapp webhook events') then
    create policy "admin read whatsapp webhook events" on public.whatsapp_webhook_events
      for select to authenticated using (
        tenant_id = public.get_user_tenant_id()
        and exists (
          select 1 from public.profiles p
          where p.user_id = auth.uid()
            and p.tenant_id = public.whatsapp_webhook_events.tenant_id
            and p.role in ('owner','admin','super_admin')
        )
      );
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_templates' and policyname = 'tenant read whatsapp templates') then
    create policy "tenant read whatsapp templates" on public.whatsapp_templates
      for select to authenticated using (tenant_id = public.get_user_tenant_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'whatsapp_templates' and policyname = 'tenant manage whatsapp templates') then
    create policy "tenant manage whatsapp templates" on public.whatsapp_templates
      for all to authenticated using (tenant_id = public.get_user_tenant_id()) with check (tenant_id = public.get_user_tenant_id());
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_attachments' and policyname = 'tenant read message attachments') then
    create policy "tenant read message attachments" on public.message_attachments
      for select to authenticated using (tenant_id = public.get_user_tenant_id());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'message_attachments' and policyname = 'tenant insert message attachments') then
    create policy "tenant insert message attachments" on public.message_attachments
      for insert to authenticated with check (tenant_id = public.get_user_tenant_id());
  end if;
end $$;

do $$
begin
  begin alter publication supabase_realtime add table public.message_logs; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.whatsapp_conversations; exception when duplicate_object then null; when undefined_object then null; end;
  begin alter publication supabase_realtime add table public.whatsapp_templates; exception when duplicate_object then null; when undefined_object then null; end;
end $$;
