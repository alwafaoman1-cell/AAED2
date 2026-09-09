-- Security Advisor hotfix for the legacy work-order renumber audit table.
-- Additive security-only change: no work-order or audit data is modified.

begin;

alter table public.work_order_number_renumber_audit enable row level security;

drop policy if exists "tenant read work order renumber audit"
  on public.work_order_number_renumber_audit;
create policy "tenant read work order renumber audit"
  on public.work_order_number_renumber_audit
  for select
  to authenticated
  using (tenant_id = public.get_user_tenant_id());

revoke all on table public.work_order_number_renumber_audit from public, anon;
grant select on table public.work_order_number_renumber_audit to authenticated;

commit;
