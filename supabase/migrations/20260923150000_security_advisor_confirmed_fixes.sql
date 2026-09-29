-- Confirmed Security Advisor hardening.
--
-- This migration changes function configuration and EXECUTE privileges only.
-- It does not read, insert, update, delete, or backfill operational data.

-- Pin search_path on the functions currently reported by Supabase's
-- function_search_path_mutable advisor. Development and Production are not at
-- the same migration level, so only harden signatures that actually exist.
-- pg_catalog is listed first so built-in names cannot be shadowed.
do $security$
declare
  function_signature text;
  function_oid regprocedure;
begin
  foreach function_signature in array array[
    'public.find_vehicle_by_vin(text)',
    'public.accounting_dashboard_summary_rpc(date,date,text,uuid)',
    'public.accounting_reports_summary_rpc(date,date)',
    'public.touch_unified_operational_updated_at()',
    'public.touch_vehicle_media_updated_at()',
    'public.touch_vehicle_entries_updated_at()'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is not null then
      execute format(
        'alter function %s set search_path = pg_catalog, public',
        function_oid
      );
    end if;
  end loop;
end;
$security$;

-- Trigger functions are invoked by PostgreSQL through their trigger objects.
-- Browser roles never need direct RPC execution rights on them. Missing
-- signatures are skipped instead of manufacturing schema objects.
do $security$
declare
  function_signature text;
  function_oid regprocedure;
begin
  foreach function_signature in array array[
    'public.audit_expense_duplicate_override()',
    'public.guard_expense_duplicate_document()',
    'public.sync_expense_financial_totals()',
    'public.sync_profile_role_to_user_roles()'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is not null then
      execute format(
        'revoke execute on function %s from public, anon, authenticated',
        function_oid
      );
    end if;
  end loop;
end;
$security$;

-- These two public customer-signature entry points were introduced after the
-- original explicit privilege matrix. Keep existing token-validated wrappers
-- public and make the intended role matrix explicit.
do $security$
declare
  function_signature text;
  function_oid regprocedure;
begin
  foreach function_signature in array array[
    'public.get_vehicle_entry_for_customer_signature(text)',
    'public.submit_vehicle_entry_customer_signature(text,text,text,text)'
  ]
  loop
    function_oid := to_regprocedure(function_signature);
    if function_oid is not null then
      execute format(
        'revoke execute on function %s from public, anon, authenticated',
        function_oid
      );
      execute format(
        'grant execute on function %s to anon, authenticated, service_role',
        function_oid
      );
    end if;
  end loop;
end;
$security$;
