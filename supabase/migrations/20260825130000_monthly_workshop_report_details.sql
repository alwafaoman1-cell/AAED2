-- Cloud-only monthly workshop report details.
-- This is a read model only: no import, backfill, posting, or source mutation.

create or replace function public.monthly_workshop_overheads_rpc(
  p_from date,
  p_to date
) returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_summary jsonb;
  v_groups jsonb;
  v_rows jsonb;
  v_payroll jsonb;
begin
  if auth.uid() is null or v_tenant is null then
    raise exception 'ACCOUNTING_REPORT_AUTH_REQUIRED';
  end if;
  if p_from is null or p_to is null or p_from > p_to then
    raise exception 'INVALID_REPORT_PERIOD';
  end if;
  if not public.accounting_has_permission('accounting_reports.vehicle_profit_loss')
     and not public.accounting_has_permission('accounting_reports.admin') then
    raise exception 'ACCOUNTING_REPORT_PERMISSION_DENIED';
  end if;

  with eligible as (
    select
      e.id,
      e.voucher_number,
      e.date,
      e.description,
      e.beneficiary,
      e.payment_method,
      coalesce(s.name, e.beneficiary, '—') supplier_name,
      coalesce(nullif(e.subtotal, 0), e.amount, 0)::numeric subtotal,
      coalesce(e.vat_amount, 0)::numeric vat,
      coalesce(nullif(e.total, 0), nullif(e.subtotal, 0), e.amount, 0)::numeric total,
      e.accounting_mapping_key,
      coalesce(d.code, 'UNASSIGNED') department_code,
      coalesce(d.name_ar, 'غير مصنف') department_ar,
      coalesce(d.name_en, 'Unclassified') department_en,
      coalesce(cat.code, 'UNASSIGNED') category_code,
      coalesce(cat.name_ar, 'غير مصنف') category_ar,
      coalesce(cat.name_en, 'Unclassified') category_en,
      coalesce(sub.code, '') subcategory_code,
      coalesce(sub.name_ar, '') subcategory_ar,
      coalesce(sub.name_en, '') subcategory_en,
      lower(concat_ws(' ', e.accounting_mapping_key, d.code, cat.code, sub.code,
        d.name_ar, d.name_en, cat.name_ar, cat.name_en, sub.name_ar, sub.name_en,
        e.description)) classifier
    from public.expenses e
    left join public.suppliers s on s.id = e.supplier_id and s.tenant_id = e.tenant_id
    left join public.expense_categories d on d.id = e.department_id and d.tenant_id = e.tenant_id
    left join public.expense_categories cat on cat.id = e.expense_category_id and cat.tenant_id = e.tenant_id
    left join public.expense_categories sub on sub.id = e.subcategory_id and sub.tenant_id = e.tenant_id
    where e.tenant_id = v_tenant
      and e.date between p_from and p_to
      and e.deleted_at is null
      and e.archived_at is null
      and lower(coalesce(e.status, 'active')) not in ('cancelled','canceled','void','invalid','deleted')
      and (
        e.expense_scope = 'operating'
        or (e.work_order_id is null and e.vehicle_id is null and e.claim_id is null
            and nullif(e.linked_work_order_id, '') is null)
      )
  ), classified as (
    select *, case
      when accounting_mapping_key = 'salary_expense'
        or classifier ~ '(salary|payroll|wage|hr_salary|راتب|رواتب|أجور)' then 'salaries'
      when classifier ~ '(rent|lease|subscription|license|depreciation|إيجار|ايجار|اشتراك|رخص|استهلاك)' then 'fixed'
      when classifier ~ '(part|spare|قطع|غيار)' then 'unlinked_parts'
      when classifier ~ '(electric|water|telephone|internet|fuel|tool|maintenance|admin|utility|كهرب|ماء|هاتف|انترنت|وقود|أدوات|صيانة|إدار)' then 'operating'
      else 'other'
    end bucket
    from eligible
  )
  select jsonb_build_object(
    'subtotal', coalesce(sum(subtotal), 0),
    'vat', coalesce(sum(vat), 0),
    'total', coalesce(sum(total), 0),
    'salaries', coalesce(sum(subtotal) filter (where bucket = 'salaries'), 0),
    'fixed', coalesce(sum(subtotal) filter (where bucket = 'fixed'), 0),
    'operating', coalesce(sum(subtotal) filter (where bucket = 'operating'), 0),
    'unlinked_parts', coalesce(sum(subtotal) filter (where bucket = 'unlinked_parts'), 0),
    'other', coalesce(sum(subtotal) filter (where bucket = 'other'), 0),
    'count', count(*)
  ) into v_summary from classified;

  with eligible as (
    select e.id, coalesce(nullif(e.subtotal,0),e.amount,0)::numeric subtotal,
      coalesce(e.vat_amount,0)::numeric vat,
      coalesce(nullif(e.total,0),nullif(e.subtotal,0),e.amount,0)::numeric total,
      coalesce(d.code,'UNASSIGNED') department_code, coalesce(d.name_ar,'غير مصنف') department_ar,
      coalesce(d.name_en,'Unclassified') department_en,
      coalesce(cat.code,'UNASSIGNED') category_code, coalesce(cat.name_ar,'غير مصنف') category_ar,
      coalesce(cat.name_en,'Unclassified') category_en,
      coalesce(sub.code,'') subcategory_code, coalesce(sub.name_ar,'') subcategory_ar,
      coalesce(sub.name_en,'') subcategory_en
    from public.expenses e
    left join public.expense_categories d on d.id=e.department_id and d.tenant_id=e.tenant_id
    left join public.expense_categories cat on cat.id=e.expense_category_id and cat.tenant_id=e.tenant_id
    left join public.expense_categories sub on sub.id=e.subcategory_id and sub.tenant_id=e.tenant_id
    where e.tenant_id=v_tenant and e.date between p_from and p_to
      and e.deleted_at is null and e.archived_at is null
      and lower(coalesce(e.status,'active')) not in ('cancelled','canceled','void','invalid','deleted')
      and (e.expense_scope='operating' or (e.work_order_id is null and e.vehicle_id is null and e.claim_id is null and nullif(e.linked_work_order_id,'') is null))
  ), grouped as (
    select department_code,department_ar,department_en,category_code,category_ar,category_en,
      subcategory_code,subcategory_ar,subcategory_en,count(*) expense_count,
      sum(subtotal)::numeric subtotal,sum(vat)::numeric vat,sum(total)::numeric total
    from eligible group by 1,2,3,4,5,6,7,8,9
    order by department_ar,category_ar,subcategory_ar
  ) select coalesce(jsonb_agg(to_jsonb(grouped)),'[]'::jsonb) into v_groups from grouped;

  with rows as (
    select e.id,e.voucher_number,e.date,e.description,e.beneficiary,e.payment_method,
      coalesce(s.name,e.beneficiary,'—') supplier_name,
      coalesce(d.name_ar,'غير مصنف') department_ar,coalesce(d.name_en,'Unclassified') department_en,
      coalesce(cat.name_ar,'غير مصنف') category_ar,coalesce(cat.name_en,'Unclassified') category_en,
      coalesce(sub.name_ar,'') subcategory_ar,coalesce(sub.name_en,'') subcategory_en,
      coalesce(nullif(e.subtotal,0),e.amount,0)::numeric subtotal,
      coalesce(e.vat_amount,0)::numeric vat,
      coalesce(nullif(e.total,0),nullif(e.subtotal,0),e.amount,0)::numeric total,
      e.accounting_mapping_key,
      lower(concat_ws(' ',e.accounting_mapping_key,d.code,cat.code,sub.code,d.name_ar,d.name_en,cat.name_ar,cat.name_en,sub.name_ar,sub.name_en,e.description)) classifier
    from public.expenses e
    left join public.suppliers s on s.id=e.supplier_id and s.tenant_id=e.tenant_id
    left join public.expense_categories d on d.id=e.department_id and d.tenant_id=e.tenant_id
    left join public.expense_categories cat on cat.id=e.expense_category_id and cat.tenant_id=e.tenant_id
    left join public.expense_categories sub on sub.id=e.subcategory_id and sub.tenant_id=e.tenant_id
    where e.tenant_id=v_tenant and e.date between p_from and p_to
      and e.deleted_at is null and e.archived_at is null
      and lower(coalesce(e.status,'active')) not in ('cancelled','canceled','void','invalid','deleted')
      and (e.expense_scope='operating' or (e.work_order_id is null and e.vehicle_id is null and e.claim_id is null and nullif(e.linked_work_order_id,'') is null))
    order by e.date,e.voucher_number,e.id
  )
  select coalesce(jsonb_agg(to_jsonb(rows)-'classifier'),'[]'::jsonb),
    coalesce(jsonb_agg(to_jsonb(rows)-'classifier') filter (
      where accounting_mapping_key='salary_expense' or classifier ~ '(salary|payroll|wage|hr_salary|راتب|رواتب|أجور)'
    ),'[]'::jsonb)
  into v_rows,v_payroll from rows;

  return jsonb_build_object(
    'summary',coalesce(v_summary,'{}'::jsonb),
    'groups',coalesce(v_groups,'[]'::jsonb),
    'expenseRows',coalesce(v_rows,'[]'::jsonb),
    'payrollRows',coalesce(v_payroll,'[]'::jsonb),
    'basis','operating expenses by voucher date; VAT is reported but excluded from profit',
    'generatedAt',now()
  );
end;
$$;

revoke all on function public.monthly_workshop_overheads_rpc(date,date) from public, anon;
grant execute on function public.monthly_workshop_overheads_rpc(date,date) to authenticated;

create index if not exists idx_monthly_workshop_operating_expenses
  on public.expenses (tenant_id, date, department_id, expense_category_id, subcategory_id)
  where deleted_at is null and archived_at is null and expense_scope='operating';

comment on function public.monthly_workshop_overheads_rpc(date,date) is
  'Tenant-scoped cloud monthly overhead, payroll, and category detail. No source mutation or vehicle allocation.';
