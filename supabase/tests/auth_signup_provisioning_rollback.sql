-- Development-only rollback proof, never a migration. Candidate application
-- and corrected-state trials are owned by Main, not this sidecar.
-- Run via a connection with a HARD Development-ref assertion (rrhyglrnlveygyiandhs).
-- In that same connection first SET security_audit.signup_expected = 'vulnerable'
-- before the candidate, or 'fixed' after it. This acknowledgement is NOT server
-- identity. Use try/finally connection.rollback(), including on assertion failure.
-- Direct SQL fixtures have no addresses/passwords/identities or Auth API calls:
-- no messages are sent, no sessions issued, no sequence/counter is consumed.
begin;
set local statement_timeout = '10s';
set local request.jwt.claims = '{}';
set local request.jwt.claim.sub = '';

do $proof$
declare
  v_mode text := pg_catalog.current_setting('security_audit.signup_expected', true);
  v_target uuid := pg_catalog.gen_random_uuid();
  v_uncreated uuid := pg_catalog.gen_random_uuid();
  v_user uuid := pg_catalog.gen_random_uuid();
  v_deferred uuid := pg_catalog.gen_random_uuid();
  v_profile public.profiles%rowtype;
  v_tenant_count bigint;
  v_payload jsonb;
begin
  if v_mode is null or v_mode not in ('vulnerable', 'fixed') then
    raise exception 'EXPLICIT_SIGNUP_PROOF_MODE_REQUIRED';
  end if;
  if v_mode = 'vulnerable' and pg_catalog.md5(pg_catalog.pg_get_functiondef('public.handle_new_user()'::regprocedure))
     <> '01fbc7293f1c21dc236c112ef10190c7' then
    raise exception 'VULNERABLE_TRIGGER_SOURCE_DRIFT';
  end if;
  if v_mode = 'fixed' and pg_catalog.strpos(pg_catalog.pg_get_functiondef('public.handle_new_user()'::regprocedure), 'profile_provisioning') = 0 then
    raise exception 'CORRECTED_TRIGGER_REQUIRED';
  end if;
  if auth.uid() is not null then raise exception 'UID_LESS_ADMIN_FIXTURE_REQUIRED'; end if;
  insert into public.tenants (id, name) values (v_target, 'Synthetic signup isolation fixture');

  -- This is exactly the privileged state public signup metadata can request.
  insert into auth.users (id, aud, role, raw_app_meta_data, raw_user_meta_data)
  values (v_user, 'authenticated', 'authenticated', '{}'::jsonb,
    pg_catalog.jsonb_build_object('tenant_id', v_target, 'role', 'admin', 'is_platform_admin', true));
  select * into strict v_profile from public.profiles where user_id = v_user;
  if v_mode = 'vulnerable' then
    if v_profile.tenant_id <> v_target or v_profile.role <> 'admin'::public.app_role then
      raise exception 'ORIGINAL_EXPLOIT_NOT_REPRODUCED';
    end if;
  else
    if v_profile.tenant_id = v_target or v_profile.role <> 'admin'::public.app_role or v_profile.is_platform_admin then
      raise exception 'SIGNUP_ISOLATION_FAILED';
    end if;
    if not exists (select 1 from public.user_roles where user_id = v_user
      and tenant_id = v_profile.tenant_id and role = 'admin'::public.app_role) then
      raise exception 'ISOLATED_OWNER_ROLE_BINDING_FAILED';
    end if;
    perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object('sub', v_user, 'role', 'authenticated')::text, true);
    if public.get_user_tenant_id() is distinct from v_profile.tenant_id
      or public.get_user_role() is distinct from 'admin'::public.app_role then
      raise exception 'SIGNUP_AUTHORITY_LOOKUP_FAILED';
    end if;
    perform pg_catalog.set_config('request.jwt.claims', '{}', true);

    -- Invalid authorization metadata is ignored, not cast or accepted. Even a
    -- made-up tenant ID must neither be created nor used as the fresh tenant ID.
    for v_payload in select value from pg_catalog.jsonb_array_elements(
      pg_catalog.jsonb_build_array(
        '{}'::jsonb,
        '{"tenant_id":"not-a-uuid","role":"not-a-role"}'::jsonb,
        pg_catalog.jsonb_build_object('tenant_id', v_uncreated, 'role', 'customer'),
        '{"tenant_id":null,"role":null,"is_platform_admin":true}'::jsonb
      )
    ) loop
      v_user := pg_catalog.gen_random_uuid();
      insert into auth.users (id, raw_user_meta_data, raw_app_meta_data)
      values (v_user, v_payload, '{}'::jsonb);
      select * into strict v_profile from public.profiles where user_id = v_user;
      if v_profile.tenant_id in (v_target, v_uncreated) or v_profile.role <> 'admin'::public.app_role
        or v_profile.is_platform_admin then raise exception 'SIGNUP_ISOLATION_FAILED'; end if;
    end loop;
    if exists (select 1 from public.tenants where id = v_uncreated) then
      raise exception 'CALLER_SELECTED_TENANT_CREATED';
    end if;

    -- Both managed creation and data-only invitations defer. Spoofing the
    -- marker publicly has the same no-profile/no-role, privilege-reducing result.
    select count(*) into v_tenant_count from public.tenants;
    insert into auth.users (id, raw_user_meta_data, raw_app_meta_data)
    values (v_deferred, pg_catalog.jsonb_build_object(
      'profile_provisioning', 'manage-users', 'tenant_id', v_target, 'role', 'admin'), '{}'::jsonb);
    if exists (select 1 from public.profiles where user_id = v_deferred)
      or exists (select 1 from public.user_roles where user_id = v_deferred)
      or (select count(*) from public.tenants) <> v_tenant_count then
      raise exception 'MANAGED_DEFERRAL_FAILED';
    end if;
    perform pg_catalog.set_config('request.jwt.claims', pg_catalog.jsonb_build_object(
      'sub', v_deferred, 'role', 'authenticated', 'user_metadata', pg_catalog.jsonb_build_object('tenant_id', v_target, 'role', 'admin'))::text, true);
    if public.get_user_tenant_id() is not null or public.get_user_role() is not null then
      raise exception 'DEFERRED_METADATA_GRANTED_AUTHORITY';
    end if;
    perform pg_catalog.set_config('request.jwt.claims', '{}', true);
    -- Auth may set these AFTER INSERT. Neither an update nor user-editable
    -- metadata can provision a deferred account through this insert-only hook.
    update auth.users set invited_at = pg_catalog.now(),
      raw_app_meta_data = pg_catalog.jsonb_build_object('tenant_id', v_target, 'role', 'admin'),
      raw_user_meta_data = '{"role":"admin"}'::jsonb
    where id = v_deferred;
    if exists (select 1 from public.profiles where user_id = v_deferred)
      or exists (select 1 from public.user_roles where user_id = v_deferred) then
      raise exception 'DEFERRED_ACCOUNT_UPDATE_GRANTED_ACCESS';
    end if;

    -- Model ONLY the already-authorized service write, not Edge/Auth/email E2E.
    insert into public.profiles (user_id, tenant_id, full_name, role, account_status)
    values (v_deferred, v_target, 'Synthetic managed fixture', 'technician', 'invited');
    if not exists (select 1 from public.user_roles where user_id = v_deferred
      and tenant_id = v_target and role = 'technician'::public.app_role)
      or (select count(*) from public.user_roles where user_id = v_deferred) <> 1 then
      raise exception 'MANAGED_PROFILE_ROLE_BINDING_FAILED';
    end if;
  end if;
  raise notice 'signup proof mode=% passed; rollback is mandatory', v_mode;
end;
$proof$;
rollback;

