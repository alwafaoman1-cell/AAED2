-- Enforce the existing job_orders SELECT policy in its definer search API.
-- No new business permission; preserve staff lookup, bounds, joins and output.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $lookup_guard$
declare original text; patched text;
begin
  original:=pg_get_functiondef('public.expense_work_order_search_rpc(text,integer)'::regprocedure);
  if md5(replace(original,chr(13),'')) <> '6d33d78c8b7bfd0e78c29573bfedce68' then
    raise exception 'EXPENSE_WORK_ORDER_LOOKUP_DEFINITION_DRIFT';end if;
  patched:=replace(original,
    'where j.tenant_id=public.get_user_tenant_id() and j.deleted_at is null',
    'where j.tenant_id=public.get_user_tenant_id() and j.deleted_at is null
    and auth.uid() is not null
    and public.get_user_role() <> ''customer''::public.app_role
    and not public.has_role(auth.uid(), ''customer''::public.app_role)');
  if patched=original then raise exception 'EXPENSE_LOOKUP_GUARD_NOT_CHANGED';end if;
  execute patched;
end $lookup_guard$;

-- Only unified-message-send's service client consumes this private table.
-- RLS stays enabled/default-deny; no artificial deny policy to hide its INFO.
-- Revoke unnecessary browser grants including TRUNCATE (not governed by RLS).
revoke all on table public.message_idempotency_keys from public,anon,authenticated;

