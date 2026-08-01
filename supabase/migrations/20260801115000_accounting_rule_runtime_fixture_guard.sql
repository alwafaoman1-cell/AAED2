-- Permit active rules only for isolated database runtime validation sessions.
-- Frontend/PostgREST sessions retain a fail-closed activation guard.
create or replace function public.accounting_defer_posting_rule_activation()
returns trigger language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.is_active and (tg_op='INSERT' or old.is_active is distinct from true)
     and not (
       session_user in ('postgres','supabase_admin')
       and current_setting('app.accounting_runtime_validation',true)='on'
     ) then
    raise exception 'ACCOUNTING_POSTING_RULE_ACTIVATION_DEFERRED_PHASE_3';
  end if;
  return new;
end;
$$;
revoke all on function public.accounting_defer_posting_rule_activation() from public,anon,authenticated;
