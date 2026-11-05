-- DEVELOPMENT ONLY. 28 synthetic insurance invoices, not copies of Production.
-- Explicit receipt numbers avoid nextval; normal guards/triggers remain enabled.
-- Runner verifies Development connection first; always ROLLBACK.
begin;
set local statement_timeout='25s';
set local lock_timeout='2s';
do $settlement_matrix$
declare
  actor uuid; tenant uuid; customer uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid();
  claim uuid; invoice uuid; amount numeric; cash numeric; discount numeric; row record;
  i integer; expected_cash numeric:=0; expected_balance numeric:=0; expected_total numeric:=0;
  cases jsonb:='[]'; summary jsonb;
begin
  if current_setting('security_audit.approved_project_ref',true)
      is distinct from 'rrhyglrnlveygyiandhs' then raise exception 'DEVELOPMENT_ACK_REQUIRED';end if;
  select user_id,tenant_id into actor,tenant from public.profiles where role='manager' and account_status='active' limit 1;
  if actor is null then raise exception 'DEVELOPMENT_MANAGER_REQUIRED';end if;
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  insert into public.accounting_role_permissions(tenant_id,role,permission_key,granted)
  values(tenant,'manager','accounting.admin',true);
  insert into public.customers(id,tenant_id,name) values(customer,tenant,'SYNTHETIC ROLLBACK 28');
  insert into public.vehicles(id,tenant_id,customer_id,plate_number,plate_letters,plate_country,brand,model)
  values(vehicle,tenant,customer,'999928','TEST','OM','Synthetic','Rollback');
  for i in 1..28 loop
    claim:=gen_random_uuid(); invoice:=gen_random_uuid();
    amount:=100+i; discount:=round(i+0.125,3);
    cash:=case when mod(i,2)=0 then amount-discount else amount-discount-10 end;
    insert into public.insurance_claims(id,tenant_id,customer_id,vehicle_id,claim_number,insurance_company,estimated_amount,status)
    values(claim,tenant,customer,vehicle,'DEV-28-'||i,'Synthetic Test Insurer',amount,'approved');
    insert into public.insurance_invoices(id,tenant_id,invoice_number,claim_id,insurance_company_name,invoice_date,due_date,subtotal,vat,total,status)
    values(invoice,tenant,'',claim,'Synthetic Test Insurer',current_date,current_date-1,amount,0,amount,'issued');
    insert into public.claim_payments(tenant_id,claim_id,payment_number,amount,payment_date,offset_against_invoice_id,
      status,settlement_discount_amount,settlement_discount_reason,settlement_approved_by)
    values(tenant,claim,'DEV-28-'||i,cash,current_date,case when mod(i,4)=0 then null else invoice end,
      'cleared',discount,'Synthetic approved discount',actor);
    insert into public.claim_payments(tenant_id,claim_id,payment_number,amount,payment_date,offset_against_invoice_id,status)
    values(tenant,claim,'DEV-28-PENDING-'||i,500,current_date,invoice,'pending');
    select f.total,f.paid,f.outstanding,inv.paid_amount,inv.settlement_discount_amount
      into row from public.reports_invoice_facts_v1 f
      join public.insurance_invoices inv on inv.id=f.id and inv.tenant_id=f.tenant_id
      where f.id=invoice and f.tenant_id=tenant;
    if not found or row.total is distinct from amount or row.paid is distinct from cash
      or row.paid_amount is distinct from cash or row.settlement_discount_amount is distinct from discount
      or row.outstanding is distinct from greatest(amount-cash-discount,0) then
      raise exception 'SETTLEMENT_CASE_FAILED: %',i;
    end if;
    expected_cash:=expected_cash+cash;expected_total:=expected_total+amount;
    expected_balance:=expected_balance+greatest(amount-cash-discount,0);
    cases:=cases||jsonb_build_object('case',i,'paid_matches_receipts',true,'balance_matches_discount',true,
      'pending_excluded',true,'legacy_unallocated',mod(i,4)=0);
  end loop;
  execute 'set local role authenticated';
  summary:=public.reports_center_secure_summary_rpc(tenant,current_date,current_date,'insurance');
  if (summary->>'paid')::numeric is distinct from expected_cash
    or (summary->>'invoice_total')::numeric is distinct from expected_total
    or (summary->>'outstanding')::numeric is distinct from expected_balance then
    raise exception 'SETTLEMENT_28_SUMMARY_FAILED';end if;
  perform set_config('security_audit.settlement28',jsonb_build_object('cases',jsonb_array_length(cases),
    'full_settlements',14,'partial_settlements',14,'uncleared_excluded',28,'legacy_unallocated',7,
    'paid_is_real_cash',true,'summary_parity',true,'production','NOT_APPLIED')::text,true);
end $settlement_matrix$;
reset role;
select current_setting('security_audit.settlement28')::jsonb as verification;
rollback;

