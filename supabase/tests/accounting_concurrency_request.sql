set role authenticated;
select set_config(
  'request.jwt.claims',
  jsonb_build_object(
    'sub', 'c1000000-0000-0000-0000-000000000011',
    'role', 'authenticated'
  )::text,
  false
);
select public.next_accounting_journal_number(
  'c2000000-0000-0000-0000-000000000001'
) as number;
