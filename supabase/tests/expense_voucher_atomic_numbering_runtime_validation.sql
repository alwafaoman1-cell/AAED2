begin;

create temporary table expense_voucher_runtime_results(
  test_name text primary key,
  passed boolean not null
) on commit drop;
grant all on expense_voucher_runtime_results to authenticated, anon;

create or replace function pg_temp.assert_true(p_name text, p_condition boolean)
returns void language plpgsql as $$
begin
  if not coalesce(p_condition, false) then
    raise exception 'TEST_FAILED: %', p_name;
  end if;
  insert into expense_voucher_runtime_results values(p_name, true);
end;
$$;

create or replace function pg_temp.expect_error(p_name text, p_sql text, p_fragment text)
returns void language plpgsql as $$
declare v_message text;
begin
  begin
    execute p_sql;
    raise exception 'EXPECTED_ERROR_NOT_RAISED';
  exception when others then
    v_message := sqlerrm;
    if v_message = 'EXPECTED_ERROR_NOT_RAISED' or position(p_fragment in v_message) = 0 then
      raise exception 'TEST_FAILED: %, got %', p_name, v_message;
    end if;
  end;
  insert into expense_voucher_runtime_results values(p_name, true);
end;
$$;

insert into public.tenants(id,name,slug)
values('f9200000-0000-4000-8000-000000000001','Voucher Runtime','voucher-runtime');
insert into auth.users(id,email,raw_user_meta_data)
values(
  'f9200000-0000-4000-8000-000000000011',
  'voucher-runtime@invalid.test',
  '{"tenant_id":"f9200000-0000-4000-8000-000000000001","full_name":"Voucher Runtime","role":"admin"}'
);

set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"f9200000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);

select pg_temp.assert_true(
  'first_number',
  public.next_expense_voucher_number('PAY', 2026, 4) = 'PAY-2026-0001'
);
select pg_temp.assert_true(
  'second_number',
  public.next_expense_voucher_number('PAY', 2026, 4) = 'PAY-2026-0002'
);
reset role;
select pg_temp.assert_true(
  'sequence_advanced',
  (select last_number = 2 from public.expense_voucher_sequences
   where tenant_id='f9200000-0000-4000-8000-000000000001'
     and voucher_year=2026 and prefix='PAY')
);
set local role authenticated;
select set_config(
  'request.jwt.claims',
  '{"sub":"f9200000-0000-4000-8000-000000000011","role":"authenticated"}',
  true
);

insert into public.expenses(id,tenant_id,voucher_number,amount)
values(
  'f9200000-0000-4000-8000-000000000101',
  'f9200000-0000-4000-8000-000000000001',
  'PAY-2026-0001',
  1
);
select pg_temp.expect_error(
  'new_duplicate_blocked',
  $$insert into public.expenses(id,tenant_id,voucher_number,amount)
    values('f9200000-0000-4000-8000-000000000102','f9200000-0000-4000-8000-000000000001','PAY-2026-0001',1)$$,
  'EXPENSE_VOUCHER_NUMBER_ALREADY_EXISTS'
);

-- Simulate untouched historical duplicates. The migration must not rewrite them.
insert into public.expenses(id,tenant_id,voucher_number,amount,voucher_number_guarded)
values
 ('f9200000-0000-4000-8000-000000000103','f9200000-0000-4000-8000-000000000001','PAY-2025-0007',1,null),
 ('f9200000-0000-4000-8000-000000000104','f9200000-0000-4000-8000-000000000001','PAY-2025-0007',1,null);
select pg_temp.assert_true(
  'legacy_duplicates_untouched',
  (select count(*)=2 from public.expenses where voucher_number='PAY-2025-0007')
);
select pg_temp.expect_error(
  'new_number_cannot_reuse_legacy',
  $$insert into public.expenses(id,tenant_id,voucher_number,amount)
    values('f9200000-0000-4000-8000-000000000105','f9200000-0000-4000-8000-000000000001','PAY-2025-0007',1)$$,
  'EXPENSE_VOUCHER_NUMBER_ALREADY_EXISTS'
);

reset role;
set local role anon;
select pg_temp.expect_error(
  'anonymous_denied',
  $$select public.next_expense_voucher_number('PAY',2026,4)$$,
  'permission denied'
);
reset role;

select count(*) as passed_tests,
       jsonb_agg(test_name order by test_name) as tests
from expense_voucher_runtime_results;

rollback;
