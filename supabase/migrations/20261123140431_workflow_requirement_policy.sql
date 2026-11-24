-- Operational workflow requirements. Identity, tenancy, immutable signatures and
-- one-time receipt integrity are deliberately outside this policy.
begin;

create table public.workflow_requirement_settings (
  tenant_id uuid primary key references public.tenants(id),
  requirements_enabled boolean not null default true,
  revision bigint not null default 0 check (revision >= 0),
  reason text not null default '' check (char_length(reason) <= 1000),
  updated_by uuid,
  updated_by_name text,
  updated_at timestamptz not null default clock_timestamp(),
  check (requirements_enabled or (char_length(btrim(reason))>0 and revision>0 and updated_by is not null))
);

create table public.workflow_requirement_audit (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  entity_type text not null check (char_length(entity_type) between 1 and 80),
  entity_id uuid not null,
  action text not null check (char_length(action) between 1 and 120),
  actor_id uuid not null,
  actor_name text not null,
  policy_revision bigint not null check (policy_revision >= 0),
  reason text not null check (char_length(btrim(reason)) between 1 and 1000),
  requirements_enabled boolean not null,
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);
create index workflow_requirement_audit_tenant_created_idx
  on public.workflow_requirement_audit(tenant_id, created_at desc);
create index workflow_requirement_audit_entity_idx
  on public.workflow_requirement_audit(tenant_id, entity_type, entity_id);

alter table public.workflow_requirement_settings enable row level security;
alter table public.workflow_requirement_audit enable row level security;
revoke all on public.workflow_requirement_settings from public, anon, authenticated, service_role;
revoke all on public.workflow_requirement_audit from public, anon, authenticated, service_role;
grant select on public.workflow_requirement_settings to authenticated;
grant select on public.workflow_requirement_audit to authenticated;

create policy workflow_requirement_settings_staff_read
on public.workflow_requirement_settings for select to authenticated
using (tenant_id = (select public.get_user_tenant_id()) and exists (
  select 1 from public.profiles p where p.user_id = (select auth.uid())
  and p.tenant_id = workflow_requirement_settings.tenant_id
  and p.account_status = 'active' and p.disabled_at is null
  and p.role::text in ('admin','manager','supervisor','technician','insurance','accountant')
));
create policy workflow_requirement_audit_admin_read
on public.workflow_requirement_audit for select to authenticated
using (tenant_id = (select public.get_user_tenant_id()) and exists (
  select 1 from public.profiles p where p.user_id = (select auth.uid())
  and p.tenant_id = workflow_requirement_audit.tenant_id
  and p.account_status = 'active' and p.disabled_at is null and p.role::text = 'admin'
));

create or replace function app_private.workflow_requirement_actor(p_admin_only boolean default false)
returns public.profiles language plpgsql security definer set search_path = '' as $$
declare actor public.profiles;
begin
  select * into actor from public.profiles p where p.user_id = auth.uid()
    and p.tenant_id = public.get_user_tenant_id()
    and p.account_status = 'active' and p.disabled_at is null
    and p.role::text in ('admin','manager','supervisor','technician','insurance','accountant');
  if not found then raise exception 'WORKFLOW_POLICY_FORBIDDEN' using errcode='42501'; end if;
  if p_admin_only and actor.role::text <> 'admin' then
    raise exception 'WORKFLOW_POLICY_ADMIN_REQUIRED' using errcode='42501';
  end if;
  return actor;
end $$;
revoke all on function app_private.workflow_requirement_actor(boolean) from public, anon, authenticated, service_role;

-- This is volatile because a shared row lock preserves the policy revision
-- until the caller's transaction (including its override audit) finishes.
create or replace function app_private.workflow_requirements_enforced(p_tenant_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare enabled boolean;
begin
  if p_tenant_id is null or auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or not exists (select 1 from public.profiles p where p.user_id=auth.uid()
      and p.tenant_id=p_tenant_id and p.account_status='active' and p.disabled_at is null
      and p.role::text in ('admin','manager','supervisor','technician','insurance','accountant')) then
    return true;
  end if;
  select s.requirements_enabled into enabled from public.workflow_requirement_settings s
    where s.tenant_id=p_tenant_id for share;
  return coalesce(enabled,true);
end $$;
revoke all on function app_private.workflow_requirements_enforced(uuid) from public, anon, authenticated, service_role;

create or replace function public.get_workflow_requirement_policy()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; policy public.workflow_requirement_settings;
begin
  actor := app_private.workflow_requirement_actor(false);
  select * into policy from public.workflow_requirement_settings s where s.tenant_id=actor.tenant_id;
  if not found then
    return jsonb_build_object('tenant_id',actor.tenant_id,'requirements_enabled',true,
      'revision',0,'reason','','updated_by',null,'updated_by_name',null,'updated_at',null);
  end if;
  return to_jsonb(policy);
end $$;
revoke all on function public.get_workflow_requirement_policy() from public, anon, authenticated, service_role;
grant execute on function public.get_workflow_requirement_policy() to authenticated;

create or replace function public.set_workflow_requirement_policy(
  p_requirements_enabled boolean, p_reason text, p_expected_revision bigint, p_tenant_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; policy public.workflow_requirement_settings;
  previous_enabled boolean; previous_revision bigint; clean_reason text:=btrim(coalesce(p_reason,''));
begin
  actor := app_private.workflow_requirement_actor(true);
  if p_tenant_id is not null and p_tenant_id is distinct from actor.tenant_id then
    raise exception 'WORKFLOW_POLICY_SCOPE_CHANGED' using errcode='42501';
  end if;
  if p_requirements_enabled is null or p_expected_revision is null or p_expected_revision<0 then
    raise exception 'WORKFLOW_POLICY_INVALID';
  end if;
  if char_length(clean_reason) not between 1 and 1000 then raise exception 'WORKFLOW_POLICY_REASON_REQUIRED'; end if;
  insert into public.workflow_requirement_settings(tenant_id) values(actor.tenant_id) on conflict(tenant_id) do nothing;
  select * into policy from public.workflow_requirement_settings s where s.tenant_id=actor.tenant_id for update;
  if policy.revision<>p_expected_revision then raise exception 'WORKFLOW_POLICY_CHANGED'; end if;
  if policy.requirements_enabled=p_requirements_enabled then return to_jsonb(policy); end if;
  previous_enabled:=policy.requirements_enabled; previous_revision:=policy.revision;
  update public.workflow_requirement_settings set requirements_enabled=p_requirements_enabled,
    revision=revision+1,reason=clean_reason,updated_by=actor.user_id,
    updated_by_name=coalesce(nullif(actor.full_name,''),actor.user_id::text),updated_at=clock_timestamp()
  where tenant_id=actor.tenant_id returning * into policy;
  insert into public.workflow_requirement_audit(tenant_id,entity_type,entity_id,action,actor_id,actor_name,
    policy_revision,reason,requirements_enabled,details)
  values(actor.tenant_id,'workflow_policy',actor.tenant_id,
    case when policy.requirements_enabled then 'requirements_enabled' else 'requirements_disabled' end,
    actor.user_id,coalesce(nullif(actor.full_name,''),actor.user_id::text),policy.revision,
    policy.reason,policy.requirements_enabled,jsonb_build_object('previous_requirements_enabled',previous_enabled,
      'previous_revision',previous_revision));
  return to_jsonb(policy);
end $$;
revoke all on function public.set_workflow_requirement_policy(boolean,text,bigint,uuid) from public, anon, authenticated, service_role;
grant execute on function public.set_workflow_requirement_policy(boolean,text,bigint,uuid) to authenticated;

create or replace function app_private.record_workflow_requirement_override(
  p_tenant_id uuid, p_entity_type text, p_entity_id uuid, p_action text, p_details jsonb default '{}'::jsonb
) returns uuid language plpgsql security definer set search_path = '' as $$
declare actor public.profiles; policy public.workflow_requirement_settings; event_id uuid;
begin
  if app_private.workflow_requirements_enforced(p_tenant_id) then return null; end if;
  actor := app_private.workflow_requirement_actor(false);
  select * into policy from public.workflow_requirement_settings where tenant_id=actor.tenant_id for share;
  if not found or policy.requirements_enabled then return null; end if;
  if p_entity_id is null or char_length(btrim(coalesce(p_entity_type,''))) not between 1 and 80
    or char_length(btrim(coalesce(p_action,''))) not between 1 and 120
    or jsonb_typeof(coalesce(p_details,'{}'::jsonb))<>'object' then
    raise exception 'WORKFLOW_OVERRIDE_INVALID';
  end if;
  insert into public.workflow_requirement_audit(tenant_id,entity_type,entity_id,action,actor_id,actor_name,
    policy_revision,reason,requirements_enabled,details)
  values(actor.tenant_id,btrim(p_entity_type),p_entity_id,btrim(p_action),actor.user_id,
    coalesce(nullif(actor.full_name,''),actor.user_id::text),policy.revision,policy.reason,false,
    coalesce(p_details,'{}'::jsonb)) returning id into event_id;
  return event_id;
end $$;
revoke all on function app_private.record_workflow_requirement_override(uuid,text,uuid,text,jsonb) from public, anon, authenticated, service_role;

create or replace function app_private.prevent_workflow_requirement_audit_change()
returns trigger language plpgsql set search_path = '' as $$
begin raise exception 'WORKFLOW_AUDIT_IMMUTABLE'; end $$;
revoke all on function app_private.prevent_workflow_requirement_audit_change() from public, anon, authenticated, service_role;
create trigger workflow_requirement_audit_immutable before update or delete
on public.workflow_requirement_audit for each row execute function app_private.prevent_workflow_requirement_audit_change();

do $$ begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    alter publication supabase_realtime add table public.workflow_requirement_settings;
  end if;
end $$;
commit;
