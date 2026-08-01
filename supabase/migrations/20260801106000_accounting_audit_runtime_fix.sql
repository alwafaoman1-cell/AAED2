-- Fix audit trigger runtime access to OLD/NEW fields during INSERT/DELETE.
-- Non-destructive: replaces the trigger function only.

create or replace function public.accounting_write_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_tenant uuid;
  v_entity uuid;
  v_action text;
  v_before jsonb;
  v_after jsonb;
  v_old_status text;
  v_new_status text;
begin
  v_before := case when tg_op = 'INSERT' then null else to_jsonb(old) end;
  v_after := case when tg_op = 'DELETE' then null else to_jsonb(new) end;
  v_tenant := coalesce((v_after->>'tenant_id')::uuid, (v_before->>'tenant_id')::uuid);
  v_entity := coalesce(nullif(v_after->>'id', '')::uuid, nullif(v_before->>'id', '')::uuid);
  v_old_status := case when tg_op = 'INSERT' then null else v_before->>'status' end;
  v_new_status := case when tg_op = 'DELETE' then null else v_after->>'status' end;
  v_action := lower(tg_op) || ':' || tg_table_name;

  if tg_table_name = 'accounting_journal_entries' then
    if tg_op = 'INSERT' then
      v_action := 'journal.create';
    elsif tg_op = 'UPDATE' and v_old_status is distinct from v_new_status then
      v_action := case v_new_status
        when 'approved' then 'journal.approve'
        when 'posted' then case when v_after->>'entry_type' = 'reversal' then 'journal.reverse' else 'journal.post' end
        when 'reversed' then 'journal.mark_reversed'
        when 'void' then 'journal.void'
        else 'journal.status_change'
      end;
    elsif tg_op = 'UPDATE' then
      v_action := 'journal.update_draft';
    end if;
  elsif tg_table_name = 'accounting_accounts' then
    if tg_op = 'INSERT' then
      v_action := 'account.create';
    elsif tg_op = 'UPDATE' and coalesce((v_before->>'is_active')::boolean, false)
          and not coalesce((v_after->>'is_active')::boolean, false) then
      v_action := 'account.deactivate';
    elsif tg_op = 'UPDATE' and not coalesce((v_before->>'is_active')::boolean, false)
          and coalesce((v_after->>'is_active')::boolean, false) then
      v_action := 'account.activate';
    elsif tg_op = 'UPDATE' then
      v_action := 'account.update';
    end if;
  elsif tg_table_name in ('accounting_periods', 'accounting_fiscal_years')
        and tg_op = 'UPDATE'
        and v_old_status is distinct from v_new_status then
    v_action := case when tg_table_name = 'accounting_fiscal_years' then 'fiscal_year.' else 'period.' end
      || case v_new_status when 'open' then 'reopen' when 'closed' then 'close' else 'lock' end;
  elsif tg_table_name = 'accounting_account_mappings' then
    v_action := case
      when tg_op = 'INSERT' then 'mapping.create'
      when tg_op = 'UPDATE' then 'mapping.change'
      else 'mapping.delete'
    end;
  elsif tg_table_name = 'accounting_opening_balances' then
    v_action := 'opening_balance.' || lower(tg_op);
  end if;

  insert into public.accounting_audit_logs(
    tenant_id, user_id, action, entity_type, entity_id,
    before_snapshot, after_snapshot, reason
  ) values (
    v_tenant, auth.uid(), v_action, tg_table_name, v_entity,
    v_before, v_after, nullif(current_setting('app.accounting_reason', true), '')
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function public.accounting_write_audit()
  from public, anon, authenticated;
