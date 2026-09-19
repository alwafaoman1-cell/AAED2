-- Harden legacy reporting and duplicate-detection views without changing data
-- or business logic. SECURITY INVOKER makes the underlying table RLS policies
-- apply to the caller instead of the view owner.

alter view if exists public.vehicle_duplicates
  set (security_invoker = true);

alter view if exists public.vehicle_identity_duplicate_report
  set (security_invoker = true);

alter view if exists public.completed_work_orders_without_invoice_view
  set (security_invoker = true);

alter view if exists public.overdue_invoices_view
  set (security_invoker = true);

revoke all on table public.vehicle_duplicates from anon, public;
revoke all on table public.vehicle_identity_duplicate_report from anon, public;
revoke all on table public.completed_work_orders_without_invoice_view from anon, public;
revoke all on table public.overdue_invoices_view from anon, public;

grant select on table public.vehicle_duplicates to authenticated;
grant select on table public.vehicle_identity_duplicate_report to authenticated;
grant select on table public.completed_work_orders_without_invoice_view to authenticated;
grant select on table public.overdue_invoices_view to authenticated;

grant select on table public.vehicle_duplicates to service_role;
grant select on table public.vehicle_identity_duplicate_report to service_role;
grant select on table public.completed_work_orders_without_invoice_view to service_role;
grant select on table public.overdue_invoices_view to service_role;
