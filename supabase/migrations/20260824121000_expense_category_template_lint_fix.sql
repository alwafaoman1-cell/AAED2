-- Remove the PL/pgSQL shadowed-variable warning from the manual template
-- application function. No data is changed and the template remains opt-in.

create or replace function public.apply_default_expense_category_template()
returns integer
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  r record;
  v_parent public.expense_categories%rowtype;
begin
  if not public.expense_has_permission('expenses.manage_categories') then
    raise exception 'EXPENSE_PERMISSION_DENIED';
  end if;

  for v_level in 1..3 loop
    for r in
      select t.*
      from public.expense_category_template_items t
      where (v_level = 1 and t.parent_code is null)
         or (v_level > 1 and t.parent_code is not null)
      order by t.sort_order, t.code
    loop
      if v_level = 1 then
        v_parent := null;
      else
        select * into v_parent
        from public.expense_categories
        where tenant_id = v_tenant
          and lower(code) = lower(r.parent_code);
        if not found or v_parent.level <> v_level - 1 then
          continue;
        end if;
      end if;

      insert into public.expense_categories(
        tenant_id, code, name, name_ar, name_en, parent_id, level,
        category_type, expense_scope, department_code,
        accounting_mapping_key, is_system, is_active, active, sort_order,
        created_by, updated_by
      ) values (
        v_tenant, r.code, r.name_ar, r.name_ar, r.name_en,
        case when v_level = 1 then null else v_parent.id end,
        v_level, r.category_type, r.expense_scope,
        case
          when v_level = 1 then r.code
          else coalesce(v_parent.department_code, v_parent.code)
        end,
        r.accounting_mapping_key, true, true, true, r.sort_order,
        auth.uid(), auth.uid()
      )
      on conflict (tenant_id, (lower(code))) where code is not null do nothing;
    end loop;
  end loop;

  return (
    select count(*)
    from public.expense_categories
    where tenant_id = v_tenant and is_system
  );
end
$$;

revoke all on function public.apply_default_expense_category_template() from public, anon;
grant execute on function public.apply_default_expense_category_template() to authenticated;

comment on function public.apply_default_expense_category_template() is
  'Manual tenant-scoped application only. Never invoked by migration or application boot.';
