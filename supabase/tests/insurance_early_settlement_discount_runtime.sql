begin;

do $$
declare v_tenant uuid;
begin
  select id into v_tenant from public.tenants order by created_at limit 1;
  if v_tenant is null then
    insert into public.tenants(id,name) values('71000000-0000-0000-0000-000000000001','Runtime Test') returning id into v_tenant;
  end if;
  insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
  values('71000000-0000-0000-0000-000000000002','authenticated','authenticated','insurance-settlement-runtime@example.invalid','',now(),'{}','{}',now(),now())
  on conflict(id) do nothing;
  insert into public.profiles(user_id,tenant_id,full_name,role)
  values('71000000-0000-0000-0000-000000000002',v_tenant,'Runtime Manager','manager')
  on conflict(user_id) do update set tenant_id=excluded.tenant_id,role=excluded.role;
  insert into public.customers(id,tenant_id,name)
  values('71000000-0000-0000-0000-000000000003',v_tenant,'Runtime Customer');
  insert into public.insurance_claims(id,tenant_id,customer_id,claim_number,insurance_company,estimated_amount,status)
  values('71000000-0000-0000-0000-000000000004',v_tenant,'71000000-0000-0000-0000-000000000003','RUNTIME-CLAIM','Runtime Insurance',100,'pending');
  insert into public.insurance_invoices(id,tenant_id,invoice_number,claim_id,insurance_company_name,subtotal,vat,total,status)
  values('71000000-0000-0000-0000-000000000005',v_tenant,'RUNTIME-INVOICE','71000000-0000-0000-0000-000000000004','Runtime Insurance',95.238,4.762,100,'issued');
end;
$$;

select set_config('request.jwt.claims','{"sub":"71000000-0000-0000-0000-000000000002","role":"authenticated"}',true);
set local role authenticated;

do $$
declare v_payment public.claim_payments%rowtype; v_repeat public.claim_payments%rowtype;
begin
  v_payment := public.create_insurance_payment_with_settlement(
    '71000000-0000-0000-0000-000000000004',95,'bank_transfer',current_date,
    '71000000-0000-0000-0000-000000000005',null,'RUNTIME-ROLLBACK',null,null,
    'cleared','Runtime rollback test',5,'Early-payment test','71000000-0000-0000-0000-000000000006');
  v_repeat := public.create_insurance_payment_with_settlement(
    '71000000-0000-0000-0000-000000000004',95,'bank_transfer',current_date,
    '71000000-0000-0000-0000-000000000005',null,'RUNTIME-ROLLBACK',null,null,
    'cleared','Runtime rollback test',5,'Early-payment test','71000000-0000-0000-0000-000000000006');
  if v_payment.id <> v_repeat.id then raise exception 'IDEMPOTENCY_FAILED'; end if;
  if (select count(*) from public.claim_payments where id=v_payment.id) <> 1 then raise exception 'DUPLICATE_PAYMENT_CREATED'; end if;
  if not exists(select 1 from public.insurance_invoices where id='71000000-0000-0000-0000-000000000005' and status='paid' and paid_amount=95 and settlement_discount_amount=5)
    then raise exception 'INVOICE_NOT_SETTLED_CORRECTLY'; end if;
  if not exists(select 1 from public.claim_audit_logs where claim_id='71000000-0000-0000-0000-000000000004' and action='insurance_early_settlement_discount')
    then raise exception 'SETTLEMENT_AUDIT_MISSING'; end if;
end;
$$;

rollback;
