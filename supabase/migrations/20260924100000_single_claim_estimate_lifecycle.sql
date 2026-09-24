-- One canonical repair estimate per insurance claim.
-- Additive and non-destructive: historical files and audit rows remain intact.

alter table public.insurance_claims
  add column if not exists claim_estimate_document_status text not null default 'not_created',
  add column if not exists claim_estimate_revision integer not null default 0,
  add column if not exists claim_estimate_sent_revision integer,
  add column if not exists claim_estimate_content_hash text,
  add column if not exists claim_estimate_storage_path text,
  add column if not exists claim_estimate_number text,
  add column if not exists claim_estimate_generated_at timestamptz,
  add column if not exists claim_estimate_generated_by uuid,
  add column if not exists claim_estimate_sent_at timestamptz,
  add column if not exists claim_estimate_sent_by uuid,
  add column if not exists claim_estimate_modified_at timestamptz,
  add column if not exists claim_estimate_modified_by uuid;

alter table public.insurance_claims
  drop constraint if exists insurance_claims_claim_estimate_document_status_check;

alter table public.insurance_claims
  add constraint insurance_claims_claim_estimate_document_status_check
  check (claim_estimate_document_status in (
    'not_created', 'draft', 'ready', 'sent', 'modified_after_send'
  ));

alter table public.insurance_claims
  drop constraint if exists insurance_claims_claim_estimate_revision_check;

alter table public.insurance_claims
  add constraint insurance_claims_claim_estimate_revision_check
  check (
    claim_estimate_revision >= 0
    and (
      claim_estimate_sent_revision is null
      or (
        claim_estimate_sent_revision >= 1
        and claim_estimate_sent_revision <= claim_estimate_revision
      )
    )
  );

create or replace function public.mark_claim_estimate_dirty_on_claim_change()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_old_signature jsonb;
  v_new_signature jsonb;
begin
  v_old_signature := jsonb_build_object(
    'insurance_company', to_jsonb(old)->'insurance_company',
    'insurance_company_id', to_jsonb(old)->'insurance_company_id',
    'insurance_employee_id', to_jsonb(old)->'insurance_employee_id',
    'claim_number', to_jsonb(old)->'claim_number',
    'customer_id', to_jsonb(old)->'customer_id',
    'vehicle_id', to_jsonb(old)->'vehicle_id',
    'estimated_amount', to_jsonb(old)->'estimated_amount',
    'estimated_cost', to_jsonb(old)->'estimated_cost',
    'estimation_type', to_jsonb(old)->'estimation_type',
    'upl_items', to_jsonb(old)->'upl_items',
    'estimate_date', to_jsonb(old)->'estimate_date',
    'vehicle_owner_name', to_jsonb(old)->'vehicle_owner_name',
    'vehicle_owner_phone', to_jsonb(old)->'vehicle_owner_phone',
    'vehicle_make', to_jsonb(old)->'vehicle_make',
    'vehicle_model', to_jsonb(old)->'vehicle_model',
    'vehicle_plate', to_jsonb(old)->'vehicle_plate',
    'vehicle_year', to_jsonb(old)->'vehicle_year',
    'vehicle_color', to_jsonb(old)->'vehicle_color',
    'vehicle_vin', to_jsonb(old)->'vehicle_vin',
    'notes', to_jsonb(old)->'notes'
  );
  v_new_signature := jsonb_build_object(
    'insurance_company', to_jsonb(new)->'insurance_company',
    'insurance_company_id', to_jsonb(new)->'insurance_company_id',
    'insurance_employee_id', to_jsonb(new)->'insurance_employee_id',
    'claim_number', to_jsonb(new)->'claim_number',
    'customer_id', to_jsonb(new)->'customer_id',
    'vehicle_id', to_jsonb(new)->'vehicle_id',
    'estimated_amount', to_jsonb(new)->'estimated_amount',
    'estimated_cost', to_jsonb(new)->'estimated_cost',
    'estimation_type', to_jsonb(new)->'estimation_type',
    'upl_items', to_jsonb(new)->'upl_items',
    'estimate_date', to_jsonb(new)->'estimate_date',
    'vehicle_owner_name', to_jsonb(new)->'vehicle_owner_name',
    'vehicle_owner_phone', to_jsonb(new)->'vehicle_owner_phone',
    'vehicle_make', to_jsonb(new)->'vehicle_make',
    'vehicle_model', to_jsonb(new)->'vehicle_model',
    'vehicle_plate', to_jsonb(new)->'vehicle_plate',
    'vehicle_year', to_jsonb(new)->'vehicle_year',
    'vehicle_color', to_jsonb(new)->'vehicle_color',
    'vehicle_vin', to_jsonb(new)->'vehicle_vin',
    'notes', to_jsonb(new)->'notes'
  );

  if v_old_signature is distinct from v_new_signature then
    new.claim_estimate_modified_at := now();
    new.claim_estimate_modified_by := auth.uid();
    new.claim_estimate_document_status := case
      when old.claim_estimate_document_status = 'sent' then 'modified_after_send'
      when old.claim_estimate_document_status = 'ready' then 'draft'
      else old.claim_estimate_document_status
    end;
  end if;

  return new;
end
$$;

drop trigger if exists trg_mark_claim_estimate_dirty on public.insurance_claims;
create trigger trg_mark_claim_estimate_dirty
before update on public.insurance_claims
for each row execute function public.mark_claim_estimate_dirty_on_claim_change();

revoke all on function public.mark_claim_estimate_dirty_on_claim_change() from public, anon, authenticated;

create or replace function public.record_claim_estimate_document(
  p_claim_id uuid,
  p_content_hash text,
  p_storage_path text,
  p_estimate_number text default null
)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_claim public.insurance_claims%rowtype;
  v_revision integer;
  v_status text;
  v_changed boolean;
begin
  select * into v_claim
  from public.insurance_claims
  where id = p_claim_id
    and tenant_id = public.get_user_tenant_id()
  for update;

  if not found then
    raise exception 'CLAIM_NOT_FOUND_OR_FORBIDDEN';
  end if;

  v_changed := v_claim.claim_estimate_content_hash is distinct from p_content_hash;
  v_revision := greatest(coalesce(v_claim.claim_estimate_revision, 0), 0);
  if v_changed then
    v_revision := v_revision + 1;
  end if;
  v_revision := greatest(v_revision, 1);

  v_status := case
    when not v_changed and v_claim.claim_estimate_document_status = 'sent'
      then 'sent'
    when coalesce(v_claim.claim_estimate_sent_revision, 0) > 0
      and v_revision > coalesce(v_claim.claim_estimate_sent_revision, 0)
      then 'modified_after_send'
    else 'ready'
  end;

  update public.insurance_claims
  set claim_estimate_document_status = v_status,
      claim_estimate_revision = v_revision,
      claim_estimate_content_hash = p_content_hash,
      claim_estimate_storage_path = p_storage_path,
      claim_estimate_number = coalesce(nullif(btrim(p_estimate_number), ''), claim_estimate_number),
      claim_estimate_generated_at = now(),
      claim_estimate_generated_by = auth.uid()
  where id = p_claim_id;

  return jsonb_build_object(
    'status', v_status,
    'revision', v_revision,
    'changed', v_changed,
    'sent_revision', v_claim.claim_estimate_sent_revision,
    'storage_path', p_storage_path
  );
end
$$;

create or replace function public.mark_claim_estimate_sent(p_claim_id uuid)
returns jsonb
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_claim public.insurance_claims%rowtype;
begin
  select * into v_claim
  from public.insurance_claims
  where id = p_claim_id
    and tenant_id = public.get_user_tenant_id()
  for update;

  if not found then
    raise exception 'CLAIM_NOT_FOUND_OR_FORBIDDEN';
  end if;
  if coalesce(v_claim.claim_estimate_revision, 0) < 1
     or nullif(v_claim.claim_estimate_storage_path, '') is null then
    raise exception 'CLAIM_ESTIMATE_NOT_GENERATED';
  end if;
  if v_claim.claim_estimate_document_status = 'sent'
     and v_claim.claim_estimate_sent_revision = v_claim.claim_estimate_revision then
    return jsonb_build_object(
      'status', 'sent',
      'revision', v_claim.claim_estimate_revision,
      'sent_revision', v_claim.claim_estimate_sent_revision,
      'sent_at', v_claim.claim_estimate_sent_at,
      'already_sent', true
    );
  end if;

  update public.insurance_claims
  set claim_estimate_document_status = 'sent',
      claim_estimate_sent_revision = claim_estimate_revision,
      claim_estimate_sent_at = now(),
      claim_estimate_sent_by = auth.uid()
  where id = p_claim_id;

  insert into public.claim_audit_logs (
    tenant_id, claim_id, user_id, action, category, file_path, details
  ) values (
    v_claim.tenant_id,
    v_claim.id,
    auth.uid(),
    'claim_estimate_sent',
    'claim_estimate',
    v_claim.claim_estimate_storage_path,
    jsonb_build_object(
      'estimate_number', v_claim.claim_estimate_number,
      'revision', v_claim.claim_estimate_revision,
      'sent_via', 'email'
    )
  );

  return jsonb_build_object(
    'status', 'sent',
    'revision', v_claim.claim_estimate_revision,
    'sent_revision', v_claim.claim_estimate_revision,
    'sent_at', now()
  );
end
$$;

revoke all on function public.record_claim_estimate_document(uuid,text,text,text) from public, anon;
revoke all on function public.mark_claim_estimate_sent(uuid) from public, anon;
grant execute on function public.record_claim_estimate_document(uuid,text,text,text) to authenticated;
grant execute on function public.mark_claim_estimate_sent(uuid) to authenticated;

-- Recognize the newest historical claim-estimate file without deleting older
-- storage objects or audit evidence. The UI exposes only the canonical/latest
-- document after this migration.
with latest_estimate as (
  select distinct on (vm.tenant_id, vm.claim_id)
    vm.tenant_id,
    vm.claim_id,
    vm.storage_path,
    vm.uploaded_at,
    vm.uploaded_by
  from public.vehicle_media vm
  where vm.claim_id is not null
    and vm.media_type = 'document'
    and vm.category = 'claim_estimate'
    and vm.deleted_at is null
  order by vm.tenant_id, vm.claim_id, vm.uploaded_at desc, vm.id desc
), latest_sent as (
  select claim_id, max(created_at) as sent_at
  from public.claim_audit_logs
  where category = 'claim_estimate'
    and action = 'document_generated'
    and coalesce(details->>'sent_via', '') <> ''
  group by claim_id
)
update public.insurance_claims c
set claim_estimate_document_status = case when s.sent_at is not null then 'sent' else 'ready' end,
    claim_estimate_revision = greatest(c.claim_estimate_revision, 1),
    claim_estimate_sent_revision = case when s.sent_at is not null then greatest(c.claim_estimate_revision, 1) else c.claim_estimate_sent_revision end,
    claim_estimate_storage_path = coalesce(c.claim_estimate_storage_path, e.storage_path),
    claim_estimate_generated_at = coalesce(c.claim_estimate_generated_at, e.uploaded_at),
    claim_estimate_generated_by = coalesce(c.claim_estimate_generated_by, e.uploaded_by),
    claim_estimate_sent_at = coalesce(c.claim_estimate_sent_at, s.sent_at)
from latest_estimate e
left join latest_sent s on s.claim_id = e.claim_id
where c.id = e.claim_id
  and c.tenant_id = e.tenant_id
  and c.claim_estimate_document_status = 'not_created';

comment on function public.record_claim_estimate_document(uuid,text,text,text) is
  'Atomically records the one canonical repair-estimate document and its revision for a tenant claim.';
comment on function public.mark_claim_estimate_sent(uuid) is
  'Marks the current canonical repair-estimate revision as sent without creating another file.';
