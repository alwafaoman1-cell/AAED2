alter table public.security_action_otps
  add column if not exists attempt_count integer not null default 0,
  add column if not exists locked_until timestamptz,
  add column if not exists last_attempt_at timestamptz;

create table if not exists public.security_otp_audit_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  user_id uuid,
  action text not null,
  event text not null,
  status text not null,
  ip text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_security_otp_audit_log_tenant_created
  on public.security_otp_audit_log (tenant_id, created_at desc);

alter table public.security_otp_audit_log enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public'
      and tablename = 'security_otp_audit_log'
      and policyname = 'owner admin read security otp audit'
  ) then
    create policy "owner admin read security otp audit"
    on public.security_otp_audit_log
    for select
    using (
      tenant_id = public.get_user_tenant_id()
      and exists (
        select 1
        from public.profiles p
        where p.user_id = auth.uid()
          and p.tenant_id = security_otp_audit_log.tenant_id
          and p.role::text in ('admin', 'owner')
      )
    );
  end if;
end $$;
