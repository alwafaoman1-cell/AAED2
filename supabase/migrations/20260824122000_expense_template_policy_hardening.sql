-- Expense template policy hardening (Development first).
-- Security-only correction: no expense/category data is inserted, updated,
-- classified, posted, or backfilled by this migration.

drop policy if exists expense_template_read on public.expense_category_template_items;
create policy expense_template_read
  on public.expense_category_template_items
  for select
  to authenticated
  using (auth.uid() is not null);

revoke all on public.expense_category_template_items from public, anon;
grant select on public.expense_category_template_items to authenticated;
