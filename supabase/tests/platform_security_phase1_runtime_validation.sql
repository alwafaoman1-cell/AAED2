-- Read-only runtime validation for the first platform security phase.
-- Safe to run repeatedly after the two 20260915 hardening migrations.

do $$
declare
  invalid_view_count integer;
  unexpected_anon_function_count integer;
  function_oid regprocedure;
begin
  select count(*)
  into invalid_view_count
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in (
      'vehicle_duplicates',
      'vehicle_identity_duplicate_report',
      'completed_work_orders_without_invoice_view',
      'overdue_invoices_view'
    )
    and (
      not coalesce(c.reloptions, '{}'::text[]) @> array['security_invoker=true']
      or has_table_privilege('anon', format('public.%I', c.relname), 'select')
      or not has_table_privilege('authenticated', format('public.%I', c.relname), 'select')
    );

  if invalid_view_count <> 0 then
    raise exception 'legacy reporting view privilege validation failed: %', invalid_view_count;
  end if;

  select count(*)
  into unexpected_anon_function_count
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.prosecdef
    and has_function_privilege('anon', p.oid, 'execute')
    and p.proname not in (
      'get_public_invoice',
      'get_public_tracking',
      'get_public_work_order',
      'get_vehicle_entry_for_customer_signature',
      'get_work_order_for_sign',
      'log_public_tracking_open',
      'resolve_tenant_by_hostname',
      'submit_customer_feedback',
      'submit_portal_note',
      'submit_vehicle_entry_customer_signature',
      'submit_work_order_signature'
    );

  if unexpected_anon_function_count <> 0 then
    raise exception 'unexpected anon SECURITY DEFINER functions: %', unexpected_anon_function_count;
  end if;

  if has_function_privilege(
    'anon',
    'public.reserve_message_idempotency(uuid,text,text,text,text)',
    'execute'
  ) then
    raise exception 'provider idempotency function is callable by anon';
  end if;

  if has_function_privilege(
    'authenticated',
    'public.reserve_message_idempotency(uuid,text,text,text,text)',
    'execute'
  ) then
    raise exception 'provider idempotency function is callable by authenticated';
  end if;

  if not has_function_privilege(
    'authenticated',
    'public.next_vehicle_entry_number(integer)',
    'execute'
  ) then
    raise exception 'vehicle entry numbering lost authenticated access';
  end if;

  foreach function_oid in array array[
    to_regprocedure('public.audit_expense_duplicate_override()'),
    to_regprocedure('public.guard_expense_duplicate_document()'),
    to_regprocedure('public.sync_expense_financial_totals()')
  ]
  loop
    if function_oid is not null and (
      has_function_privilege('anon', function_oid, 'execute')
      or has_function_privilege('authenticated', function_oid, 'execute')
    ) then
      raise exception 'expense trigger function is directly executable: %', function_oid;
    end if;
  end loop;
end
$$;

select 'platform security phase 1 runtime validation passed' as result;
