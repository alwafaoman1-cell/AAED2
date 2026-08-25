-- Correct the shared expense template taxonomy without touching tenant-owned
-- categories or historical expenses. Fines belong under Government &
-- Regulatory, leaving the approved thirteen top-level departments.

update public.expense_category_template_items
set
  parent_code = 'GOV',
  category_type = 'category',
  expense_scope = 'operating',
  accounting_mapping_key = 'other_operating_expense',
  sort_order = 95
where code = 'FINES'
  and (
    parent_code is distinct from 'GOV'
    or category_type is distinct from 'category'
    or expense_scope is distinct from 'operating'
    or accounting_mapping_key is distinct from 'other_operating_expense'
    or sort_order is distinct from 95
  );

do $$
begin
  if (
    select count(*)
    from public.expense_category_template_items
    where parent_code is null
      and category_type = 'department'
  ) <> 13 then
    raise exception 'EXPENSE_TEMPLATE_DEPARTMENT_COUNT_INVALID';
  end if;

  if not exists (
    select 1
    from public.expense_category_template_items
    where code = 'FINES'
      and parent_code = 'GOV'
      and category_type = 'category'
  ) then
    raise exception 'EXPENSE_TEMPLATE_FINES_PARENT_INVALID';
  end if;
end
$$;

comment on table public.expense_category_template_items is
  'Manual bilingual expense template with thirteen top-level departments. Template application remains opt-in.';
