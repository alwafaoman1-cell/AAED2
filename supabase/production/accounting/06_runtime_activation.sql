-- Production runtime activation for the verified operational tenant only.
-- Additive and idempotent: it never updates or deletes operational source rows.
-- Historical sources are posted separately after preview validation.

begin;
set local lock_timeout = '5s';
set local statement_timeout = '5min';

do $$
declare
  v_tenant constant uuid := '1424dd74-88c9-4cad-863a-d9c711bd243f';
  v_admin uuid;
  r record;
  v_parent_id uuid;
begin
  if not exists (select 1 from public.tenants where id = v_tenant) then
    raise exception 'ACCOUNTING_ACTIVATION_TENANT_NOT_FOUND';
  end if;
  if not exists (select 1 from public.job_orders where tenant_id = v_tenant) then
    raise exception 'ACCOUNTING_ACTIVATION_OPERATIONAL_TENANT_REQUIRED';
  end if;

  select user_id into v_admin
  from public.profiles
  where tenant_id = v_tenant and role::text = 'admin' and user_id is not null
  order by created_at nulls last, id
  limit 1;
  if v_admin is null then
    raise exception 'ACCOUNTING_ACTIVATION_ADMIN_REQUIRED';
  end if;

  create temporary table accounting_activation_accounts(
    code text primary key,
    name_ar text not null,
    name_en text not null,
    parent_code text,
    account_type text not null,
    normal_balance text not null,
    level smallint not null,
    is_postable boolean not null
  ) on commit drop;

  insert into accounting_activation_accounts values
    ('1000','الأصول','Assets',null,'asset','debit',1,false),
    ('1100','النقدية وما في حكمها','Cash and equivalents','1000','asset','debit',2,false),
    ('1110','الصندوق','Cash','1100','asset','debit',3,true),
    ('1120','البنك','Bank','1100','asset','debit',3,true),
    ('1130','حساب تسوية المدفوعات','Payment clearing','1100','asset','debit',3,true),
    ('1200','الذمم المدينة','Receivables','1000','asset','debit',2,false),
    ('1210','ذمم شركات التأمين','Insurance receivables','1200','asset','debit',3,true),
    ('1220','ذمم عملاء الكاش','Cash customer receivables','1200','asset','debit',3,true),
    ('1230','ضريبة القيمة المضافة المدخلة','Input VAT','1200','asset','debit',3,true),
    ('1300','المخزون','Inventory','1000','asset','debit',2,true),
    ('1400','مصروفات مدفوعة مقدمًا','Prepaid expenses','1000','asset','debit',2,true),
    ('1500','الأصول الثابتة','Fixed assets','1000','asset','debit',2,false),
    ('1590','مجمع الإهلاك','Accumulated depreciation','1500','asset','credit',3,true),
    ('2000','الالتزامات','Liabilities',null,'liability','credit',1,false),
    ('2100','ذمم الموردين','Supplier payables','2000','liability','credit',2,true),
    ('2200','ضريبة القيمة المضافة المستحقة','Output VAT','2000','liability','credit',2,true),
    ('2300','المصروفات المستحقة','Accrued expenses','2000','liability','credit',2,true),
    ('2400','التزامات أخرى','Other liabilities','2000','liability','credit',2,true),
    ('3000','حقوق الملكية','Equity',null,'equity','credit',1,false),
    ('3100','رأس المال','Capital','3000','equity','credit',2,true),
    ('3200','الأرباح المحتجزة','Retained earnings','3000','equity','credit',2,true),
    ('3300','نتيجة الفترة','Period result','3000','equity','credit',2,true),
    ('4000','الإيرادات','Revenue',null,'revenue','credit',1,false),
    ('4100','إيرادات إصلاحات التأمين','Insurance repair revenue','4000','revenue','credit',2,true),
    ('4200','إيرادات أعمال الكاش','Cash repair revenue','4000','revenue','credit',2,true),
    ('4250','مردودات وإشعارات دائنة','Sales returns and credit notes','4000','revenue','debit',2,true),
    ('4300','إيرادات قطع الغيار','Parts revenue','4000','revenue','credit',2,true),
    ('4400','إيرادات العمالة','Labour revenue','4000','revenue','credit',2,true),
    ('4500','إيرادات السمكرة والصبغ','Body and paint revenue','4000','revenue','credit',2,true),
    ('4600','إيرادات الميكانيك','Mechanical revenue','4000','revenue','credit',2,true),
    ('4700','إيرادات الكهرباء','Electrical revenue','4000','revenue','credit',2,true),
    ('4800','إيرادات النقل','Transport revenue','4000','revenue','credit',2,true),
    ('4900','إيرادات أخرى','Other revenue','4000','revenue','credit',2,true),
    ('5000','تكلفة الإيرادات','Cost of revenue',null,'cost_of_revenue','debit',1,false),
    ('5100','تكلفة قطع الغيار','Parts cost','5000','cost_of_revenue','debit',2,true),
    ('5200','تكلفة العمالة المباشرة','Direct labour cost','5000','cost_of_revenue','debit',2,true),
    ('5300','تكلفة النقل','Transport cost','5000','cost_of_revenue','debit',2,true),
    ('5400','تكلفة المشتريات المباشرة','Direct purchases','5000','cost_of_revenue','debit',2,true),
    ('5900','تكاليف مباشرة أخرى','Other direct costs','5000','cost_of_revenue','debit',2,true),
    ('6000','المصروفات التشغيلية','Operating expenses',null,'expense','debit',1,false),
    ('6100','الرواتب والأجور','Salaries and wages','6000','expense','debit',2,true),
    ('6200','الإيجار','Rent','6000','expense','debit',2,true),
    ('6300','الكهرباء والمياه','Utilities','6000','expense','debit',2,true),
    ('6400','المصروفات الإدارية','Administrative expenses','6000','expense','debit',2,true),
    ('6500','المصروفات البنكية','Bank charges','6000','expense','debit',2,true),
    ('6600','الأدوات والمواد الاستهلاكية','Tools and consumables','6000','expense','debit',2,true),
    ('6700','الإهلاك','Depreciation','6000','expense','debit',2,true),
    ('6800','الخصومات الممنوحة','Discounts allowed','6000','expense','debit',2,true),
    ('6900','مصروفات تشغيلية أخرى','Other operating expenses','6000','expense','debit',2,true);

  for r in select * from accounting_activation_accounts order by level, code loop
    v_parent_id := null;
    if r.parent_code is not null then
      select id into v_parent_id from public.accounting_accounts
      where tenant_id = v_tenant and code = r.parent_code;
      if v_parent_id is null then
        raise exception 'ACCOUNTING_ACTIVATION_PARENT_MISSING:%', r.parent_code;
      end if;
    end if;
    insert into public.accounting_accounts(
      tenant_id,code,name_ar,name_en,parent_id,account_type,normal_balance,level,
      is_postable,is_system,is_active,created_by,updated_by
    ) values (
      v_tenant,r.code,r.name_ar,r.name_en,v_parent_id,r.account_type,r.normal_balance,
      r.level,r.is_postable,true,true,v_admin,v_admin
    ) on conflict (tenant_id,code) do nothing;
  end loop;

  insert into public.accounting_fiscal_years(
    tenant_id,name,start_date,end_date,status,created_by,updated_by
  ) values
    (v_tenant,'FY 2025','2025-01-01','2025-12-31','open',v_admin,v_admin),
    (v_tenant,'FY 2026','2026-01-01','2026-12-31','open',v_admin,v_admin)
  on conflict (tenant_id,name) do nothing;

  insert into public.accounting_periods(
    tenant_id,fiscal_year_id,name,sequence,start_date,end_date,status,created_by,updated_by
  )
  select v_tenant,y.id,to_char(month_start,'FMMonth YYYY'),extract(month from month_start)::smallint,
         month_start,(month_start + interval '1 month - 1 day')::date,'open',v_admin,v_admin
  from public.accounting_fiscal_years y
  cross join lateral generate_series(y.start_date,y.end_date,interval '1 month') month_start
  where y.tenant_id=v_tenant and y.name in ('FY 2025','FY 2026')
  on conflict (tenant_id,fiscal_year_id,sequence) do nothing;

  insert into public.accounting_cost_centers(
    tenant_id,code,name_ar,name_en,parent_id,is_active,is_system,effective_from,created_by,updated_by
  ) values
    (v_tenant,'100','الورشة','Workshop',null,true,true,'2025-01-01',v_admin,v_admin),
    (v_tenant,'200','أعمال الكاش','Cash business',null,true,true,'2025-01-01',v_admin,v_admin),
    (v_tenant,'300','مطالبات التأمين','Insurance claims',null,true,true,'2025-01-01',v_admin,v_admin),
    (v_tenant,'900','الإدارة والمصروفات العامة','Administration and overhead',null,true,true,'2025-01-01',v_admin,v_admin)
  on conflict (tenant_id,code) do nothing;

  insert into public.accounting_account_mappings(
    tenant_id,mapping_key,account_id,priority,status,effective_from,created_by,updated_by
  )
  select v_tenant,m.mapping_key,a.id,100,'active','2025-01-01',v_admin,v_admin
  from (values
    ('insurance_receivable','1210'),('cash_customer_receivable','1220'),
    ('sales_revenue','4200'),('insurance_revenue','4100'),('cash_revenue','4200'),
    ('output_vat','2200'),('input_vat','1230'),('cash','1110'),('bank','1120'),
    ('supplier_payable','2100'),('parts_cost','5100'),('labor_cost','5200'),
    ('transport_cost','5300'),('operating_expense','6900'),('discounts','6800'),
    ('credit_notes','4250'),('payment_clearing','1130')
  ) m(mapping_key,account_code)
  join public.accounting_accounts a on a.tenant_id=v_tenant and a.code=m.account_code
  on conflict do nothing;

  insert into public.accounting_cash_bank_accounts(
    tenant_id,name_ar,name_en,account_kind,accounting_account_id,currency,
    is_active,is_default,created_by,updated_by
  )
  select v_tenant,x.name_ar,x.name_en,x.kind,a.id,'OMR',true,true,v_admin,v_admin
  from (values
    ('الصندوق الرئيسي','Main Cashbox','cash','1110'),
    ('الحساب البنكي الرئيسي','Main Bank Account','bank','1120')
  ) x(name_ar,name_en,kind,account_code)
  join public.accounting_accounts a on a.tenant_id=v_tenant and a.code=x.account_code
  on conflict (tenant_id,name_en) do nothing;

  insert into public.accounting_payment_method_mappings(
    tenant_id,payment_method,cash_bank_account_id,is_active,created_by,updated_by
  )
  select v_tenant,m.method,cb.id,true,v_admin,v_admin
  from (values
    ('cash','cash'),('bank','bank'),('bank_transfer','bank'),('cheque','bank'),
    ('check','bank'),('card','bank')
  ) m(method,kind)
  join public.accounting_cash_bank_accounts cb
    on cb.tenant_id=v_tenant and cb.account_kind=m.kind and cb.is_default and cb.is_active
  on conflict (tenant_id,payment_method) do nothing;

  -- The existing activation guard permits active rules only in an explicit,
  -- postgres-owned validation/activation transaction. The setting is local.
  perform set_config('app.accounting_runtime_validation','on',true);

  insert into public.accounting_posting_rules(
    tenant_id,rule_key,source_type,event_type,debit_mapping_key,credit_mapping_key,
    is_active,priority,configuration,effective_from,created_by,updated_by
  ) values
    (v_tenant,'cash-invoice-issue','sales_invoice','issue','cash_customer_receivable','cash_revenue',true,10,
      '{"lines":[{"side":"debit","mapping_key":"$receivable","amount":"total_amount"},{"side":"credit","mapping_key":"$revenue","amount":"net_amount"},{"side":"credit","mapping_key":"output_vat","amount":"vat_amount"}]}'::jsonb,'2025-01-01',v_admin,v_admin),
    (v_tenant,'insurance-invoice-issue','insurance_invoice','issue','insurance_receivable','insurance_revenue',true,10,
      '{"lines":[{"side":"debit","mapping_key":"$receivable","amount":"total_amount"},{"side":"credit","mapping_key":"$revenue","amount":"net_amount"},{"side":"credit","mapping_key":"output_vat","amount":"vat_amount"}]}'::jsonb,'2025-01-01',v_admin,v_admin),
    (v_tenant,'sales-payment-clear','sales_payment','clear','cash','cash_customer_receivable',true,10,
      '{"lines":[{"side":"debit","mapping_key":"$payment_account","amount":"amount"},{"side":"credit","mapping_key":"$receivable","amount":"amount"}]}'::jsonb,'2025-01-01',v_admin,v_admin),
    (v_tenant,'claim-payment-clear','claim_payment','clear','bank','insurance_receivable',true,10,
      '{"lines":[{"side":"debit","mapping_key":"$payment_account","amount":"amount"},{"side":"credit","mapping_key":"$receivable","amount":"amount"}]}'::jsonb,'2025-01-01',v_admin,v_admin),
    (v_tenant,'expense-recognize','expense','recognize','operating_expense','cash',true,10,
      '{"lines":[{"side":"debit","mapping_key":"$expense_account","amount":"net_amount"},{"side":"debit","mapping_key":"input_vat","amount":"vat_amount"},{"side":"credit","mapping_key":"$payment_account","amount":"total_amount"}]}'::jsonb,'2025-01-01',v_admin,v_admin)
  on conflict (tenant_id,rule_key) do nothing;
end $$;

commit;

select jsonb_build_object(
  'tenant_id','1424dd74-88c9-4cad-863a-d9c711bd243f',
  'accounts',(select count(*) from public.accounting_accounts where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f'),
  'fiscal_years',(select count(*) from public.accounting_fiscal_years where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f'),
  'open_periods',(select count(*) from public.accounting_periods where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f' and status='open'),
  'cost_centers',(select count(*) from public.accounting_cost_centers where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f' and is_active),
  'mappings',(select count(*) from public.accounting_account_mappings where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f' and status='active'),
  'active_rules',(select count(*) from public.accounting_posting_rules where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f' and is_active),
  'cash_bank_accounts',(select count(*) from public.accounting_cash_bank_accounts where tenant_id='1424dd74-88c9-4cad-863a-d9c711bd243f' and is_active)
) activation_result;
