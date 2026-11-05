-- Development-only synthetic authorization identities. No provider calls.
-- The private runner verifies the actual Development connection and rolls back.
begin;
set local statement_timeout='25s';
set local lock_timeout='2s';
do $fixtures$
declare home uuid:=gen_random_uuid(); other uuid:=gen_random_uuid();
  actor uuid; role_name text; label text; cases jsonb:='[]';
begin
  if current_setting('security_audit.approved_project_ref',true) is distinct from 'rrhyglrnlveygyiandhs' then
    raise exception 'DEVELOPMENT_ACK_REQUIRED';end if;
  perform set_config('request.jwt.claims','{"role":"service_role"}',true);
  perform set_config('request.jwt.claim.sub','',true);
  insert into public.tenants(id,name) values(home,'SYNTHETIC IDENTITY GATE'),(other,'SYNTHETIC FOREIGN TENANT');
  insert into public.customers(tenant_id,name) values(home,'SYNTHETIC PRIVATE CUSTOMER');
  insert into public.accounting_role_permissions(tenant_id,role,permission_key,granted)
    values(home,'manager','accounting.admin',true);
  foreach role_name in array array['admin','manager','insurance','supervisor','accountant','technician','customer'] loop
    actor:=gen_random_uuid();
    insert into auth.users(id,raw_user_meta_data) values(actor,'{"profile_provisioning":"manage-users"}');
    insert into public.profiles(user_id,tenant_id,full_name,role)
      values(actor,home,'SYNTHETIC ACTIVE IDENTITY',role_name::public.app_role);
    cases:=cases||jsonb_build_object('uid',actor,'role',role_name,'label','active','active',true);
  end loop;
  foreach label in array array['disabled','invited','disabled_timestamp','orphan_role'] loop
    actor:=gen_random_uuid();
    insert into auth.users(id,raw_user_meta_data) values(actor,'{"profile_provisioning":"manage-users"}');
    if label='orphan_role' then
      insert into public.user_roles(user_id,tenant_id,role) values(actor,home,'manager');
    else
      insert into public.profiles(user_id,tenant_id,full_name,role,account_status,disabled_at,is_platform_admin)
        values(actor,home,'SYNTHETIC INACTIVE IDENTITY','manager',
          case when label='disabled' then 'disabled' when label='invited' then 'invited' else 'active' end,
          case when label in ('disabled','disabled_timestamp') then now() else null end,true);
    end if;
    cases:=cases||jsonb_build_object('uid',actor,'role','manager','label',label,'active',false);
  end loop;
  perform set_config('security_audit.identity_cases',cases::text,true);
  perform set_config('security_audit.identity_tenant',home::text,true);
  perform set_config('security_audit.identity_foreign',other::text,true);
end $fixtures$;

do $matrix$
declare item jsonb; expected text:=current_setting('security_audit.identity_expected');
  home uuid:=current_setting('security_audit.identity_tenant')::uuid;
  actual_role public.app_role; actual_tenant uuid; expense_allowed boolean; accounting_allowed boolean;
  role_allowed boolean; platform_allowed boolean; private_rows integer; active_checks integer:=0; inactive_checks integer:=0;
  denied boolean;
begin
  if expected not in ('vulnerable','fixed') then raise exception 'IDENTITY_EXPECTATION_REQUIRED';end if;
  for item in select value from jsonb_array_elements(current_setting('security_audit.identity_cases')::jsonb) loop
    perform set_config('request.jwt.claims',jsonb_build_object('sub',item->>'uid','role','authenticated')::text,true);
    perform set_config('request.jwt.claim.sub',item->>'uid',true);
    execute 'set local role authenticated';
    select public.get_user_role(),public.get_user_tenant_id(),
      public.expense_has_permission('expenses.view'),public.accounting_has_permission('accounting.view_journal'),
      public.has_role((item->>'uid')::uuid,(item->>'role')::public.app_role),public.is_platform_admin()
      into actual_role,actual_tenant,expense_allowed,accounting_allowed,role_allowed,platform_allowed;
    select count(*) into private_rows from public.customers where tenant_id=home;
    if (item->>'active')::boolean then
      if actual_role::text is distinct from item->>'role' or actual_tenant is distinct from home or not role_allowed then
        raise exception 'ACTIVE_IDENTITY_BEHAVIOR_CHANGED: %',item->>'role';end if;
      active_checks:=active_checks+1;
      denied:=false;
      begin
        perform public.reports_center_secure_summary_rpc(current_setting('security_audit.identity_foreign')::uuid,null,null,'insurance');
      exception when insufficient_privilege then denied:=true;end;
      if not denied then raise exception 'WRONG_TENANT_REPORT_ALLOWED';end if;
    elsif expected='fixed' then
      if actual_role is not null or actual_tenant is not null or expense_allowed or accounting_allowed
        or role_allowed or platform_allowed or private_rows<>0 then
        raise exception 'INACTIVE_IDENTITY_STILL_AUTHORIZED: %',item->>'label';end if;
      inactive_checks:=inactive_checks+1;
    else
      if actual_role::text is distinct from 'manager' or actual_tenant is distinct from home
        or not expense_allowed or not accounting_allowed or not role_allowed or private_rows=0 then
        raise exception 'BASELINE_VULNERABILITY_NOT_REPRODUCED: %',item->>'label';end if;
      inactive_checks:=inactive_checks+1;
    end if;
    execute 'set local role postgres';
  end loop;
  perform set_config('request.jwt.claims','{"role":"authenticated"}',true);
  perform set_config('request.jwt.claim.sub','',true);
  execute 'set local role authenticated';
  if public.get_user_role() is not null or public.get_user_tenant_id() is not null then
    raise exception 'UNATTACHED_SESSION_AUTHORIZED';end if;
  execute 'set local role postgres';
  perform set_config('security_audit.identity_result',jsonb_build_object('status','PASS','expected',expected,
    'active_roles_unchanged',active_checks,'inactive_or_orphan_cases',inactive_checks,'wrong_tenant_denials',active_checks,
    'unattached_denied',true,'production','NOT_APPLIED')::text,true);
end $matrix$;
reset role;
select current_setting('security_audit.identity_result')::jsonb as verification;
rollback;
