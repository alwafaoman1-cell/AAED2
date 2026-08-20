-- Enforce uniqueness for every new expense voucher without changing legacy
-- duplicates. Existing rows stay NULL; new inserts receive TRUE by default.

alter table public.expenses
  add column if not exists voucher_number_guarded boolean;

alter table public.expenses
  alter column voucher_number_guarded set default true;

create unique index if not exists expenses_new_voucher_number_uidx
  on public.expenses(tenant_id, lower(voucher_number))
  where voucher_number_guarded is true and voucher_number is not null;

create or replace function public.prevent_new_duplicate_expense_voucher()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.voucher_number_guarded is not true or nullif(trim(new.voucher_number), '') is null then
    return new;
  end if;

  if exists (
    select 1
    from public.expenses e
    where e.tenant_id = new.tenant_id
      and lower(e.voucher_number) = lower(new.voucher_number)
      and e.id is distinct from new.id
  ) then
    raise exception 'EXPENSE_VOUCHER_NUMBER_ALREADY_EXISTS: %', new.voucher_number
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists prevent_new_duplicate_expense_voucher_trigger on public.expenses;
create trigger prevent_new_duplicate_expense_voucher_trigger
before insert or update of voucher_number, voucher_number_guarded, tenant_id
on public.expenses
for each row execute function public.prevent_new_duplicate_expense_voucher();

comment on column public.expenses.voucher_number_guarded is
  'NULL for untouched legacy rows; TRUE for new rows protected by atomic voucher uniqueness.';
