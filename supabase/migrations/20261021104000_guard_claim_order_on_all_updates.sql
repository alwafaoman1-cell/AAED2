-- enforce_job_order_type may infer claim_id while updating insurance_company
-- alone. An UPDATE OF column list does not fire for columns changed by another
-- BEFORE trigger, so inspect the final NEW row on every update.
-- The guard function returns immediately when claim/tenant/vehicle/parent and
-- deletion state are unchanged; existing orders are not modified here.
drop trigger if exists trg_guard_single_primary_claim_order on public.job_orders;
create trigger trg_guard_single_primary_claim_order
before insert or update on public.job_orders
for each row execute function app_private.guard_one_primary_work_order_per_claim();
