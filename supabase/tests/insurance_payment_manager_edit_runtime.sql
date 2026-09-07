begin;

do $$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    insert into public.tenants(id,name) values('72000000-0000-0000-0000-000000000001','Runtime Test') returning id into v_tenant;
  end if;
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('72000000-0000-0000-0000-000000000002','authenticated','authenticated','insurance-payment-edit@example.invalid','',now(),'{}','{}',now(),now())
  on conflict(id) do nothing;
  insert into public.profiles(user_id,tenant_id,full_name,role)
  values('72000000-0000-0000-0000-000000000002',v_tenant,'Runtime Manager','manager')
  on conflict(user_id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('72000000-0000-0000-0000-000000000007','authenticated','authenticated','insurance-payment-non-manager@example.invalid','',now(),'{}','{}',now(),now())
  on conflict(id) do nothing;
  insert into public.profiles(user_id,tenant_id,full_name,role)
  values('72000000-0000-0000-0000-000000000007',v_tenant,'Runtime Insurance User','insurance')
  on conflict(user_id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
  insert into public.customers(id,tenant_id,name)
  values('72000000-0000-0000-0000-000000000003',v_tenant,'Runtime Customer');
  insert into public.insurance_claims(id,tenant_id,customer_id,claim_number,insurance_company,estimated_amount,status)
  values('72000000-0000-0000-0000-000000000004',v_tenant,'72000000-0000-0000-0000-000000000003','RUNTIME-EDIT-CLAIM','Runtime Insurance',100,'pending');
  insert into public.insurance_invoices(id,tenant_id,invoice_number,claim_id,insurance_company_name,subtotal,vat,total,status)
  values('72000000-0000-0000-0000-000000000005',v_tenant,'RUNTIME-EDIT-INVOICE','72000000-0000-0000-0000-000000000004','Runtime Insurance',95.238,4.762,100,'issued');
end;
$$;

select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;

do $$
declare
  v_created public.claim_payments%rowtype;
  v_updated public.claim_payments%rowtype;
begin
  v_created := public.create_insurance_payment_with_settlement(
    '72000000-0000-0000-0000-000000000004',90,'bank_transfer',current_date,
    '72000000-0000-0000-0000-000000000005',null,'BEFORE',null,null,
    'cleared','Before correction',10,'Initial settlement','72000000-0000-0000-0000-000000000006');

  v_updated := public.update_insurance_payment_by_manager(
    v_created.id,v_created.updated_at,v_created.edit_version,95,'bank_transfer',current_date,'AFTER',null,null,
    'cleared','After correction',5,'Corrected settlement','Manager corrected received amount');

  if v_updated.amount <> 95 or v_updated.settlement_discount_amount <> 5 then
    raise exception 'PAYMENT_CORRECTION_FAILED';
  end if;
  if not exists (
    select 1 from public.insurance_invoices
    where id='72000000-0000-0000-0000-000000000005'
      and status='paid' and paid_amount=95 and settlement_discount_amount=5
  ) then raise exception 'INVOICE_RECALC_FAILED'; end if;
  if not exists (
    select 1 from public.claim_audit_logs
    where claim_id='72000000-0000-0000-0000-000000000004'
      and action='insurance_payment_corrected'
      and details->>'reason'='Manager corrected received amount'
      and details->'before'->>'amount'='90.000'
      and details->'after'->>'amount'='95.000'
  ) then raise exception 'PAYMENT_CORRECTION_AUDIT_MISSING'; end if;

  begin
    perform public.update_insurance_payment_by_manager(
      v_created.id,v_created.updated_at,v_created.edit_version,94,'bank_transfer',current_date,'STALE',null,null,
      'cleared',null,6,'Stale settlement','Stale edit');
    raise exception 'STALE_EDIT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%PAYMENT_CHANGED_BY_ANOTHER_USER%' then raise; end if;
  end;
end;
$$;

select set_config('request.jwt.claims','{"sub":"72000000-0000-0000-0000-000000000007","role":"authenticated"}',true);

do $$
declare v_payment public.claim_payments%rowtype;
begin
  select * into v_payment from public.claim_payments where id='72000000-0000-0000-0000-000000000006';
  begin
    perform public.update_insurance_payment_by_manager(
      v_payment.id,v_payment.updated_at,v_payment.edit_version,93,'bank_transfer',current_date,'DENIED',null,null,
      'cleared',null,7,'Denied settlement','Non-manager attempt');
    raise exception 'NON_MANAGER_EDIT_WAS_ACCEPTED';
  exception when others then
    if sqlerrm not like '%PAYMENT_EDIT_MANAGER_REQUIRED%' then raise; end if;
  end;
end;
$$;

rollback;
