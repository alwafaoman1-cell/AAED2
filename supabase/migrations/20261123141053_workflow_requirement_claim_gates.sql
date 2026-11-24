-- Approval may be bypassed as a dependency; no approved status or amount is invented.
begin;
-- Nullable provenance scopes the existing full claim wizard's completeness
-- rules without imposing them on intake/import/detail-created pending drafts.
-- Its value never grants an exception; the current locked policy decides.
alter table public.insurance_claims add column workflow_requirement_revision bigint
  check(workflow_requirement_revision is null or workflow_requirement_revision>=0);
create function app_private.guard_claim_workflow_requirement_provenance()
returns trigger language plpgsql set search_path='' as $$
begin
  if new.workflow_requirement_revision is distinct from old.workflow_requirement_revision then
    raise exception 'WORKFLOW_CLAIM_PROVENANCE_IMMUTABLE';
  end if;
  return new;
end $$;
revoke all on function app_private.guard_claim_workflow_requirement_provenance() from public,anon,authenticated,service_role;
create trigger claim_workflow_requirement_provenance before update on public.insurance_claims
for each row execute function app_private.guard_claim_workflow_requirement_provenance();

create or replace function app_private.guard_workflow_claim_order_requirements()
returns trigger language plpgsql security definer set search_path='' as $$
declare c public.insurance_claims;
begin
  if new.claim_id is null or new.deleted_at is not null then return new; end if;
  if tg_op='UPDATE' and new.claim_id is not distinct from old.claim_id
    and new.tenant_id is not distinct from old.tenant_id
    and new.status is not distinct from old.status and old.deleted_at is null then return new; end if;
  select * into c from public.insurance_claims where id=new.claim_id and tenant_id=new.tenant_id and deleted_at is null;
  if not found then raise exception 'WORKFLOW_CLAIM_IDENTITY_REQUIRED'; end if;
  if c.status::text in ('cancelled','rejected') then raise exception 'WORKFLOW_CLAIM_CLOSED'; end if;
  if c.status::text not in ('approved','paid') then
    if app_private.workflow_requirements_enforced(new.tenant_id) then
      raise exception 'VEHICLE_VISIT_CLAIM_APPROVAL_REQUIRED';
    end if;
    perform app_private.record_workflow_requirement_override(new.tenant_id,'job_order',new.id,
      case when tg_op='INSERT' then 'create_order_without_claim_approval' else 'advance_order_without_claim_approval' end,
      jsonb_build_object('claim_id',c.id,'claim_status',c.status,'order_status',new.status));
  end if;
  return new;
end $$;
revoke all on function app_private.guard_workflow_claim_order_requirements() from public,anon,authenticated,service_role;
-- AFTER sees claim links inferred by any BEFORE trigger, including on updates
-- of a different column. An exception still rolls back the whole transaction.
create trigger job_order_workflow_claim_requirements after insert or update
on public.job_orders for each row execute function app_private.guard_workflow_claim_order_requirements();

-- Completion can be saved directly from the order status dialog rather than a
-- visit RPC. Audit that operation independently of claim approval: cash orders
-- and already-approved claims can also skip the closing review in relaxed mode.
create function app_private.audit_workflow_order_completion()
returns trigger language plpgsql security definer set search_path='' as $$
declare previous_status text;
begin
  if new.deleted_at is not null or new.status::text not in ('completed','delivered') then return new; end if;
  if tg_op='UPDATE' then
    if new.status is not distinct from old.status then return new; end if;
    previous_status:=old.status::text;
  end if;
  -- The helper locks the current server policy and derives the actor, reason
  -- and revision itself. Client metadata cannot authorize or fabricate evidence.
  perform app_private.record_workflow_requirement_override(new.tenant_id,'job_order',new.id,
    'complete_order_with_workflow_exception',jsonb_build_object(
      'operation',tg_op,'from_status',previous_status,'to_status',new.status,
      'claim_id',new.claim_id,'closing_review_recorded',
        coalesce(jsonb_typeof(to_jsonb(new)#>'{metadata,closingReview}')='object',false)));
  return new;
end $$;
revoke all on function app_private.audit_workflow_order_completion() from public,anon,authenticated,service_role;
create trigger job_order_workflow_completion_audit after insert or update
on public.job_orders for each row execute function app_private.audit_workflow_order_completion();

create or replace function app_private.audit_relaxed_claim_creation()
returns trigger language plpgsql security definer set search_path='' as $$
declare enforced boolean; incomplete boolean;
begin
  enforced:=app_private.workflow_requirements_enforced(new.tenant_id);
  incomplete:=coalesce(new.estimated_amount,0)<=0 or new.estimate_date is null or nullif(btrim(new.vehicle_model),'') is null;
  if new.workflow_requirement_revision is not null and enforced and incomplete then
    raise exception 'WORKFLOW_CLAIM_FORM_DETAILS_REQUIRED';
  end if;
  if not enforced and incomplete then
    perform app_private.record_workflow_requirement_override(new.tenant_id,'insurance_claim',new.id,
      'create_claim_with_incomplete_operational_details',jsonb_build_object(
        'estimate_pending',coalesce(new.estimated_amount,0)<=0,'estimate_date_missing',new.estimate_date is null,
        'model_missing',nullif(btrim(new.vehicle_model),'') is null,'status',new.status));
  end if;
  return new;
end $$;
revoke all on function app_private.audit_relaxed_claim_creation() from public,anon,authenticated,service_role;
create trigger claim_workflow_requirement_audit after insert on public.insurance_claims
for each row execute function app_private.audit_relaxed_claim_creation();
commit;
