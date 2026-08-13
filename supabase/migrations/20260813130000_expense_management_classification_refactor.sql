-- Expense Management Classification Refactor (Development first).
-- Additive only: no historical backfill, no automatic reclassification,
-- no amount/VAT/work-order mutation, and no automatic accounting posting.

alter table public.expense_categories
  add column if not exists code text,
  add column if not exists name_ar text,
  add column if not exists name_en text,
  add column if not exists parent_id uuid,
  add column if not exists level integer,
  add column if not exists category_type text,
  add column if not exists expense_scope text,
  add column if not exists department_code text,
  add column if not exists accounting_mapping_key text,
  add column if not exists cost_center_id uuid,
  add column if not exists is_system boolean not null default false,
  add column if not exists is_active boolean,
  add column if not exists sort_order integer not null default 100,
  add column if not exists description_ar text,
  add column if not exists description_en text,
  add column if not exists created_by uuid,
  add column if not exists updated_by uuid;

alter table public.expenses
  add column if not exists expense_scope text,
  add column if not exists work_order_channel text,
  add column if not exists work_order_id uuid,
  add column if not exists department_id uuid,
  add column if not exists expense_category_id uuid,
  add column if not exists subcategory_id uuid,
  add column if not exists cost_center_id uuid,
  add column if not exists accounting_mapping_key text,
  add column if not exists classification_status text,
  add column if not exists reference_number text,
  add column if not exists notes text,
  add column if not exists status text;

alter table public.insurance_claims add column if not exists deleted_at timestamptz;

alter table public.expense_categories
  drop constraint if exists expense_categories_tenant_id_name_key;

alter table public.accounting_role_permissions
  drop constraint if exists accounting_role_permissions_allowed_key;
alter table public.accounting_role_permissions
  add constraint accounting_role_permissions_allowed_key check(permission_key in (
    'accounting.manage_accounts','accounting.manage_fiscal_years','accounting.manage_periods',
    'accounting.manage_cost_centers','accounting.create_journal','accounting.approve_journal',
    'accounting.post_journal','accounting.reverse_journal','accounting.view_journal',
    'accounting.manage_mappings','accounting.manage_opening_balances','accounting.admin',
    'expenses.view','expenses.create','expenses.edit','expenses.delete',
    'expenses.manage_categories','expenses.reclassify','expenses.export'
  ));

do $$ begin
  alter table public.expense_categories
    add constraint expense_categories_parent_fk foreign key(parent_id)
      references public.expense_categories(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expense_categories
    add constraint expense_categories_cost_center_fk foreign key(cost_center_id)
      references public.accounting_cost_centers(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses
    add constraint expenses_work_order_uuid_fk foreign key(work_order_id)
      references public.job_orders(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses
    add constraint expenses_department_category_fk foreign key(department_id)
      references public.expense_categories(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses
    add constraint expenses_expense_category_fk foreign key(expense_category_id)
      references public.expense_categories(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses
    add constraint expenses_subcategory_fk foreign key(subcategory_id)
      references public.expense_categories(id) on delete restrict;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses
    add constraint expenses_cost_center_fk foreign key(cost_center_id)
      references public.accounting_cost_centers(id) on delete restrict;
exception when duplicate_object then null; end $$;

do $$ begin
  alter table public.expense_categories add constraint expense_categories_level_check
    check (level is null or level >= 1);
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expense_categories add constraint expense_categories_scope_check
    check (expense_scope is null or expense_scope in ('work_order','operating','both'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_scope_check
    check (expense_scope is null or expense_scope in ('work_order','operating'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_channel_check
    check (work_order_channel is null or work_order_channel in ('cash','insurance'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_classification_status_check
    check (classification_status is null or classification_status in ('classified','needs_classification'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.expenses add constraint expenses_lifecycle_status_check
    check (status is null or status in ('active','cancelled','void','invalid'));
exception when duplicate_object then null; end $$;

create unique index if not exists expense_categories_tenant_code_uidx
  on public.expense_categories(tenant_id, lower(code)) where code is not null;
create index if not exists expense_categories_tree_idx
  on public.expense_categories(tenant_id,parent_id,sort_order,id);
create index if not exists expense_categories_scope_active_idx
  on public.expense_categories(tenant_id,expense_scope,is_active,level,sort_order);
create index if not exists expenses_scope_date_idx
  on public.expenses(tenant_id,expense_scope,date desc,id) where deleted_at is null;
create index if not exists expenses_channel_date_idx
  on public.expenses(tenant_id,work_order_channel,date desc,id)
  where deleted_at is null and expense_scope='work_order';
create index if not exists expenses_category_date_idx
  on public.expenses(tenant_id,expense_category_id,subcategory_id,date desc,id) where deleted_at is null;
create index if not exists expenses_work_order_uuid_idx
  on public.expenses(tenant_id,work_order_id,date desc,id) where deleted_at is null;
create index if not exists expenses_claim_date_idx
  on public.expenses(tenant_id,claim_id,date desc,id) where deleted_at is null;
create index if not exists expenses_supplier_date_idx
  on public.expenses(tenant_id,supplier_id,date desc,id) where deleted_at is null;

create table if not exists public.expense_category_audit_logs (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null,
  category_id uuid not null, action text not null, old_value jsonb, new_value jsonb,
  user_id uuid, created_at timestamptz not null default now()
);
create index if not exists expense_category_audit_tenant_idx
  on public.expense_category_audit_logs(tenant_id,category_id,created_at desc);
alter table public.expense_category_audit_logs enable row level security;

create table if not exists public.expense_category_template_items (
  code text primary key, parent_code text, name_ar text not null, name_en text not null,
  expense_scope text not null check(expense_scope in ('work_order','operating','both')),
  category_type text not null, accounting_mapping_key text, sort_order integer not null default 100
);
alter table public.expense_category_template_items enable row level security;
drop policy if exists expense_template_read on public.expense_category_template_items;
create policy expense_template_read on public.expense_category_template_items for select to authenticated using(true);
grant select on public.expense_category_template_items to authenticated;

insert into public.expense_category_template_items
  (code,parent_code,name_ar,name_en,expense_scope,category_type,accounting_mapping_key,sort_order)
values
('MECH',null,'ميكانيك','Mechanical','both','department',null,10),
('MECH_EXT_LABOR','MECH','عمالة خارجية','External Labor','work_order','category','labor_direct_cost',10),
('MECH_EXT_REPAIR','MECH','إصلاحات خارجية','External Repairs','work_order','category','labor_direct_cost',20),
('MECH_DIAG','MECH','فحص وتشخيص','Inspection & Diagnostics','work_order','category','labor_direct_cost',30),
('MECH_PROGRAM','MECH','برمجة','Programming','work_order','category','labor_direct_cost',40),
('MECH_OILS','MECH','زيوت وسوائل','Oils & Fluids','work_order','category','other_operating_expense',50),
('MECH_CONSUMABLES','MECH','مواد استهلاكية','Consumables','work_order','category','other_operating_expense',60),
('MECH_EQUIP_MAINT','MECH','صيانة معدات','Equipment Maintenance','operating','category','other_operating_expense',70),
('MECH_TOOLS','MECH','شراء أدوات','Tools Purchase','operating','category','other_operating_expense',80),
('MECH_PARTS','MECH','قطع ميكانيكية','Mechanical Parts','work_order','category','parts_direct_cost',90),
('MECH_OTHER','MECH','أخرى','Other','both','category','other_operating_expense',100),
('BODY',null,'سمكرة وشاصي','Body & Chassis','work_order','department',null,20),
('BODY_EXT_LABOR','BODY','عمالة خارجية','External Labor','work_order','category','labor_direct_cost',10),
('BODY_EXT_REPAIR','BODY','سمكرة خارجية','External Body Repair','work_order','category','labor_direct_cost',20),
('BODY_CHASSIS','BODY','إصلاح شاصي','Chassis Repair','work_order','category','labor_direct_cost',30),
('BODY_WELDING','BODY','لحام','Welding','work_order','category','labor_direct_cost',40),
('BODY_WELD_MAT','BODY','مواد لحام','Welding Materials','work_order','category','other_operating_expense',50),
('BODY_SANDING','BODY','صنفرة وتجهيز','Sanding & Preparation','work_order','category','labor_direct_cost',60),
('BODY_CONSUMABLES','BODY','مواد استهلاكية','Consumables','work_order','category','other_operating_expense',70),
('BODY_TOOLS','BODY','أدوات ومعدات','Tools & Equipment','operating','category','other_operating_expense',80),
('BODY_OTHER','BODY','أخرى','Other','work_order','category','other_operating_expense',90),
('PAINT',null,'صبغ','Paint','work_order','department',null,30),
('PAINT_MATERIAL','PAINT','دهان','Paint Materials','work_order','category','other_operating_expense',10),
('PAINT_THINNER','PAINT','ثنر','Thinner','work_order','category','other_operating_expense',20),
('PAINT_CLEAR','PAINT','كلير','Clear Coat','work_order','category','other_operating_expense',30),
('PAINT_PRIMER','PAINT','برايمر','Primer','work_order','category','other_operating_expense',40),
('PAINT_FILLER','PAINT','معجون','Body Filler','work_order','category','other_operating_expense',50),
('PAINT_SANDPAPER','PAINT','ورق صنفرة','Sandpaper','work_order','category','other_operating_expense',60),
('PAINT_POLISH','PAINT','مواد تلميع','Polishing Materials','work_order','category','other_operating_expense',70),
('PAINT_MATCH','PAINT','مطابقة ألوان','Color Matching','work_order','category','labor_direct_cost',80),
('PAINT_EXT_LABOR','PAINT','عمالة خارجية','External Labor','work_order','category','labor_direct_cost',90),
('PAINT_OTHER','PAINT','أخرى','Other','work_order','category','other_operating_expense',100),
('ELECTRICAL',null,'كهرباء','Electrical','work_order','department',null,40),
('ELEC_DIAG','ELECTRICAL','فحص كهربائي','Electrical Diagnostics','work_order','category','labor_direct_cost',10),
('ELEC_WIRING','ELECTRICAL','إصلاح أسلاك','Wiring Repair','work_order','category','labor_direct_cost',20),
('ELEC_PROGRAM','ELECTRICAL','برمجة وحدات','Module Programming','work_order','category','labor_direct_cost',30),
('ELEC_SENSORS','ELECTRICAL','حساسات','Sensors','work_order','category','parts_direct_cost',40),
('ELEC_REPAIR','ELECTRICAL','إصلاح إلكترونيات','Electronics Repair','work_order','category','labor_direct_cost',50),
('ELEC_EXT_LABOR','ELECTRICAL','عمالة خارجية','External Labor','work_order','category','labor_direct_cost',60),
('ELEC_CONSUMABLES','ELECTRICAL','مواد استهلاكية','Consumables','work_order','category','other_operating_expense',70),
('ELEC_OTHER','ELECTRICAL','أخرى','Other','work_order','category','other_operating_expense',80),
('PARTS',null,'قطع غيار','Spare Parts','work_order','department',null,50),
('PARTS_NEW','PARTS','قطع غيار جديدة','New Spare Parts','work_order','category','parts_direct_cost',10),
('PARTS_USED','PARTS','قطع غيار مستعملة','Used Spare Parts','work_order','category','parts_direct_cost',20),
('PARTS_GENUINE','PARTS','قطع وكالة','Genuine Parts','work_order','category','parts_direct_cost',30),
('PARTS_AFTERMARKET','PARTS','قطع تجارية','Aftermarket Parts','work_order','category','parts_direct_cost',40),
('PARTS_ACCESSORIES','PARTS','إكسسوارات','Accessories','work_order','category','parts_direct_cost',50),
('PARTS_SHIPPING','PARTS','شحن قطع الغيار','Parts Shipping','work_order','category','transport_direct_cost',60),
('PARTS_CUSTOMS','PARTS','جمارك قطع الغيار','Parts Customs','work_order','category','government_fees_expense',70),
('PARTS_OTHER','PARTS','أخرى','Other','work_order','category','parts_direct_cost',80),
('TRANSPORT',null,'نقل ولوجستيات','Transport & Logistics','both','department',null,60),
('TRANSPORT_RECOVERY','TRANSPORT','سطحة','Recovery Truck','work_order','category','transport_direct_cost',10),
('TRANSPORT_VEHICLE','TRANSPORT','نقل المركبة','Vehicle Transport','work_order','category','transport_direct_cost',20),
('TRANSPORT_SHIPPING','TRANSPORT','شحن','Shipping','both','category','transport_direct_cost',30),
('TRANSPORT_PARTS','TRANSPORT','توصيل قطع','Parts Delivery','work_order','category','transport_direct_cost',40),
('TRANSPORT_LOADING','TRANSPORT','تحميل وتنزيل','Loading & Unloading','both','category','transport_direct_cost',50),
('TRANSPORT_FUEL','TRANSPORT','وقود نقل','Transport Fuel','operating','category','transport_direct_cost',60),
('TRANSPORT_OTHER','TRANSPORT','أخرى','Other','both','category','transport_direct_cost',70),
('WORKSHOP',null,'تشغيل الورشة','Workshop Operations','operating','department',null,70),
('WORKSHOP_ELECTRIC','WORKSHOP','كهرباء','Electricity','operating','category','utilities_expense',10),
('WORKSHOP_WATER','WORKSHOP','مياه','Water','operating','category','utilities_expense',20),
('WORKSHOP_RENT','WORKSHOP','إيجار','Rent','operating','category','rent_expense',30),
('WORKSHOP_BUILDING','WORKSHOP','صيانة المبنى','Building Maintenance','operating','category','other_operating_expense',40),
('WORKSHOP_CLEAN','WORKSHOP','نظافة','Cleaning','operating','category','other_operating_expense',50),
('WORKSHOP_SECURITY','WORKSHOP','أمن','Security','operating','category','other_operating_expense',60),
('WORKSHOP_FUEL','WORKSHOP','وقود تشغيلي','Operational Fuel','operating','category','other_operating_expense',70),
('WORKSHOP_EQUIP','WORKSHOP','صيانة معدات','Equipment Maintenance','operating','category','other_operating_expense',80),
('WORKSHOP_SAFETY','WORKSHOP','معدات سلامة','Safety Equipment','operating','category','other_operating_expense',90),
('WORKSHOP_SUPPLIES','WORKSHOP','مواد تنظيف','Cleaning Supplies','operating','category','other_operating_expense',100),
('WORKSHOP_OTHER','WORKSHOP','أخرى','Other','operating','category','other_operating_expense',110),
('ADMIN',null,'إدارية','Administrative','operating','department',null,80),
('ADMIN_STATIONERY','ADMIN','قرطاسية','Stationery','operating','category','administrative_expense',10),
('ADMIN_TELECOM','ADMIN','اتصالات','Telecommunications','operating','category','administrative_expense',20),
('ADMIN_INTERNET','ADMIN','إنترنت','Internet','operating','category','administrative_expense',30),
('ADMIN_SOFTWARE','ADMIN','برامج واشتراكات','Software & Subscriptions','operating','category','administrative_expense',40),
('ADMIN_PRINT','ADMIN','طباعة','Printing','operating','category','administrative_expense',50),
('ADMIN_HOSPITALITY','ADMIN','ضيافة','Hospitality','operating','category','administrative_expense',60),
('ADMIN_OFFICE','ADMIN','مصاريف مكتبية','Office Expenses','operating','category','administrative_expense',70),
('ADMIN_BANK','ADMIN','رسوم بنكية','Bank Charges','operating','category','bank_charges_expense',80),
('ADMIN_PRO','ADMIN','خدمات مهنية','Professional Services','operating','category','administrative_expense',90),
('ADMIN_OTHER','ADMIN','أخرى','Other','operating','category','administrative_expense',100),
('GOV',null,'حكومية ورسوم','Government & Regulatory','operating','department',null,90),
('GOV_MUNICIPAL','GOV','رسوم بلدية','Municipality Fees','operating','category','government_fees_expense',10),
('GOV_LABOUR','GOV','رسوم وزارة العمل','Ministry of Labour Fees','operating','category','government_fees_expense',20),
('GOV_ROP','GOV','رسوم شرطة عمان السلطانية','Royal Oman Police Fees','operating','category','government_fees_expense',30),
('GOV_CR','GOV','رسوم السجل التجاري','Commercial Registration Fees','operating','category','government_fees_expense',40),
('GOV_LICENSE','GOV','رسوم التراخيص','License Fees','operating','category','government_fees_expense',50),
('GOV_VISA','GOV','رسوم التأشيرات','Visa Fees','operating','category','government_fees_expense',60),
('GOV_PERMIT','GOV','تصاريح','Permits','operating','category','government_fees_expense',70),
('GOV_OTHER','GOV','رسوم حكومية أخرى','Other Government Fees','operating','category','government_fees_expense',80),
('FINES',null,'مخالفات وغرامات','Fines & Penalties','operating','department','other_operating_expense',95),
('HR',null,'الموارد البشرية','Human Resources','operating','department',null,100),
('HR_SALARY','HR','رواتب وأجور','Salaries & Wages','operating','category','salary_expense',10),
('HR_OVERTIME','HR','عمل إضافي','Overtime','operating','category','salary_expense',20),
('HR_ALLOWANCE','HR','بدلات','Allowances','operating','category','salary_expense',30),
('HR_RECRUIT','HR','توظيف','Recruitment','operating','category','administrative_expense',40),
('HR_TRAINING','HR','تدريب','Training','operating','category','administrative_expense',50),
('HR_TRAVEL','HR','سفر موظفين','Employee Travel','operating','category','administrative_expense',60),
('HR_HOUSING','HR','سكن موظفين','Employee Accommodation','operating','category','salary_expense',70),
('HR_TRANSPORT','HR','نقل موظفين','Employee Transport','operating','category','salary_expense',80),
('HR_INSURANCE','HR','تأمين موظفين','Employee Insurance','operating','category','salary_expense',90),
('HR_OTHER','HR','أخرى','Other','operating','category','other_operating_expense',100),
('INSURANCE',null,'تأمين','Insurance','operating','department',null,110),
('INS_VEHICLE','INSURANCE','تأمين المركبات','Vehicle Insurance','operating','category','other_operating_expense',10),
('INS_BUSINESS','INSURANCE','تأمين المنشأة','Business Insurance','operating','category','other_operating_expense',20),
('INS_EQUIP','INSURANCE','تأمين المعدات','Equipment Insurance','operating','category','other_operating_expense',30),
('INS_EMPLOYEE','INSURANCE','تأمين الموظفين','Employee Insurance','operating','category','salary_expense',40),
('INS_OTHER','INSURANCE','أخرى','Other','operating','category','other_operating_expense',50),
('FINANCE',null,'مالية','Finance','operating','department',null,120),
('FIN_BANK','FINANCE','رسوم بنكية','Bank Charges','operating','category','bank_charges_expense',10),
('FIN_TRANSFER','FINANCE','رسوم تحويل','Transfer Fees','operating','category','bank_charges_expense',20),
('FIN_FX','FINANCE','فروقات عملة','Currency Differences','operating','category','other_operating_expense',30),
('FIN_TERMINAL','FINANCE','رسوم أجهزة الدفع','Payment Terminal Fees','operating','category','bank_charges_expense',40),
('FIN_COMMISSION','FINANCE','عمولات','Commissions','operating','category','other_operating_expense',50),
('FIN_OTHER','FINANCE','أخرى','Other','operating','category','other_operating_expense',60),
('OTHER',null,'أخرى','Other','operating','department','other_operating_expense',130)
on conflict(code) do update set parent_code=excluded.parent_code,name_ar=excluded.name_ar,
 name_en=excluded.name_en,expense_scope=excluded.expense_scope,category_type=excluded.category_type,
 accounting_mapping_key=excluded.accounting_mapping_key,sort_order=excluded.sort_order;

create or replace function public.expense_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
 select auth.uid() is not null and public.get_user_tenant_id() is not null and (
  public.get_user_role()='admin'::public.app_role
  or (public.get_user_role()='manager'::public.app_role and p_permission in
      ('expenses.view','expenses.create','expenses.edit','expenses.delete','expenses.manage_categories','expenses.reclassify','expenses.export'))
  or (public.get_user_role()::text='accountant' and p_permission in
      ('expenses.view','expenses.create','expenses.edit','expenses.reclassify','expenses.export'))
  or exists(select 1 from public.accounting_role_permissions rp
    where rp.tenant_id=public.get_user_tenant_id() and rp.role=public.get_user_role()
      and rp.granted and rp.permission_key in (p_permission,'accounting.admin'))
 );
$$;
revoke all on function public.expense_has_permission(text) from public,anon;
grant execute on function public.expense_has_permission(text) to authenticated;

-- Replace the legacy role-only policies with tenant-scoped permission checks.
-- The restrictive policies are important because older permissive policies may
-- still exist on installations upgraded from the original expense module.
drop policy if exists "Admins manage categories" on public.expense_categories;
drop policy if exists "Managers manage categories" on public.expense_categories;
drop policy if exists "expense_categories restrict insert" on public.expense_categories;
drop policy if exists "expense_categories restrict update" on public.expense_categories;
drop policy if exists "expense_categories restrict delete" on public.expense_categories;
drop policy if exists expense_categories_manage on public.expense_categories;
create policy expense_categories_manage on public.expense_categories as restrictive
 for all to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.manage_categories'))
 with check(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.manage_categories'));

drop policy if exists "Staff insert expenses" on public.expenses;
drop policy if exists "Staff update expenses" on public.expenses;
drop policy if exists "Staff delete expenses" on public.expenses;
drop policy if exists "Admin delete expenses" on public.expenses;
drop policy if exists expense_management_insert on public.expenses;
drop policy if exists expense_management_update on public.expenses;
drop policy if exists expense_management_delete on public.expenses;
create policy expense_management_insert on public.expenses for insert to authenticated
 with check(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.create'));
create policy expense_management_update on public.expenses for update to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.edit'))
 with check(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.edit'));
create policy expense_management_delete on public.expenses for delete to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.delete'));

create or replace function public.validate_expense_category_tree()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_parent public.expense_categories%rowtype; v_cycle boolean;
begin
 if new.tenant_id<>public.get_user_tenant_id() then raise exception 'EXPENSE_CATEGORY_TENANT_DENIED'; end if;
 new.code:=upper(btrim(new.code)); new.name_ar:=btrim(new.name_ar); new.name_en:=btrim(new.name_en);
 if coalesce(new.is_active,new.active,true) and (new.name_ar='' or new.name_en='') then
  raise exception 'EXPENSE_CATEGORY_BILINGUAL_NAME_REQUIRED';
 end if;
 new.is_active:=coalesce(new.is_active,new.active,true); new.active:=new.is_active;
 new.name:=new.name_ar; new.description:=coalesce(new.description_ar,new.description);
 new.created_by:=coalesce(new.created_by,auth.uid()); new.updated_by:=auth.uid();
 if new.parent_id is null then new.level:=1;
 else
  select * into v_parent from public.expense_categories where id=new.parent_id;
  if not found or v_parent.tenant_id<>new.tenant_id then raise exception 'EXPENSE_CATEGORY_PARENT_TENANT_INVALID'; end if;
  if new.id is not null and new.parent_id=new.id then raise exception 'EXPENSE_CATEGORY_CYCLE'; end if;
  with recursive ancestors as (
   select id,parent_id from public.expense_categories where id=new.parent_id
   union all select c.id,c.parent_id from public.expense_categories c join ancestors a on c.id=a.parent_id
  ) select exists(select 1 from ancestors where id=new.id) into v_cycle;
  if v_cycle then raise exception 'EXPENSE_CATEGORY_CYCLE'; end if;
  new.level:=v_parent.level+1; new.department_code:=coalesce(v_parent.department_code,v_parent.code);
 end if;
 return new;
end $$;

drop trigger if exists validate_expense_category_tree_trigger on public.expense_categories;
create trigger validate_expense_category_tree_trigger before insert or update on public.expense_categories
for each row execute function public.validate_expense_category_tree();

create or replace function public.audit_expense_category_change()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 insert into public.expense_category_audit_logs(tenant_id,category_id,action,old_value,new_value,user_id)
 values(coalesce(new.tenant_id,old.tenant_id),coalesce(new.id,old.id),lower(tg_op),
        case when tg_op='INSERT' then null else to_jsonb(old) end,
        case when tg_op='DELETE' then null else to_jsonb(new) end,auth.uid());
 return coalesce(new,old);
end $$;
drop trigger if exists audit_expense_category_change_trigger on public.expense_categories;
create trigger audit_expense_category_change_trigger after insert or update or delete on public.expense_categories
for each row execute function public.audit_expense_category_change();

create or replace function public.prevent_used_expense_category_delete()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
begin
 if exists(select 1 from public.expenses e where e.tenant_id=old.tenant_id and
   (e.category_id=old.id::text or e.department_id=old.id or e.expense_category_id=old.id or e.subcategory_id=old.id))
   or exists(select 1 from public.expense_categories c where c.parent_id=old.id) then
  raise exception 'EXPENSE_CATEGORY_IN_USE_DISABLE_INSTEAD';
 end if;
 return old;
end $$;
drop trigger if exists prevent_used_expense_category_delete_trigger on public.expense_categories;
create trigger prevent_used_expense_category_delete_trigger before delete on public.expense_categories
for each row execute function public.prevent_used_expense_category_delete();

create or replace function public.derive_expense_work_order_context()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_work public.job_orders%rowtype; v_claim uuid; v_leaf public.expense_categories%rowtype;
begin
 if new.expense_scope is null then
  new.classification_status:=coalesce(new.classification_status,'needs_classification'); return new;
 end if;
 if new.tenant_id<>public.get_user_tenant_id() then raise exception 'EXPENSE_TENANT_DENIED'; end if;
 if new.expense_scope='work_order' then
  if nullif(btrim(coalesce(new.linked_work_order_id,'')),'') is null and new.work_order_id is null then
   raise exception 'EXPENSE_WORK_ORDER_REQUIRED';
  end if;
  select * into v_work from public.job_orders j where j.tenant_id=new.tenant_id
    and j.deleted_at is null and (j.id=new.work_order_id or j.id::text=new.linked_work_order_id or j.order_number=new.linked_work_order_id)
    order by (j.id=new.work_order_id) desc limit 1;
  if not found then raise exception 'EXPENSE_WORK_ORDER_NOT_FOUND'; end if;
  new.work_order_id:=v_work.id; new.linked_work_order_id:=v_work.order_number;
  new.vehicle_id:=v_work.vehicle_id; new.customer_id:=v_work.customer_id;
  v_claim:=v_work.claim_id;
  if v_claim is null then select c.id into v_claim from public.insurance_claims c where c.tenant_id=new.tenant_id
    and (c.job_order_id=v_work.id or c.auto_job_order_id=v_work.id) and c.deleted_at is null limit 1; end if;
  new.claim_id:=v_claim;
  new.work_order_channel:=case when v_claim is not null or lower(coalesce(v_work.work_order_type,''))='insurance' then 'insurance' else 'cash' end;
 elsif new.expense_scope='operating' then
  if new.work_order_id is not null or nullif(btrim(coalesce(new.linked_work_order_id,'')),'') is not null then
   raise exception 'OPERATING_EXPENSE_WORK_ORDER_NOT_ALLOWED';
  end if;
  new.work_order_channel:=null; new.work_order_id:=null; new.linked_work_order_id:=null;
  new.vehicle_id:=null; new.claim_id:=null; new.customer_id:=null;
 end if;
 if new.subcategory_id is not null then select * into v_leaf from public.expense_categories where id=new.subcategory_id;
 elsif new.expense_category_id is not null then select * into v_leaf from public.expense_categories where id=new.expense_category_id;
 else raise exception 'EXPENSE_CATEGORY_REQUIRED'; end if;
 if not found or v_leaf.tenant_id<>new.tenant_id or not coalesce(v_leaf.is_active,v_leaf.active,false) then
  raise exception 'EXPENSE_CATEGORY_INACTIVE_OR_INVALID';
 end if;
 if v_leaf.expense_scope not in (new.expense_scope,'both') then raise exception 'EXPENSE_CATEGORY_SCOPE_MISMATCH'; end if;
 if v_leaf.accounting_mapping_key is null then raise exception 'EXPENSE_CATEGORY_MAPPING_REQUIRED'; end if;
 if right(v_leaf.code,5)='OTHER' and nullif(btrim(coalesce(new.description,'')),'') is null then
  raise exception 'EXPENSE_OTHER_DESCRIPTION_REQUIRED';
 end if;
 new.accounting_mapping_key:=v_leaf.accounting_mapping_key;
 new.classification_status:='classified'; new.status:=coalesce(new.status,'active');
 return new;
end $$;
drop trigger if exists derive_expense_work_order_context_trigger on public.expenses;
create trigger derive_expense_work_order_context_trigger before insert or update of expense_scope,linked_work_order_id,
 work_order_id,department_id,expense_category_id,subcategory_id,description on public.expenses
for each row execute function public.derive_expense_work_order_context();

create or replace function public.apply_default_expense_category_template()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.get_user_tenant_id(); r record; v_parent uuid;
begin
 if not public.expense_has_permission('expenses.manage_categories') then raise exception 'EXPENSE_PERMISSION_DENIED'; end if;
 for r in select * from public.expense_category_template_items where parent_code is null order by sort_order loop
  insert into public.expense_categories(tenant_id,code,name,name_ar,name_en,level,category_type,expense_scope,
    department_code,accounting_mapping_key,is_system,is_active,active,sort_order,created_by,updated_by)
  values(v_tenant,r.code,r.name_ar,r.name_ar,r.name_en,1,r.category_type,r.expense_scope,r.code,
    r.accounting_mapping_key,true,true,true,r.sort_order,auth.uid(),auth.uid())
  on conflict(tenant_id,(lower(code))) where code is not null do nothing;
 end loop;
 for r in select * from public.expense_category_template_items where parent_code is not null order by parent_code,sort_order loop
  select id into v_parent from public.expense_categories where tenant_id=v_tenant and lower(code)=lower(r.parent_code);
  insert into public.expense_categories(tenant_id,code,name,name_ar,name_en,parent_id,level,category_type,
    expense_scope,department_code,accounting_mapping_key,is_system,is_active,active,sort_order,created_by,updated_by)
  values(v_tenant,r.code,r.name_ar,r.name_ar,r.name_en,v_parent,2,r.category_type,r.expense_scope,r.parent_code,
    r.accounting_mapping_key,true,true,true,r.sort_order,auth.uid(),auth.uid())
  on conflict(tenant_id,(lower(code))) where code is not null do nothing;
 end loop;
 return (select count(*) from public.expense_categories where tenant_id=v_tenant and is_system);
end $$;
revoke all on function public.apply_default_expense_category_template() from public,anon;
grant execute on function public.apply_default_expense_category_template() to authenticated;

create or replace function public.expense_work_order_search_rpc(p_search text default null,p_limit integer default 20)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
 select coalesce(jsonb_agg(to_jsonb(q)),'[]'::jsonb) from (
  select j.id,j.order_number,j.work_order_type,j.customer_id,j.vehicle_id,
   coalesce(j.claim_id,c.id) claim_id,coalesce(c.claim_number,j.insurance_claim_number) claim_number,
   coalesce(c.insurance_company,j.insurance_company) insurance_company,
   v.plate_number as plate,v.plate_letters,v.brand as make,v.model,cu.name customer_name,
   case when coalesce(j.claim_id,c.id) is not null or lower(coalesce(j.work_order_type,''))='insurance'
     then 'insurance' else 'cash' end channel
  from public.job_orders j join public.vehicles v on v.id=j.vehicle_id and v.tenant_id=j.tenant_id
  join public.customers cu on cu.id=j.customer_id and cu.tenant_id=j.tenant_id
  left join lateral(select x.id,x.claim_number,x.insurance_company from public.insurance_claims x
    where x.tenant_id=j.tenant_id and x.deleted_at is null and (x.id=j.claim_id or x.job_order_id=j.id or x.auto_job_order_id=j.id)
    order by (x.id=j.claim_id) desc limit 1)c on true
  where j.tenant_id=public.get_user_tenant_id() and j.deleted_at is null
    and (p_search is null or length(btrim(p_search))<2 or j.order_number ilike '%'||p_search||'%'
      or v.plate_number ilike '%'||p_search||'%' or cu.name ilike '%'||p_search||'%'
      or coalesce(c.claim_number,'') ilike '%'||p_search||'%')
  order by j.updated_at desc limit least(greatest(coalesce(p_limit,20),1),50)
 )q;
$$;
revoke all on function public.expense_work_order_search_rpc(text,integer) from public,anon;
grant execute on function public.expense_work_order_search_rpc(text,integer) to authenticated;

create or replace function public.expense_management_rpc(
 p_page integer default 1,p_page_size integer default 50,p_filters jsonb default '{}'::jsonb)
returns jsonb language plpgsql stable security definer set search_path=pg_catalog,public as $$
declare v_tenant uuid:=public.get_user_tenant_id(); v_rows jsonb; v_total bigint; v_agg jsonb;
 v_limit integer:=least(greatest(coalesce(p_page_size,50),1),500);
 v_offset integer:=greatest(coalesce(p_page,1)-1,0)*least(greatest(coalesce(p_page_size,50),1),500);
begin
 if not public.expense_has_permission('expenses.view') then raise exception 'EXPENSE_PERMISSION_DENIED'; end if;
 with facts as (
  select e.*,j.order_number,j.work_order_type,v.plate_number as plate,v.plate_letters,v.brand as make,v.model,
   cu.name customer_name,c.claim_number,c.insurance_company,s.name supplier_name,
   d.name_ar department_ar,d.name_en department_en,cat.name_ar category_ar,cat.name_en category_en,
   sub.name_ar subcategory_ar,sub.name_en subcategory_en,cc.name_ar cost_center_ar,cc.name_en cost_center_en
  from public.expenses e
  left join public.job_orders j on j.id=e.work_order_id and j.tenant_id=e.tenant_id
  left join public.vehicles v on v.id=e.vehicle_id and v.tenant_id=e.tenant_id
  left join public.customers cu on cu.id=e.customer_id and cu.tenant_id=e.tenant_id
  left join public.insurance_claims c on c.id=e.claim_id and c.tenant_id=e.tenant_id
  left join public.suppliers s on s.id=e.supplier_id and s.tenant_id=e.tenant_id
  left join public.expense_categories d on d.id=e.department_id
  left join public.expense_categories cat on cat.id=e.expense_category_id
  left join public.expense_categories sub on sub.id=e.subcategory_id
  left join public.accounting_cost_centers cc on cc.id=e.cost_center_id
  where e.tenant_id=v_tenant and e.deleted_at is null and e.archived_at is null
   and lower(coalesce(e.status,'active')) not in ('cancelled','void','invalid')
   and (e.expense_scope is distinct from 'work_order' or (j.id is not null and j.deleted_at is null))
   and (e.claim_id is null or (c.id is not null and lower(c.status::text) not in ('cancelled','deleted')))
   and (nullif(p_filters->>'from','') is null or e.date>=(p_filters->>'from')::date)
   and (nullif(p_filters->>'to','') is null or e.date<=(p_filters->>'to')::date)
   and (nullif(p_filters->>'scope','') is null or e.expense_scope=p_filters->>'scope')
   and (nullif(p_filters->>'channel','') is null or e.work_order_channel=p_filters->>'channel')
   and (nullif(p_filters->>'work_order_id','') is null or e.work_order_id=(p_filters->>'work_order_id')::uuid)
   and (nullif(p_filters->>'claim_id','') is null or e.claim_id=(p_filters->>'claim_id')::uuid)
   and (nullif(p_filters->>'vehicle_id','') is null or e.vehicle_id=(p_filters->>'vehicle_id')::uuid)
   and (nullif(p_filters->>'customer_id','') is null or e.customer_id=(p_filters->>'customer_id')::uuid)
   and (nullif(p_filters->>'department_id','') is null or e.department_id=(p_filters->>'department_id')::uuid)
   and (nullif(p_filters->>'category_id','') is null or e.expense_category_id=(p_filters->>'category_id')::uuid)
   and (nullif(p_filters->>'subcategory_id','') is null or e.subcategory_id=(p_filters->>'subcategory_id')::uuid)
   and (nullif(p_filters->>'supplier_id','') is null or e.supplier_id=(p_filters->>'supplier_id')::uuid)
   and (nullif(p_filters->>'payment_method','') is null or e.payment_method=p_filters->>'payment_method')
   and (nullif(p_filters->>'cost_center_id','') is null or e.cost_center_id=(p_filters->>'cost_center_id')::uuid)
   and (nullif(p_filters->>'insurance_company','') is null or coalesce(c.insurance_company,'') ilike '%'||(p_filters->>'insurance_company')||'%')
   and (nullif(p_filters->>'classification_status','') is null or e.classification_status=p_filters->>'classification_status')
   and (nullif(p_filters->>'work_order','') is null or coalesce(j.order_number,'') ilike '%'||(p_filters->>'work_order')||'%')
   and (nullif(p_filters->>'claim','') is null or coalesce(c.claim_number,'') ilike '%'||(p_filters->>'claim')||'%')
   and (nullif(p_filters->>'vehicle','') is null or concat_ws(' ',v.plate_number,v.plate_letters) ilike '%'||(p_filters->>'vehicle')||'%')
   and (nullif(p_filters->>'customer','') is null or coalesce(cu.name,'') ilike '%'||(p_filters->>'customer')||'%')
   and (nullif(p_filters->>'supplier','') is null or coalesce(s.name,'') ilike '%'||(p_filters->>'supplier')||'%')
   and (nullif(p_filters->>'amount_from','') is null or coalesce(nullif(e.total,0),e.amount)>=(p_filters->>'amount_from')::numeric)
   and (nullif(p_filters->>'amount_to','') is null or coalesce(nullif(e.total,0),e.amount)<=(p_filters->>'amount_to')::numeric)
   and (nullif(p_filters->>'vat','') is null or (case when p_filters->>'vat'='vat' then e.vat_amount>0 else e.vat_amount=0 end))
   and (nullif(p_filters->>'search','') is null or e.voucher_number ilike '%'||(p_filters->>'search')||'%'
      or coalesce(e.description,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(j.order_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(v.plate_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(s.name,'') ilike '%'||(p_filters->>'search')||'%')
 ), counted as(select *,count(*) over() full_count from facts)
 select coalesce(jsonb_agg(to_jsonb(x)-'full_count'),'[]'),coalesce(max(full_count),0)
 into v_rows,v_total from(select * from counted order by date desc,created_at desc offset v_offset limit v_limit)x;
 with eligible as (
  select e.* from public.expenses e left join public.job_orders j on j.id=e.work_order_id and j.tenant_id=e.tenant_id
  left join public.insurance_claims c on c.id=e.claim_id and c.tenant_id=e.tenant_id
  left join public.vehicles v on v.id=e.vehicle_id and v.tenant_id=e.tenant_id
  left join public.customers cu on cu.id=e.customer_id and cu.tenant_id=e.tenant_id
  left join public.suppliers s on s.id=e.supplier_id and s.tenant_id=e.tenant_id
  where e.tenant_id=v_tenant and e.deleted_at is null and e.archived_at is null
   and lower(coalesce(e.status,'active')) not in ('cancelled','void','invalid')
   and (e.expense_scope is distinct from 'work_order' or (j.id is not null and j.deleted_at is null))
   and (e.claim_id is null or (c.id is not null and lower(c.status::text) not in ('cancelled','deleted')))
   and (nullif(p_filters->>'from','') is null or e.date>=(p_filters->>'from')::date)
   and (nullif(p_filters->>'to','') is null or e.date<=(p_filters->>'to')::date)
   and (nullif(p_filters->>'scope','') is null or e.expense_scope=p_filters->>'scope')
   and (nullif(p_filters->>'channel','') is null or e.work_order_channel=p_filters->>'channel')
   and (nullif(p_filters->>'work_order_id','') is null or e.work_order_id=(p_filters->>'work_order_id')::uuid)
   and (nullif(p_filters->>'claim_id','') is null or e.claim_id=(p_filters->>'claim_id')::uuid)
   and (nullif(p_filters->>'vehicle_id','') is null or e.vehicle_id=(p_filters->>'vehicle_id')::uuid)
   and (nullif(p_filters->>'customer_id','') is null or e.customer_id=(p_filters->>'customer_id')::uuid)
   and (nullif(p_filters->>'department_id','') is null or e.department_id=(p_filters->>'department_id')::uuid)
   and (nullif(p_filters->>'category_id','') is null or e.expense_category_id=(p_filters->>'category_id')::uuid)
   and (nullif(p_filters->>'subcategory_id','') is null or e.subcategory_id=(p_filters->>'subcategory_id')::uuid)
   and (nullif(p_filters->>'supplier_id','') is null or e.supplier_id=(p_filters->>'supplier_id')::uuid)
   and (nullif(p_filters->>'payment_method','') is null or e.payment_method=p_filters->>'payment_method')
   and (nullif(p_filters->>'cost_center_id','') is null or e.cost_center_id=(p_filters->>'cost_center_id')::uuid)
   and (nullif(p_filters->>'insurance_company','') is null or coalesce(c.insurance_company,'') ilike '%'||(p_filters->>'insurance_company')||'%')
   and (nullif(p_filters->>'classification_status','') is null or e.classification_status=p_filters->>'classification_status')
   and (nullif(p_filters->>'work_order','') is null or coalesce(j.order_number,'') ilike '%'||(p_filters->>'work_order')||'%')
   and (nullif(p_filters->>'claim','') is null or coalesce(c.claim_number,'') ilike '%'||(p_filters->>'claim')||'%')
   and (nullif(p_filters->>'vehicle','') is null or concat_ws(' ',v.plate_number,v.plate_letters) ilike '%'||(p_filters->>'vehicle')||'%')
   and (nullif(p_filters->>'customer','') is null or coalesce(cu.name,'') ilike '%'||(p_filters->>'customer')||'%')
   and (nullif(p_filters->>'supplier','') is null or coalesce(s.name,'') ilike '%'||(p_filters->>'supplier')||'%')
   and (nullif(p_filters->>'amount_from','') is null or coalesce(nullif(e.total,0),e.amount)>=(p_filters->>'amount_from')::numeric)
   and (nullif(p_filters->>'amount_to','') is null or coalesce(nullif(e.total,0),e.amount)<=(p_filters->>'amount_to')::numeric)
   and (nullif(p_filters->>'vat','') is null or (case when p_filters->>'vat'='vat' then e.vat_amount>0 else e.vat_amount=0 end))
   and (nullif(p_filters->>'search','') is null or e.voucher_number ilike '%'||(p_filters->>'search')||'%'
      or coalesce(e.description,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(j.order_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(v.plate_number,'') ilike '%'||(p_filters->>'search')||'%'
      or coalesce(s.name,'') ilike '%'||(p_filters->>'search')||'%')
 ) select jsonb_build_object(
   'total',coalesce(sum(coalesce(nullif(total,0),amount)),0),
   'cashWorkOrders',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='work_order' and work_order_channel='cash'),0),
   'insuranceWorkOrders',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='work_order' and work_order_channel='insurance'),0),
   'operating',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='operating'),0),
   'vat',coalesce(sum(vat_amount),0),
   'directCosts',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='work_order'),0),
   'operatingCosts',coalesce(sum(coalesce(nullif(total,0),amount)) filter(where expense_scope='operating'),0)
  ) into v_agg from eligible;
 return jsonb_build_object('rows',v_rows,'aggregates',v_agg,'pagination',jsonb_build_object(
  'page',greatest(coalesce(p_page,1),1),'pageSize',v_limit,'totalRows',v_total,
  'totalPages',case when v_total=0 then 0 else ceil(v_total::numeric/v_limit)::int end),
  'generatedAt',now(),'basis','eligible_expenses_server_side');
end $$;
revoke all on function public.expense_management_rpc(integer,integer,jsonb) from public,anon;
grant execute on function public.expense_management_rpc(integer,integer,jsonb) to authenticated;

-- Keep all existing report consumers compatible while making the authoritative
-- classified linkage visible to vehicle P&L and accounting reports.
create or replace view public.reports_expense_facts_v1
with (security_invoker = true) as
select e.tenant_id,e.id,e.voucher_number,e.date,
 coalesce(sub.name_en,cat.name_en,e.category_name) category_name,
 case when e.classification_status='classified' and e.expense_scope='operating' then 'workshop_general'
      when e.classification_status='classified' and e.expense_scope='work_order' then 'work_order_direct'
      else coalesce(nullif(e.expense_type,''),'unassigned') end expense_type,
 e.description,e.beneficiary,e.payment_method,e.supplier_id,
 coalesce(e.claim_id,jo.claim_id) claim_id,
 coalesce(e.work_order_id,jo.id) work_order_id,
 coalesce(e.vehicle_id,jo.vehicle_id) vehicle_id,
 coalesce(e.work_order_channel,public.reports_classify_business_type(coalesce(e.claim_id,jo.claim_id),'expense',jo.work_order_type)) business_type,
 coalesce(nullif(e.subtotal,0),e.amount,0)::numeric subtotal,
 coalesce(e.vat_amount,0)::numeric vat,
 coalesce(nullif(e.total,0),nullif(e.subtotal,0),e.amount,0)::numeric total,
 e.deleted_at,e.archived_at,e.expense_scope,e.accounting_mapping_key,e.classification_status,
 e.department_id,e.expense_category_id,e.subcategory_id,e.cost_center_id
from public.expenses e
left join lateral(select j.* from public.job_orders j where j.tenant_id=e.tenant_id
 and (j.id=e.work_order_id or j.id::text=e.linked_work_order_id or j.order_number=e.linked_work_order_id)
 order by (j.id=e.work_order_id) desc,j.created_at desc limit 1)jo on true
left join public.expense_categories cat on cat.id=e.expense_category_id and cat.tenant_id=e.tenant_id
left join public.expense_categories sub on sub.id=e.subcategory_id and sub.tenant_id=e.tenant_id;

revoke all on public.reports_expense_facts_v1 from public,anon;
grant select on public.reports_expense_facts_v1 to authenticated;

drop policy if exists expense_category_audit_read on public.expense_category_audit_logs;
create policy expense_category_audit_read on public.expense_category_audit_logs for select to authenticated
 using(tenant_id=public.get_user_tenant_id() and public.expense_has_permission('expenses.manage_categories'));
drop policy if exists expense_category_audit_insert on public.expense_category_audit_logs;
create policy expense_category_audit_insert on public.expense_category_audit_logs for insert to authenticated
 with check(tenant_id=public.get_user_tenant_id());
grant select on public.expense_category_audit_logs to authenticated;

comment on column public.expenses.classification_status is
 'Legacy rows remain needs_classification until an authorized manual reclassification; migration performs no backfill.';
comment on function public.apply_default_expense_category_template() is
 'Manual tenant-scoped application only. Never invoked by migration or application boot.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('expense-documents','expense-documents',false,12582912,
 array['application/pdf','image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,
 allowed_mime_types=excluded.allowed_mime_types;

drop policy if exists expense_documents_read on storage.objects;
drop policy if exists expense_documents_insert on storage.objects;
drop policy if exists expense_documents_update on storage.objects;
drop policy if exists expense_documents_delete on storage.objects;
create policy expense_documents_read on storage.objects for select to authenticated
 using(bucket_id='expense-documents' and (storage.foldername(name))[1]=public.get_user_tenant_id()::text
   and public.expense_has_permission('expenses.view'));
create policy expense_documents_insert on storage.objects for insert to authenticated
 with check(bucket_id='expense-documents' and (storage.foldername(name))[1]=public.get_user_tenant_id()::text
   and public.expense_has_permission('expenses.create'));
create policy expense_documents_update on storage.objects for update to authenticated
 using(bucket_id='expense-documents' and (storage.foldername(name))[1]=public.get_user_tenant_id()::text
   and public.expense_has_permission('expenses.edit'))
 with check(bucket_id='expense-documents' and (storage.foldername(name))[1]=public.get_user_tenant_id()::text
   and public.expense_has_permission('expenses.edit'));
create policy expense_documents_delete on storage.objects for delete to authenticated
 using(bucket_id='expense-documents' and (storage.foldername(name))[1]=public.get_user_tenant_id()::text
   and public.expense_has_permission('expenses.delete'));
