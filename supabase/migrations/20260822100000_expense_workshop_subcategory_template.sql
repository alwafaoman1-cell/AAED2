-- Additive workshop expense subcategory template.
-- This only extends the manual template; it never changes historical expenses
-- and never applies the template automatically to a tenant.

insert into public.expense_category_template_items
  (code,parent_code,name_ar,name_en,expense_scope,category_type,accounting_mapping_key,sort_order)
values
  ('MECH_DIAG_COMPUTER','MECH_DIAG','فحص كمبيوتر','Computer Diagnostics','work_order','subcategory','labor_direct_cost',10),
  ('MECH_DIAG_ENGINE','MECH_DIAG','فحص المحرك','Engine Diagnostics','work_order','subcategory','labor_direct_cost',20),
  ('MECH_DIAG_GEARBOX','MECH_DIAG','فحص ناقل الحركة','Transmission Diagnostics','work_order','subcategory','labor_direct_cost',30),
  ('MECH_DIAG_AC','MECH_DIAG','فحص التكييف','A/C Diagnostics','work_order','subcategory','labor_direct_cost',40),
  ('MECH_OIL_ENGINE','MECH_OILS','زيت المحرك','Engine Oil','work_order','subcategory','other_operating_expense',10),
  ('MECH_OIL_GEARBOX','MECH_OILS','زيت ناقل الحركة','Transmission Oil','work_order','subcategory','other_operating_expense',20),
  ('MECH_OIL_COOLANT','MECH_OILS','سائل التبريد','Coolant','work_order','subcategory','other_operating_expense',30),
  ('MECH_OIL_BRAKE','MECH_OILS','سائل الفرامل','Brake Fluid','work_order','subcategory','other_operating_expense',40),
  ('MECH_OIL_STEERING','MECH_OILS','زيت المقود','Power Steering Fluid','work_order','subcategory','other_operating_expense',50),
  ('MECH_PART_ENGINE','MECH_PARTS','قطع المحرك','Engine Parts','work_order','subcategory','parts_direct_cost',10),
  ('MECH_PART_GEARBOX','MECH_PARTS','قطع ناقل الحركة','Transmission Parts','work_order','subcategory','parts_direct_cost',20),
  ('MECH_PART_BRAKE','MECH_PARTS','قطع الفرامل','Brake Parts','work_order','subcategory','parts_direct_cost',30),
  ('MECH_PART_SUSPENSION','MECH_PARTS','قطع التعليق','Suspension Parts','work_order','subcategory','parts_direct_cost',40),
  ('MECH_PART_STEERING','MECH_PARTS','قطع المقود','Steering Parts','work_order','subcategory','parts_direct_cost',50),
  ('MECH_PART_COOLING','MECH_PARTS','قطع نظام التبريد','Cooling System Parts','work_order','subcategory','parts_direct_cost',60),
  ('MECH_PART_AC','MECH_PARTS','قطع التكييف','A/C Parts','work_order','subcategory','parts_direct_cost',70),
  ('BODY_REPAIR_PANEL','BODY_EXT_REPAIR','إصلاح ألواح الهيكل','Body Panel Repair','work_order','subcategory','labor_direct_cost',10),
  ('BODY_REPAIR_DENT','BODY_EXT_REPAIR','إصلاح الانبعاجات','Dent Repair','work_order','subcategory','labor_direct_cost',20),
  ('BODY_REPAIR_ALIGN','BODY_EXT_REPAIR','وزن الهيكل','Body Alignment','work_order','subcategory','labor_direct_cost',30),
  ('BODY_WELD_STEEL','BODY_WELD_MAT','مواد لحام حديد','Steel Welding Materials','work_order','subcategory','other_operating_expense',10),
  ('BODY_WELD_ALUMINUM','BODY_WELD_MAT','مواد لحام ألمنيوم','Aluminium Welding Materials','work_order','subcategory','other_operating_expense',20),
  ('PAINT_MAT_BASE','PAINT_MATERIAL','دهان أساس','Base Coat','work_order','subcategory','other_operating_expense',10),
  ('PAINT_MAT_WATER','PAINT_MATERIAL','دهان مائي','Waterborne Paint','work_order','subcategory','other_operating_expense',20),
  ('PAINT_MAT_SOLVENT','PAINT_MATERIAL','دهان مذيبات','Solvent Paint','work_order','subcategory','other_operating_expense',30),
  ('PAINT_MAT_MIX','PAINT_MATERIAL','مواد خلط الألوان','Colour Mixing Materials','work_order','subcategory','other_operating_expense',40),
  ('ELEC_SENSOR_ENGINE','ELEC_SENSORS','حساسات المحرك','Engine Sensors','work_order','subcategory','parts_direct_cost',10),
  ('ELEC_SENSOR_SAFETY','ELEC_SENSORS','حساسات السلامة','Safety Sensors','work_order','subcategory','parts_direct_cost',20),
  ('ELEC_SENSOR_PARK','ELEC_SENSORS','حساسات المواقف','Parking Sensors','work_order','subcategory','parts_direct_cost',30),
  ('ELEC_REPAIR_ECU','ELEC_REPAIR','إصلاح وحدات التحكم','ECU Repair','work_order','subcategory','labor_direct_cost',10),
  ('ELEC_REPAIR_LIGHT','ELEC_REPAIR','إصلاح الإضاءة','Lighting Repair','work_order','subcategory','labor_direct_cost',20),
  ('PART_NEW_ENGINE','PARTS_NEW','محرك وناقل حركة','Engine & Transmission','work_order','subcategory','parts_direct_cost',10),
  ('PART_NEW_BODY','PARTS_NEW','هيكل وصدامات','Body & Bumpers','work_order','subcategory','parts_direct_cost',20),
  ('PART_NEW_ELECTRICAL','PARTS_NEW','كهرباء وإلكترونيات','Electrical & Electronics','work_order','subcategory','parts_direct_cost',30),
  ('PART_NEW_SUSPENSION','PARTS_NEW','تعليق ومقود','Suspension & Steering','work_order','subcategory','parts_direct_cost',40),
  ('PART_NEW_BRAKES','PARTS_NEW','فرامل','Brakes','work_order','subcategory','parts_direct_cost',50),
  ('PART_NEW_AC','PARTS_NEW','تبريد وتكييف','Cooling & A/C','work_order','subcategory','parts_direct_cost',60),
  ('PART_NEW_GLASS','PARTS_NEW','زجاج ومرايا','Glass & Mirrors','work_order','subcategory','parts_direct_cost',70),
  ('PART_USED_ENGINE','PARTS_USED','محرك وناقل حركة مستعمل','Used Engine & Transmission','work_order','subcategory','parts_direct_cost',10),
  ('PART_USED_BODY','PARTS_USED','هيكل وصدامات مستعملة','Used Body & Bumpers','work_order','subcategory','parts_direct_cost',20),
  ('PART_USED_ELECTRICAL','PARTS_USED','كهرباء وإلكترونيات مستعملة','Used Electrical & Electronics','work_order','subcategory','parts_direct_cost',30),
  ('PART_USED_SUSPENSION','PARTS_USED','تعليق ومقود مستعمل','Used Suspension & Steering','work_order','subcategory','parts_direct_cost',40),
  ('TRANSPORT_SHIP_LOCAL','TRANSPORT_SHIPPING','شحن محلي','Local Shipping','both','subcategory','transport_direct_cost',10),
  ('TRANSPORT_SHIP_INTL','TRANSPORT_SHIPPING','شحن دولي','International Shipping','both','subcategory','transport_direct_cost',20),
  ('TRANSPORT_SHIP_AIR','TRANSPORT_SHIPPING','شحن جوي','Air Freight','both','subcategory','transport_direct_cost',30),
  ('TRANSPORT_SHIP_SEA','TRANSPORT_SHIPPING','شحن بحري','Sea Freight','both','subcategory','transport_direct_cost',40),
  ('WORKSHOP_EQUIP_LIFT','WORKSHOP_EQUIP','رافعات المركبات','Vehicle Lifts','operating','subcategory','other_operating_expense',10),
  ('WORKSHOP_EQUIP_COMPRESSOR','WORKSHOP_EQUIP','ضواغط الهواء','Air Compressors','operating','subcategory','other_operating_expense',20),
  ('WORKSHOP_EQUIP_BOOTH','WORKSHOP_EQUIP','فرن الصبغ','Paint Booth','operating','subcategory','other_operating_expense',30),
  ('WORKSHOP_EQUIP_DIAG','WORKSHOP_EQUIP','أجهزة الفحص','Diagnostic Equipment','operating','subcategory','other_operating_expense',40),
  ('WORKSHOP_EQUIP_TOOLS','WORKSHOP_EQUIP','معدات وأدوات كهربائية','Power Tools','operating','subcategory','other_operating_expense',50),
  ('ADMIN_SOFT_ERP','ADMIN_SOFTWARE','نظام إدارة الورشة','Workshop ERP','operating','subcategory','administrative_expense',10),
  ('ADMIN_SOFT_CLOUD','ADMIN_SOFTWARE','خدمات سحابية','Cloud Services','operating','subcategory','administrative_expense',20),
  ('ADMIN_SOFT_SECURITY','ADMIN_SOFTWARE','برامج الحماية','Security Software','operating','subcategory','administrative_expense',30),
  ('ADMIN_SOFT_LICENSE','ADMIN_SOFTWARE','تراخيص البرامج','Software Licences','operating','subcategory','administrative_expense',40),
  ('HR_SALARY_TECH','HR_SALARY','رواتب الفنيين','Technician Salaries','operating','subcategory','salary_expense',10),
  ('HR_SALARY_SUPERVISOR','HR_SALARY','رواتب المشرفين','Supervisor Salaries','operating','subcategory','salary_expense',20),
  ('HR_SALARY_ADMIN','HR_SALARY','رواتب الإدارة','Administration Salaries','operating','subcategory','salary_expense',30)
on conflict (code) do update set
  parent_code=excluded.parent_code,
  name_ar=excluded.name_ar,
  name_en=excluded.name_en,
  expense_scope=excluded.expense_scope,
  category_type=excluded.category_type,
  accounting_mapping_key=excluded.accounting_mapping_key,
  sort_order=excluded.sort_order;

create or replace function public.apply_default_expense_category_template()
returns integer language plpgsql security definer set search_path=pg_catalog,public as $$
declare
  v_tenant uuid:=public.get_user_tenant_id();
  r record;
  v_parent public.expense_categories%rowtype;
  v_level integer;
begin
  if not public.expense_has_permission('expenses.manage_categories') then
    raise exception 'EXPENSE_PERMISSION_DENIED';
  end if;

  for v_level in 1..3 loop
    for r in
      select t.*
      from public.expense_category_template_items t
      where (v_level=1 and t.parent_code is null)
         or (v_level>1 and t.parent_code is not null)
      order by t.sort_order,t.code
    loop
      if v_level=1 then
        v_parent:=null;
      else
        select * into v_parent
        from public.expense_categories
        where tenant_id=v_tenant and lower(code)=lower(r.parent_code);
        if not found or v_parent.level<>v_level-1 then continue; end if;
      end if;

      insert into public.expense_categories(
        tenant_id,code,name,name_ar,name_en,parent_id,level,category_type,expense_scope,
        department_code,accounting_mapping_key,is_system,is_active,active,sort_order,created_by,updated_by)
      values(
        v_tenant,r.code,r.name_ar,r.name_ar,r.name_en,
        case when v_level=1 then null else v_parent.id end,
        v_level,r.category_type,r.expense_scope,
        case when v_level=1 then r.code else coalesce(v_parent.department_code,v_parent.code) end,
        r.accounting_mapping_key,true,true,true,r.sort_order,auth.uid(),auth.uid())
      -- Preserve tenant edits and disabled states; applying the template only
      -- fills missing nodes and never overwrites an existing category.
      on conflict(tenant_id,(lower(code))) where code is not null do nothing;
    end loop;
  end loop;

  return (select count(*) from public.expense_categories where tenant_id=v_tenant and is_system);
end $$;

revoke all on function public.apply_default_expense_category_template() from public,anon;
grant execute on function public.apply_default_expense_category_template() to authenticated;
