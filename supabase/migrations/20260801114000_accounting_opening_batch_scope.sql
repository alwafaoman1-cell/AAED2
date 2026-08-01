-- Preserve legacy uniqueness while allowing separate opening-balance batches.
alter table public.accounting_opening_balances
  drop constraint if exists accounting_opening_balances_unique;
drop index if exists public.accounting_opening_balances_scope_unique;

create unique index if not exists accounting_opening_balances_batch_scope_unique
  on public.accounting_opening_balances(
    tenant_id,
    fiscal_year_id,
    coalesce(batch_id,'00000000-0000-0000-0000-000000000000'::uuid),
    account_id,
    coalesce(cost_center_id,'00000000-0000-0000-0000-000000000000'::uuid)
  );

comment on index public.accounting_opening_balances_batch_scope_unique is
  'One opening-balance line per account/cost-center inside each batch; null batch preserves legacy scope.';
