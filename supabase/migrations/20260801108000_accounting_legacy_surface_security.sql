-- Close legacy accounting surfaces that predate the cloud ledger foundation.
-- Non-destructive: preserves tables, views, data, and existing tenant policies.

alter table public.accounting_receipts enable row level security;
revoke all on table public.accounting_receipts from public, anon;
grant select, insert, update, delete on table public.accounting_receipts to authenticated;

alter view public.accounting_claims_summary_view set (security_invoker = true);
alter view public.accounting_work_order_profit_view set (security_invoker = true);

revoke all on table public.accounting_claims_summary_view from public, anon;
revoke all on table public.accounting_work_order_profit_view from public, anon;
grant select on table public.accounting_claims_summary_view to authenticated;
grant select on table public.accounting_work_order_profit_view to authenticated;
