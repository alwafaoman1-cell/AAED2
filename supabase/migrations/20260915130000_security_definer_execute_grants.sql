-- Replace PostgreSQL's implicit PUBLIC execute grants on SECURITY DEFINER
-- functions with an explicit role matrix. This migration changes privileges
-- only; it does not replace functions, triggers, or operational data.

-- New functions must opt into their intended callers explicitly.
alter default privileges for role postgres in schema public
  revoke execute on functions from public;

-- Public customer links. These functions validate an opaque token/key and are
-- called directly by the current public React routes.
revoke execute on function public.get_public_invoice(text) from public, anon;
revoke execute on function public.get_public_tracking(text) from public, anon;
revoke execute on function public.get_public_work_order(text, text) from public, anon;
revoke execute on function public.get_work_order_for_sign(text) from public, anon;
revoke execute on function public.log_public_tracking_open(text, text, text, text) from public, anon;
revoke execute on function public.resolve_tenant_by_hostname(text) from public, anon;
revoke execute on function public.submit_customer_feedback(text, integer, text, text) from public, anon;
revoke execute on function public.submit_portal_note(text, text, text, text, text) from public, anon;
revoke execute on function public.submit_work_order_signature(text, text, text, text, text) from public, anon;

grant execute on function public.get_public_invoice(text) to anon, authenticated, service_role;
grant execute on function public.get_public_tracking(text) to anon, authenticated, service_role;
grant execute on function public.get_public_work_order(text, text) to anon, authenticated, service_role;
grant execute on function public.get_work_order_for_sign(text) to anon, authenticated, service_role;
grant execute on function public.log_public_tracking_open(text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.resolve_tenant_by_hostname(text) to anon, authenticated, service_role;
grant execute on function public.submit_customer_feedback(text, integer, text, text) to anon, authenticated, service_role;
grant execute on function public.submit_portal_note(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.submit_work_order_signature(text, text, text, text, text) to anon, authenticated, service_role;

-- Signed-in application operations. Tenant/role checks remain in the existing
-- function bodies and underlying RLS policies.
revoke execute on function public.admin_reopen_signature(uuid) from public, anon;
revoke execute on function public.enqueue_customer_notification(uuid, uuid, text, text, text, boolean) from public, anon;
revoke execute on function public.find_vehicle_by_plate(text, text, text) from public, anon;
revoke execute on function public.next_vehicle_entry_number(integer) from public, anon;
revoke execute on function public.review_portal_note(uuid, text) from public, anon;
revoke execute on function public.seed_default_notification_settings(uuid) from public, anon;

grant execute on function public.admin_reopen_signature(uuid) to authenticated, service_role;
grant execute on function public.enqueue_customer_notification(uuid, uuid, text, text, text, boolean) to authenticated, service_role;
grant execute on function public.find_vehicle_by_plate(text, text, text) to authenticated, service_role;
grant execute on function public.next_vehicle_entry_number(integer) to authenticated, service_role;
grant execute on function public.review_portal_note(uuid, text) to authenticated, service_role;
grant execute on function public.seed_default_notification_settings(uuid) to authenticated, service_role;

-- Provider/internal operations. Browser roles must never invoke these directly.
revoke execute on function public.reserve_message_idempotency(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.get_supplement_request_by_token(text) from public, anon, authenticated;
revoke execute on function public.submit_supplement_decision(text, jsonb, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.next_customer_code(uuid, integer) from public, anon, authenticated;

grant execute on function public.reserve_message_idempotency(uuid, text, text, text, text) to service_role;
grant execute on function public.get_supplement_request_by_token(text) to service_role;
grant execute on function public.submit_supplement_decision(text, jsonb, text, text, text, text) to service_role;
grant execute on function public.next_customer_code(uuid, integer) to service_role;

-- These legacy backing functions exist only on installations that previously
-- wrapped the public entry points. Keep their privileges locked down when they
-- exist, but do not fail a clean/current installation where they were never
-- created or have already been removed.
do $$
begin
  if to_regprocedure('public.get_public_tracking_base_20260721(text)') is not null then
    execute 'revoke execute on function public.get_public_tracking_base_20260721(text) from public, anon, authenticated';
    execute 'grant execute on function public.get_public_tracking_base_20260721(text) to service_role';
  end if;

  if to_regprocedure('public.get_work_order_for_sign_base_20260721(text)') is not null then
    execute 'revoke execute on function public.get_work_order_for_sign_base_20260721(text) from public, anon, authenticated';
    execute 'grant execute on function public.get_work_order_for_sign_base_20260721(text) to service_role';
  end if;

  if to_regprocedure('public.submit_work_order_signature_base_20260721(text, text, text, text, text)') is not null then
    execute 'revoke execute on function public.submit_work_order_signature_base_20260721(text, text, text, text, text) from public, anon, authenticated';
    execute 'grant execute on function public.submit_work_order_signature_base_20260721(text, text, text, text, text) to service_role';
  end if;
end;
$$;

-- Trigger-only functions. Revoking direct browser execution does not disable
-- triggers; PostgreSQL invokes the trigger function through its trigger object.
revoke execute on function public.assign_customer_code() from public, anon, authenticated;
revoke execute on function public.audit_expense_category_change() from public, anon, authenticated;
revoke execute on function public.block_payment_in_expenses() from public, anon, authenticated;
revoke execute on function public.derive_expense_work_order_context() from public, anon, authenticated;
revoke execute on function public.enforce_job_order_type() from public, anon, authenticated;
revoke execute on function public.enforce_supplement_execution_rule() from public, anon, authenticated;
revoke execute on function public.ensure_portal_token() from public, anon, authenticated;
revoke execute on function public.notify_on_insurance_approved() from public, anon, authenticated;
revoke execute on function public.notify_on_job_order_status() from public, anon, authenticated;
revoke execute on function public.notify_on_supplement_pending() from public, anon, authenticated;
revoke execute on function public.prevent_self_role_escalation() from public, anon, authenticated;
revoke execute on function public.prevent_used_expense_category_delete() from public, anon, authenticated;
revoke execute on function public.protect_insurance_invoice_issued_at() from public, anon, authenticated;
revoke execute on function public.protect_signed_supplement_request() from public, anon, authenticated;
revoke execute on function public.recalc_invoice_on_insert() from public, anon, authenticated;
revoke execute on function public.refresh_sales_doc_last_payment() from public, anon, authenticated;
revoke execute on function public.sync_claim_from_job_order() from public, anon, authenticated;
revoke execute on function public.sync_job_order_claim_link() from public, anon, authenticated;
revoke execute on function public.sync_job_order_from_claim() from public, anon, authenticated;
revoke execute on function public.sync_wo_insurance_approval_from_claim() from public, anon, authenticated;
revoke execute on function public.touch_job_order_for_expense() from public, anon, authenticated;
revoke execute on function public.validate_expense_category_tree() from public, anon, authenticated;
revoke execute on function public.validate_insurance_settlement_discount() from public, anon, authenticated;
