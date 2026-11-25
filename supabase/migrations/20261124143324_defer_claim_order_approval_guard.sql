-- Approval's BEFORE trigger inserts its work order before the claim's approved
-- status is visible to queries. Validate the claim dependency at transaction end
-- so that both records commit together, or both roll back. Keep the existing
-- identity, closed-claim, active-policy and exception-audit checks unchanged.
begin;

drop trigger job_order_workflow_claim_requirements on public.job_orders;

create constraint trigger job_order_workflow_claim_requirements
after insert or update on public.job_orders
deferrable initially deferred
for each row execute function app_private.guard_workflow_claim_order_requirements();

commit;
