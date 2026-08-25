-- Recover only work orders removed by the retired client cache-diff hook.
-- Explicit deletions remain untouched when either the operational audit log or
-- app_trash proves that a user requested deletion.

with recovery_candidates as (
  select
    job.id,
    job.tenant_id,
    job.order_number,
    job.status,
    job.archived_at,
    exists (
      select 1
      from public.operational_audit_log audit
      where audit.tenant_id = job.tenant_id
        and audit.entity_type = 'work_order'
        and audit.action ilike '%delete%'
        and (
          audit.entity_id = job.id::text
          or lower(audit.entity_id) = lower(job.order_number)
        )
    ) as has_delete_audit,
    exists (
      select 1
      from public.operational_audit_log audit
      where audit.tenant_id = job.tenant_id
        and audit.entity_type = 'work_order'
        and audit.action ilike '%archive%'
        and (
          audit.entity_id = job.id::text
          or lower(audit.entity_id) = lower(job.order_number)
        )
    ) as has_archive_audit,
    exists (
      select 1
      from public.app_trash trash
      where trash.tenant_id = job.tenant_id
        and trash.entity_type = 'work_order'
        and (
          trash.entity_id = job.id::text
          or lower(trash.entity_id) = lower(job.order_number)
        )
    ) as has_trash
  from public.job_orders job
  where job.deleted_at is not null
    and job.deleted_by is null
    and job.archived_at = job.deleted_at
), safe_recovery as (
  select *
  from recovery_candidates
  where not has_delete_audit
    and not has_trash
), recovered as (
  update public.job_orders job
  set
    deleted_at = null,
    deleted_by = null,
    archived_at = case
      when safe.has_archive_audit or safe.status::text = 'delivered'
        then safe.archived_at
      else null
    end,
    updated_at = now()
  from safe_recovery safe
  where job.id = safe.id
  returning job.id, job.tenant_id, job.order_number, job.status, job.archived_at
)
insert into public.operational_audit_log (
  tenant_id,
  user_id,
  action,
  entity_type,
  entity_id,
  related_entities,
  reason,
  delete_mode,
  before_snapshot,
  after_snapshot
)
select
  recovered.tenant_id,
  null,
  'work_order_implicit_delete_recovered',
  'work_order',
  recovered.order_number,
  jsonb_build_object('job_order_id', recovered.id),
  'Recovered after removing the legacy client cache-diff deletion hook',
  'system_recovery',
  jsonb_build_object('deleted_at_was_set', true),
  jsonb_build_object(
    'deleted_at', null,
    'archived_at', recovered.archived_at,
    'status', recovered.status
  )
from recovered;
