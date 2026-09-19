-- Runtime validation for the paginated operational read layer.
-- Safe for Development: every fixture and session mutation is rolled back.

begin;

do $$
declare
  v_tenant_id uuid;
  v_user_id constant uuid := '00000000-0000-4000-8000-000000000999';
  v_customer_id constant uuid := '00000000-0000-4000-8000-000000000997';
  v_vehicle_id constant uuid := '00000000-0000-4000-8000-000000000996';
  v_order_id constant uuid := '00000000-0000-4000-8000-000000000995';
  v_claim_id constant uuid := '00000000-0000-4000-8000-000000000994';
  v_payload jsonb;
  v_count integer;
begin
  select id into v_tenant_id from public.tenants order by created_at, id limit 1;
  if v_tenant_id is null then
    raise exception 'RUNTIME_VALIDATION_REQUIRES_EXISTING_DEVELOPMENT_TENANT';
  end if;

  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    created_at, updated_at
  ) values (
    v_user_id, '00000000-0000-0000-0000-000000000000',
    'authenticated', 'authenticated', 'runtime-validation@example.invalid', '',
    now(), '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object(
      'tenant_id', v_tenant_id,
      'full_name', 'Runtime Validation',
      'role', 'admin',
      'company_name', 'Existing Development Tenant'
    ),
    now(), now()
  );

  if not exists (
    select 1 from public.profiles
    where user_id = v_user_id and tenant_id = v_tenant_id and role = 'admin'
  ) then
    raise exception 'AUTH_PROFILE_TRIGGER_FAILED';
  end if;

  insert into public.customers (id, tenant_id, name, phone)
  values (v_customer_id, v_tenant_id, 'Runtime Fixture Customer', '99990001');

  insert into public.vehicles (
    id, tenant_id, customer_id, plate_number, plate_letters,
    plate_country, brand, model, year
  ) values (
    v_vehicle_id, v_tenant_id, v_customer_id, '9999', 'RT',
    'OM', 'Runtime', 'Fixture', 2026
  );

  insert into public.job_orders (
    id, tenant_id, vehicle_id, customer_id, order_number, status,
    service_type, entry_date, technician_name, work_order_type
  ) values (
    v_order_id, v_tenant_id, v_vehicle_id, v_customer_id,
    'WO-RUNTIME-9999', 'received', 'Runtime Service', current_date,
    'Runtime Technician', 'general_customer'
  );

  insert into public.insurance_claims (
    id, tenant_id, job_order_id, customer_id, vehicle_id,
    claim_number, insurance_company, status
  ) values (
    v_claim_id, v_tenant_id, v_order_id, v_customer_id, v_vehicle_id,
    'RUNTIME-CLAIM-9999', 'Runtime Insurance', 'pending'
  );

  update public.job_orders
     set claim_id = v_claim_id,
         insurance_claim_number = 'RUNTIME-CLAIM-9999',
         insurance_company = 'Runtime Insurance'
   where id = v_order_id;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);
  perform set_config('request.jwt.claim.role', 'authenticated', true);
  set local role authenticated;

  v_payload := public.work_orders_list_rpc(v_tenant_id, 1, 20, '9999', '{}'::jsonb);
  v_count := jsonb_array_length(coalesce(v_payload->'rows', '[]'::jsonb));
  if v_count <> 1 then raise exception 'WORK_ORDER_LIST_FAILED: %', v_payload; end if;

  v_payload := public.customers_list_rpc(v_tenant_id, 1, 25, 'Runtime Fixture', 'all', 'all');
  v_count := jsonb_array_length(coalesce(v_payload->'rows', '[]'::jsonb));
  if v_count <> 1 then raise exception 'CUSTOMER_LIST_FAILED: %', v_payload; end if;

  v_payload := public.insurance_claims_list_rpc(
    v_tenant_id, 1, 20, 'RUNTIME-CLAIM', 'all', 'all', null,
    'all', 'all', 'created_at', 'desc'
  );
  v_count := jsonb_array_length(coalesce(v_payload->'rows', '[]'::jsonb));
  if v_count <> 1 then raise exception 'CLAIM_LIST_FAILED: %', v_payload; end if;

  v_payload := public.dashboard_operational_summary_rpc(v_tenant_id, 'all', 'all', 'all');
  if jsonb_typeof(v_payload) <> 'object'
     or jsonb_array_length(coalesce(v_payload->'recentOrders', '[]'::jsonb)) < 1 then
    raise exception 'DASHBOARD_SUMMARY_FAILED: %', v_payload;
  end if;

  v_payload := public.dashboard_global_search_rpc(v_tenant_id, '9999', 20);
  if jsonb_typeof(v_payload) <> 'array' or jsonb_array_length(v_payload) < 1 then
    raise exception 'DASHBOARD_SEARCH_FAILED: %', v_payload;
  end if;

  v_payload := public.work_orders_list_rpc(
    '00000000-0000-4000-8000-000000000001', 1, 20, '', '{}'::jsonb
  );
  if jsonb_array_length(coalesce(v_payload->'rows', '[]'::jsonb)) <> 0 then
    raise exception 'WRONG_TENANT_LEAK: %', v_payload;
  end if;

  if has_function_privilege('anon', 'public.work_orders_list_rpc(uuid,integer,integer,text,jsonb)', 'EXECUTE')
     or has_function_privilege('anon', 'public.customers_list_rpc(uuid,integer,integer,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.insurance_claims_list_rpc(uuid,integer,integer,text,text,text,uuid,text,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.dashboard_operational_summary_rpc(uuid,text,text,text)', 'EXECUTE')
     or has_function_privilege('anon', 'public.dashboard_global_search_rpc(uuid,text,integer)', 'EXECUTE') then
    raise exception 'ANON_EXECUTE_MUST_BE_REVOKED';
  end if;

  if not has_function_privilege('authenticated', 'public.work_orders_list_rpc(uuid,integer,integer,text,jsonb)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.customers_list_rpc(uuid,integer,integer,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.insurance_claims_list_rpc(uuid,integer,integer,text,text,text,uuid,text,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.dashboard_operational_summary_rpc(uuid,text,text,text)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.dashboard_global_search_rpc(uuid,text,integer)', 'EXECUTE') then
    raise exception 'AUTHENTICATED_EXECUTE_GRANT_MISSING';
  end if;
end;
$$;

select jsonb_build_object(
  'result', 'PASS',
  'scope', 'development transaction only',
  'validated', jsonb_build_array(
    'work_orders_list_rpc',
    'customers_list_rpc',
    'insurance_claims_list_rpc',
    'dashboard_operational_summary_rpc',
    'dashboard_global_search_rpc',
    'wrong_tenant_isolation',
    'rpc_execute_privileges'
  )
) as runtime_validation;

rollback;
