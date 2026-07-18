alter table public.expenses
  add column if not exists supplier_id uuid;

create index if not exists idx_expenses_supplier_id
  on public.expenses(supplier_id);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'expenses_supplier_id_fkey'
      and conrelid = 'public.expenses'::regclass
  ) then
    alter table public.expenses
      add constraint expenses_supplier_id_fkey
      foreign key (supplier_id)
      references public.suppliers(id)
      on delete set null;
  end if;
end $$;
