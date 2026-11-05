-- DEVELOPMENT CANDIDATE ONLY. Main must review, back up and apply selectively.
-- No backfill, workflow/history mutation, stored custody source or return API change.
-- Pure mirror of resolveVehicleVisit/getVehicleEntryPresence + center classification.
-- Frontend checks every returned projection for parity and fails closed on drift.
create function public.vehicle_visit_center_resolve_v1(
  e jsonb, w jsonb, final_handover boolean, temporary_release boolean, evidence_stage text
) returns jsonb language plpgsql immutable security invoker set search_path = '' as $$
declare
  c jsonb := coalesce(nullif(e->'claim','null'), nullif(e->'converted_claim','null'), '{}'::jsonb);
  o jsonb := coalesce(nullif(e->'work_order','null'), nullif(e->'converted_work_order','null'), '{}'::jsonb);
  linked_claim text := coalesce(e->>'insurance_claim_id',e->>'converted_claim_id');
  linked_order text := coalesce(e->>'work_order_id',e->>'converted_work_order_id');
  reason text := w->>'review_reason';
  stage text := coalesce(w->>'stage',evidence_stage,'arrived');
  operational text;
  presence text;
  tab text;
  arrival timestamptz := ((e->>'arrival_date') || 'T' || left(coalesce(e->>'arrival_time','00:00'),5) || ':00+04:00')::timestamptz;
  delivery_since_arrival boolean;
  delivered_marker boolean;
  cancelled boolean := coalesce(e->>'status'='Cancelled' or c->>'status' in ('cancelled','rejected'), false);
  inside_link boolean := coalesce(c->>'vehicle_presence_status'='in_workshop' or o->>'vehicle_presence_status'='in_workshop',false);
  outside_link boolean := coalesce(c->>'vehicle_presence_status'='with_customer' or o->>'vehicle_presence_status'='with_customer',false);
begin
  select coalesce(bool_or(value::timestamptz >= arrival or arrival is null),false)
    into delivery_since_arrival from unnest(array[o->>'vehicle_delivered_at', c->>'vehicle_delivered_at',c->>'delivered_at']) value
    where value is not null;
  delivered_marker := final_handover or delivery_since_arrival or coalesce(o->>'status'='delivered'
    and o->>'vehicle_delivered_at' is null and c->>'vehicle_delivered_at' is null and c->>'delivered_at' is null,false);
  presence := case
    when (e->>'work_order_id' is not null and e->>'converted_work_order_id' is not null and e->>'work_order_id'<>e->>'converted_work_order_id')
      or (e->>'insurance_claim_id' is not null and e->>'converted_claim_id' is not null and e->>'insurance_claim_id'<>e->>'converted_claim_id')
      or (linked_order is not null and o='{}'::jsonb) or (linked_claim is not null and c='{}'::jsonb) then 'needs_review'
    when inside_link and (outside_link or delivery_since_arrival or e->>'vehicle_location'='مع العميل') then 'needs_review'
    when delivery_since_arrival or e->>'vehicle_location'='مع العميل' then 'with_customer'
    when e->>'vehicle_location'='داخل الورشة' and not outside_link then 'in_workshop'
    else 'needs_review' end;

  if coalesce((e->>'_claimOnly')::boolean,false) then
    stage := case
      when c->>'vehicle_id' is null or (o<>'{}'::jsonb and (o->>'claim_id' is distinct from c->>'id'
        or o->>'vehicle_id' is distinct from c->>'vehicle_id' or o->>'work_order_type' is distinct from 'insurance')) then 'needs_review'
      when c->>'status' in ('cancelled','rejected') then case when o<>'{}'::jsonb then 'needs_review' else 'cancelled' end
      when c->>'delivered_at' is not null or c->>'vehicle_delivered_at' is not null or o->>'vehicle_delivered_at' is not null or o->>'status'='delivered'
        then case when c->>'vehicle_presence_status'='with_customer' then 'delivered' else 'needs_review' end
      when o->>'status'='completed' or o->>'work_completed_at' is not null or c->>'work_completed_at' is not null or c->>'repair_stage' in ('ready','quality_check') then 'ready'
      when o->>'status' in ('in_progress','waiting_parts') or o->>'work_started_at' is not null or c->>'work_started_at' is not null or c->>'repair_stage' in ('repairing','in_progress')
        then case when c->>'vehicle_presence_status'='with_customer' then 'needs_review' else 'in_progress' end
      when c->>'status' in ('approved','paid') or c->>'approved_at' is not null or c->>'insurance_approved_at' is not null then 'approved'
      else 'arrived' end;
    return jsonb_build_object('stage',stage,'operationalStage',stage,'reviewReason','claim_without_entry','centerTab','needs_review','presence',presence);
  end if;

  if e->>'vehicle_id' is null then reason := coalesce(reason,'missing_vehicle'); end if;
  if linked_order is not null and (o='{}'::jsonb or o->>'vehicle_id' is distinct from e->>'vehicle_id') then reason := coalesce(reason,'work_order_link_conflict'); end if;
  if coalesce((e->>'__inferredOrderLink')::boolean,false) then reason := coalesce(reason,'work_order_link_conflict'); end if;
  if coalesce((e->>'__inferredClaimLink')::boolean,false) then reason := coalesce(reason,'claim_link_conflict'); end if;
  if linked_claim is not null and (c='{}'::jsonb or c->>'vehicle_id' is distinct from e->>'vehicle_id') then reason := coalesce(reason,'claim_link_conflict'); end if;
  if o<>'{}'::jsonb and ((linked_claim is not null and (o->>'work_order_type' is distinct from 'insurance' or o->>'claim_id' is distinct from linked_claim))
    or (linked_claim is null and o->>'work_order_type'='insurance')) then reason := coalesce(reason,'work_order_channel_conflict'); end if;
  if linked_claim is null and (e->>'insurance_company_id' is not null or nullif(trim(e->'insurance_snapshot'->>'claim_number'),'') is not null
    or nullif(trim(e->'insurance_snapshot'->>'company_name'),'') is not null or o->>'work_order_type'='insurance') then reason := coalesce(reason,'insurance_claim_required'); end if;
  if cancelled and o<>'{}'::jsonb and o->>'status' is distinct from 'delivered' then reason := coalesce(reason,'cancelled_with_active_work_order'); end if;
  if e->>'work_order_id' is not null and e->>'converted_work_order_id' is not null and e->>'work_order_id'<>e->>'converted_work_order_id' then reason := coalesce(reason,'work_order_link_conflict'); end if;
  if e->>'insurance_claim_id' is not null and e->>'converted_claim_id' is not null and e->>'insurance_claim_id'<>e->>'converted_claim_id' then reason := coalesce(reason,'claim_link_conflict'); end if;
  if presence='needs_review' then reason := coalesce(reason,'custody_conflict'); end if;
  if delivered_marker and not final_handover and (reason is null or reason='custody_conflict') then reason := 'delivery_without_signed_handover'; end if;
  if w->>'stage'='delivered' and not final_handover then reason := coalesce(reason,'delivery_without_signed_handover'); end if;
  if presence='with_customer' and not final_handover and not temporary_release and c->>'cancelled_handover_signed_at' is null then reason := coalesce(reason,'exit_without_signed_release'); end if;
  if w is null or w='null'::jsonb then
    -- The canonical evidence function remains the baseline; finalized handover
    -- projection and inferred links are display-only, never sync/backfill calls.
    stage := case when cancelled then 'cancelled' when final_handover and delivered_marker then 'delivered'
      when o->>'status' in ('completed','delivered') or o->>'work_completed_at' is not null or c->>'work_completed_at' is not null or c->>'repair_stage' in ('ready','quality_check','delivered') then 'ready'
      when o->>'status' in ('in_progress','waiting_parts') or o->>'work_started_at' is not null or c->>'work_started_at' is not null or c->>'repair_stage' in ('repairing','in_progress') then 'in_progress'
      when c->>'status' in ('approved','paid') or c->>'approved_at' is not null or c->>'insurance_approved_at' is not null then 'approved'
      else coalesce(evidence_stage,'arrived') end;
  end if;
  operational := case when reason is null then stage else 'needs_review' end;
  if reason is not null then
    operational := case when cancelled then 'cancelled'
      when delivered_marker and (final_handover or outside_link or e->>'vehicle_location'='مع العميل') then 'delivered'
      when o->>'status' in ('completed','delivered') or o->>'work_completed_at' is not null or c->>'work_completed_at' is not null or c->>'repair_stage' in ('ready','quality_check') then 'ready'
      when o->>'status' in ('in_progress','waiting_parts') or o->>'work_started_at' is not null or c->>'work_started_at' is not null or c->>'repair_stage' in ('repairing','in_progress') then 'in_progress'
      else 'needs_review' end;
  end if;
  tab := case when operational in ('delivered','cancelled') then operational
    when reason is not null then 'needs_review' when presence='in_workshop' then 'in_workshop'
    when presence='with_customer' and temporary_release then 'with_customer' else 'needs_review' end;
  return jsonb_build_object('stage',case when reason is not null then 'needs_review' else stage end,
    'operationalStage',operational,'reviewReason',reason,'centerTab',tab,'presence',presence);
end;
$$;

-- Internal read projection. RLS remains active and all joins also require tenant
-- identity. No source rows, signatures, PDF bodies or media are written/copied.
create function public.vehicle_visit_center_rows_v1(p_tenant_id uuid)
returns setof jsonb language sql stable security invoker set search_path = '' as $$
with entries as materialized (
  select e.* from public.vehicle_entries e
  where e.tenant_id=p_tenant_id and p_tenant_id=public.get_user_tenant_id()
    and auth.uid() is not null and e.deleted_at is null
), claims as materialized (
  select c.* from public.insurance_claims c
  where c.tenant_id=p_tenant_id and p_tenant_id=public.get_user_tenant_id()
    and auth.uid() is not null and c.deleted_at is null
), orders as materialized (
  select o.* from public.job_orders o
  where o.tenant_id=p_tenant_id and p_tenant_id=public.get_user_tenant_id()
    and auth.uid() is not null and o.deleted_at is null
), claim_data as (
  select c.id, jsonb_build_object(
    'id',c.id,'tenant_id',c.tenant_id,'vehicle_id',c.vehicle_id,'customer_id',c.customer_id,'claim_number',c.claim_number,
    'status',c.status,'repair_stage',c.repair_stage,'vehicle_presence_status',c.vehicle_presence_status,
    'workshop_arrival_date',c.workshop_arrival_date,'created_at',c.created_at,'approved_at',c.approved_at,'insurance_approved_at',c.insurance_approved_at,
    'work_started_at',c.work_started_at,'work_completed_at',c.work_completed_at,'delivered_at',c.delivered_at,'vehicle_delivered_at',c.vehicle_delivered_at,
    'cancelled_handover_signed_at',c.cancelled_handover_signed_at,'insurance_company',c.insurance_company,
    'vehicle_owner_name',c.vehicle_owner_name,'vehicle_owner_phone',c.vehicle_owner_phone,'vehicle_make',c.vehicle_make,'vehicle_model',c.vehicle_model,'vehicle_plate',c.vehicle_plate,
    'vehicle',case when v.id is null then null else jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'brand',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,'vin_number',v.vin_number) end,
    'customer',case when cu.id is null then null else jsonb_build_object('id',cu.id,'tenant_id',cu.tenant_id,'name',cu.name,'phone',cu.phone) end
  ) payload from claims c
  left join public.vehicles v on v.id=c.vehicle_id and v.tenant_id=p_tenant_id
  left join public.customers cu on cu.id=c.customer_id and cu.tenant_id=p_tenant_id
), order_data as (
  select o.id, jsonb_build_object('id',o.id,'tenant_id',o.tenant_id,'vehicle_id',o.vehicle_id,'claim_id',o.claim_id,
    'vehicle_entry_id',o.vehicle_entry_id,'order_number',o.order_number,'status',o.status,'technician_name',o.technician_name,
    'work_order_type',o.work_order_type,'work_started_at',o.work_started_at,'work_completed_at',o.work_completed_at,
    'vehicle_presence_status',o.vehicle_presence_status,'vehicle_delivered_at',o.vehicle_delivered_at) payload from orders o
), entry_data as (
  select e.id::text item_key, e.arrival_date,
    (to_jsonb(e) - array['declaration_ar','declaration_en','damage_map','vehicle_contents']) || jsonb_build_object(
      'claim',coalesce(cd.payload,reverse_claim.payload),'converted_claim',ccd.payload,
      'work_order',coalesce(od.payload,inferred_order.payload),'converted_work_order',cod.payload,
      '__inferredClaimLink',cd.payload is null and ccd.payload is null and reverse_claim.candidates>0,
      '__inferredOrderLink',e.work_order_id is null and e.converted_work_order_id is null and inferred_order.candidates>0,
      'vehicle',case when v.id is null then null else jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'brand',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,'vin_number',v.vin_number) end,
      'customer',case when cu.id is null then null else jsonb_build_object('id',cu.id,'tenant_id',cu.tenant_id,'name',cu.name,'phone',cu.phone) end,
      'insurance_company',case when ic.id is null then null else jsonb_build_object('id',ic.id,'name',ic.name) end
    ) entry, to_jsonb(w) workflow,
    exists(select 1 from public.vehicle_handover_records h where h.tenant_id=p_tenant_id and h.vehicle_entry_id=e.id
      and h.status='finalized' and h.work_order_id in (e.work_order_id,e.converted_work_order_id)) final_handover,
    exists(select 1 from public.vehicle_inspection_releases r where r.tenant_id=p_tenant_id and r.vehicle_entry_id=e.id
      and r.status='signed' and r.returned_at is null) temporary_release,
    public.vehicle_visit_evidence_stage(e.id) evidence_stage, false claim_only
  from entries e
  left join claim_data cd on cd.id=e.insurance_claim_id
  left join claim_data ccd on ccd.id=e.converted_claim_id
  left join order_data od on od.id=e.work_order_id
  left join order_data cod on cod.id=e.converted_work_order_id
  left join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=p_tenant_id
  left join public.vehicles v on v.id=e.vehicle_id and v.tenant_id=p_tenant_id
  left join public.customers cu on cu.id=e.customer_id and cu.tenant_id=p_tenant_id
  left join public.insurance_companies ic on ic.id=e.insurance_company_id and ic.tenant_id=p_tenant_id
  left join lateral (
    select count(*) candidates,case when count(*)=1 then jsonb_agg(d.payload)->0 end payload from claims c join claim_data d on d.id=c.id
    where c.vehicle_entry_id=e.id and c.vehicle_id=e.vehicle_id
      and e.insurance_claim_id is null and e.converted_claim_id is null
  ) reverse_claim on true
  left join lateral (
    select count(*) candidates, case when count(*)=1 and ((jsonb_agg(d.payload)->0->>'vehicle_entry_id') is null
      or (jsonb_agg(d.payload)->0->>'vehicle_entry_id')=e.id::text) then (jsonb_agg(d.payload)->0) end payload
    from orders o join order_data d on d.id=o.id
    where o.claim_id=coalesce(e.insurance_claim_id,e.converted_claim_id,(reverse_claim.payload->>'id')::uuid)
      and o.vehicle_id=e.vehicle_id and e.work_order_id is null and e.converted_work_order_id is null
  ) inferred_order on true
), claim_only_data as (
  select 'claim:'||c.id item_key,
    (coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat')::date arrival_date,
    jsonb_build_object('id','claim:'||c.id,'tenant_id',c.tenant_id,'_claimOnly',true,'entry_number','',
      'status',c.status,'arrival_date',to_char(coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat','YYYY-MM-DD'),
      'arrival_time',to_char(coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat','HH24:MI'),
      '_arrivalSource',case when c.workshop_arrival_date is null then 'claim_registration' else 'workshop_arrival_date' end,
      'created_at',c.created_at,'vehicle_id',c.vehicle_id,'customer_id',c.customer_id,'insurance_claim_id',c.id,
      'vehicle_location',case when c.vehicle_id is null then null when c.vehicle_presence_status='in_workshop' then 'داخل الورشة' when c.vehicle_presence_status='with_customer' then 'مع العميل' end,
      'claim',d.payload,'work_order',co.payload,
      'vehicle',coalesce(nullif(d.payload->'vehicle','null'),'{}'::jsonb) || jsonb_build_object(
        'tenant_id',c.tenant_id,'brand',coalesce(nullif(d.payload->'vehicle'->>'brand',''),c.vehicle_make,''),
        'model',coalesce(nullif(d.payload->'vehicle'->>'model',''),c.vehicle_model,''),'plate_number',coalesce(nullif(d.payload->'vehicle'->>'plate_number',''),c.vehicle_plate,'')),
      'customer',coalesce(nullif(d.payload->'customer','null'),'{}'::jsonb) || jsonb_build_object('tenant_id',c.tenant_id,
        'name',coalesce(nullif(d.payload->'customer'->>'name',''),c.vehicle_owner_name,''),'phone',coalesce(nullif(d.payload->'customer'->>'phone',''),c.vehicle_owner_phone,'')),
      'vehicle_snapshot',jsonb_build_object('make',c.vehicle_make,'model',c.vehicle_model,'plate_number',c.vehicle_plate),
      'customer_snapshot',jsonb_build_object('name',c.vehicle_owner_name,'phone',c.vehicle_owner_phone),
      'insurance_snapshot',jsonb_build_object('claim_number',c.claim_number,'company_name',c.insurance_company)
    ) entry, null::jsonb workflow, false final_handover, false temporary_release, 'arrived'::text evidence_stage, true claim_only,
    co.candidates>1 duplicate_order
  from claims c join claim_data d on d.id=c.id
  left join lateral (
    select count(*) candidates,case when count(*)=1 then jsonb_agg(od.payload)->0 end payload
    from orders o join order_data od on od.id=o.id where o.claim_id=c.id and o.vehicle_id=c.vehicle_id
  ) co on true
  where not exists(select 1 from entries e where e.insurance_claim_id=c.id or e.converted_claim_id=c.id
    or (c.vehicle_entry_id=e.id and c.vehicle_id=e.vehicle_id
      and (e.insurance_claim_id is null or e.insurance_claim_id=c.id) and (e.converted_claim_id is null or e.converted_claim_id=c.id)
      and (e.insurance_claim_id=c.id or e.converted_claim_id=c.id or
        (select count(*) from claims c2 where c2.vehicle_entry_id=e.id and c2.vehicle_id=e.vehicle_id)=1)))
), raw_rows as (
  select ed.*, false duplicate_order from entry_data ed union all select * from claim_only_data
), resolved as materialized (
  select r.*, public.vehicle_visit_center_resolve_v1(entry,workflow,final_handover,temporary_release,evidence_stage) projection from raw_rows r
), duplicates as (
  -- Whole-tenant scope, before filters/pages: a duplicate on another page must
  -- not turn into an apparently valid active arrival on this page.
  select r.*,
    duplicate_order or (entry->>'vehicle_id' is not null and projection->>'operationalStage' not in ('delivered','cancelled')
      and count(*) filter(where projection->>'operationalStage' not in ('delivered','cancelled')) over (
        partition by claim_only,entry->>'vehicle_id',case when claim_only then arrival_date end)>1) duplicate_open
  from resolved r
)
select jsonb_build_object('itemKey',item_key,'entry',entry,'workflow',workflow,'arrivalDate',arrival_date,
    'hasFinalHandover',final_handover,'hasSignedTemporaryRelease',temporary_release,'duplicateOpenVisit',duplicate_open,
    'technician',coalesce(entry->'work_order'->>'technician_name',entry->'converted_work_order'->>'technician_name',''))
  || projection || case when duplicate_open then jsonb_build_object('stage','needs_review','operationalStage','needs_review',
    'reviewReason',coalesce(projection->>'reviewReason','duplicate_open_visit'),'centerTab','needs_review') else '{}'::jsonb end
from duplicates;
$$;

-- Public narrow bridge for the intentionally private canonical evidence/pure
-- resolver. All caller-supplied JSON is already visible to the invoker endpoint.
-- It returns ONLY stage/review classification, never source rows or PII. The
-- canonical evidence function reads only same-tenant entry/claim/order/handover,
-- all readable by the five entry roles under existing source policies. It does
-- NOT read inspection releases or insurance companies on behalf of technicians.
create function public.vehicle_visit_center_evidence_v1(
  p_tenant_id uuid, e jsonb, w jsonb, final_handover boolean, temporary_release boolean
) returns jsonb language plpgsql stable security definer set search_path = '' as $bridge$
declare evidence text := 'arrived';
begin
  if auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or e->>'tenant_id' is distinct from p_tenant_id::text
    or public.get_user_role() is null or public.get_user_role()::text not in ('admin','manager','supervisor','technician','insurance')
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid()
      and p.tenant_id=p_tenant_id and p.account_status='active') then
    raise exception 'VEHICLE_CENTER_TENANT_MISMATCH' using errcode='42501';
  end if;
  if not coalesce((e->>'_claimOnly')::boolean,false) then
    if not exists(select 1 from public.vehicle_entries ve where ve.id=(e->>'id')::uuid
      and ve.tenant_id=p_tenant_id and ve.deleted_at is null) then
      raise exception 'VEHICLE_CENTER_ENTRY_NOT_VISIBLE' using errcode='42501';
    end if;
    evidence := public.vehicle_visit_evidence_stage((e->>'id')::uuid);
  end if;
  return public.vehicle_visit_center_resolve_v1(e,w,final_handover,temporary_release,evidence);
end;
$bridge$;

create function public.vehicle_visit_center_page_v1(
  p_tenant_id uuid, p_tab text default 'in_workshop', p_filters jsonb default '{}'::jsonb,
  p_page integer default 1, p_page_size integer default 30
) returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare result jsonb;
begin
  -- SECURITY INVOKER is essential: source-table RLS, notably inspection
  -- releases and insurance-company visibility, remains the caller's boundary.
  -- Private projection/helper grants remain revoked. Only the stage-only,
  -- tenant/active-profile guarded evidence bridge has a narrow execute grant.
  if auth.uid() is null or p_tenant_id is distinct from public.get_user_tenant_id()
    or public.get_user_role() is null or public.get_user_role()::text not in ('admin','manager','supervisor','technician','insurance')
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid()
      and p.tenant_id=p_tenant_id and p.account_status='active') then
    raise exception 'VEHICLE_CENTER_TENANT_MISMATCH' using errcode='42501';
  end if;
  if p_tab is null or p_tab not in ('in_workshop','with_customer','delivered','cancelled','needs_review')
    or p_page is null or p_page<1 or p_page_size is null or p_page_size<1 or p_page_size>100
    or p_filters is null or jsonb_typeof(p_filters)<>'object' then raise exception 'VEHICLE_CENTER_INVALID_REQUEST'; end if;
  with center_rows as materialized (
with entries as materialized (
  select e.* from public.vehicle_entries e
  where e.tenant_id=p_tenant_id and p_tenant_id=public.get_user_tenant_id()
    and auth.uid() is not null and e.deleted_at is null
), claims as materialized (
  select c.* from public.insurance_claims c
  where c.tenant_id=p_tenant_id and p_tenant_id=public.get_user_tenant_id()
    and auth.uid() is not null and c.deleted_at is null
), orders as materialized (
  select o.* from public.job_orders o
  where o.tenant_id=p_tenant_id and p_tenant_id=public.get_user_tenant_id()
    and auth.uid() is not null and o.deleted_at is null
), claim_data as (
  select c.id, jsonb_build_object(
    'id',c.id,'tenant_id',c.tenant_id,'vehicle_id',c.vehicle_id,'customer_id',c.customer_id,'claim_number',c.claim_number,
    'status',c.status,'repair_stage',c.repair_stage,'vehicle_presence_status',c.vehicle_presence_status,
    'workshop_arrival_date',c.workshop_arrival_date,'created_at',c.created_at,'approved_at',c.approved_at,'insurance_approved_at',c.insurance_approved_at,
    'work_started_at',c.work_started_at,'work_completed_at',c.work_completed_at,'delivered_at',c.delivered_at,'vehicle_delivered_at',c.vehicle_delivered_at,
    'cancelled_handover_signed_at',c.cancelled_handover_signed_at,'insurance_company',c.insurance_company,
    'vehicle_owner_name',c.vehicle_owner_name,'vehicle_owner_phone',c.vehicle_owner_phone,'vehicle_make',c.vehicle_make,'vehicle_model',c.vehicle_model,'vehicle_plate',c.vehicle_plate,
    'vehicle',case when v.id is null then null else jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'brand',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,'vin_number',v.vin_number) end,
    'customer',case when cu.id is null then null else jsonb_build_object('id',cu.id,'tenant_id',cu.tenant_id,'name',cu.name,'phone',cu.phone) end
  ) payload from claims c
  left join public.vehicles v on v.id=c.vehicle_id and v.tenant_id=p_tenant_id
  left join public.customers cu on cu.id=c.customer_id and cu.tenant_id=p_tenant_id
), order_data as (
  select o.id, jsonb_build_object('id',o.id,'tenant_id',o.tenant_id,'vehicle_id',o.vehicle_id,'claim_id',o.claim_id,
    'vehicle_entry_id',o.vehicle_entry_id,'order_number',o.order_number,'status',o.status,'technician_name',o.technician_name,
    'work_order_type',o.work_order_type,'work_started_at',o.work_started_at,'work_completed_at',o.work_completed_at,
    'vehicle_presence_status',o.vehicle_presence_status,'vehicle_delivered_at',o.vehicle_delivered_at) payload from orders o
), entry_data as (
  select e.id::text item_key, e.arrival_date,
    (to_jsonb(e) - array['declaration_ar','declaration_en','damage_map','vehicle_contents']) || jsonb_build_object(
      'claim',coalesce(cd.payload,reverse_claim.payload),'converted_claim',ccd.payload,
      'work_order',coalesce(od.payload,inferred_order.payload),'converted_work_order',cod.payload,
      '__inferredClaimLink',cd.payload is null and ccd.payload is null and reverse_claim.candidates>0,
      '__inferredOrderLink',e.work_order_id is null and e.converted_work_order_id is null and inferred_order.candidates>0,
      'vehicle',case when v.id is null then null else jsonb_build_object('id',v.id,'tenant_id',v.tenant_id,'brand',v.brand,'model',v.model,'year',v.year,'plate_number',v.plate_number,'plate_letters',v.plate_letters,'plate_country',v.plate_country,'vin_number',v.vin_number) end,
      'customer',case when cu.id is null then null else jsonb_build_object('id',cu.id,'tenant_id',cu.tenant_id,'name',cu.name,'phone',cu.phone) end,
      'insurance_company',case when ic.id is null then null else jsonb_build_object('id',ic.id,'name',ic.name) end
    ) entry, to_jsonb(w) workflow,
    exists(select 1 from public.vehicle_handover_records h where h.tenant_id=p_tenant_id and h.vehicle_entry_id=e.id
      and h.status='finalized' and h.work_order_id in (e.work_order_id,e.converted_work_order_id)) final_handover,
    exists(select 1 from public.vehicle_inspection_releases r where r.tenant_id=p_tenant_id and r.vehicle_entry_id=e.id
      and r.status='signed' and r.returned_at is null) temporary_release,
    null::text evidence_stage, false claim_only
  from entries e
  left join claim_data cd on cd.id=e.insurance_claim_id
  left join claim_data ccd on ccd.id=e.converted_claim_id
  left join order_data od on od.id=e.work_order_id
  left join order_data cod on cod.id=e.converted_work_order_id
  left join public.vehicle_visit_workflows w on w.entry_id=e.id and w.tenant_id=p_tenant_id
  left join public.vehicles v on v.id=e.vehicle_id and v.tenant_id=p_tenant_id
  left join public.customers cu on cu.id=e.customer_id and cu.tenant_id=p_tenant_id
  left join public.insurance_companies ic on ic.id=e.insurance_company_id and ic.tenant_id=p_tenant_id
  left join lateral (
    select count(*) candidates,case when count(*)=1 then jsonb_agg(d.payload)->0 end payload from claims c join claim_data d on d.id=c.id
    where c.vehicle_entry_id=e.id and c.vehicle_id=e.vehicle_id
      and e.insurance_claim_id is null and e.converted_claim_id is null
  ) reverse_claim on true
  left join lateral (
    select count(*) candidates, case when count(*)=1 and ((jsonb_agg(d.payload)->0->>'vehicle_entry_id') is null
      or (jsonb_agg(d.payload)->0->>'vehicle_entry_id')=e.id::text) then (jsonb_agg(d.payload)->0) end payload
    from orders o join order_data d on d.id=o.id
    where o.claim_id=coalesce(e.insurance_claim_id,e.converted_claim_id,(reverse_claim.payload->>'id')::uuid)
      and o.vehicle_id=e.vehicle_id and e.work_order_id is null and e.converted_work_order_id is null
  ) inferred_order on true
), claim_only_data as (
  select 'claim:'||c.id item_key,
    (coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat')::date arrival_date,
    jsonb_build_object('id','claim:'||c.id,'tenant_id',c.tenant_id,'_claimOnly',true,'entry_number','',
      'status',c.status,'arrival_date',to_char(coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat','YYYY-MM-DD'),
      'arrival_time',to_char(coalesce(c.workshop_arrival_date,c.created_at) at time zone 'Asia/Muscat','HH24:MI'),
      '_arrivalSource',case when c.workshop_arrival_date is null then 'claim_registration' else 'workshop_arrival_date' end,
      'created_at',c.created_at,'vehicle_id',c.vehicle_id,'customer_id',c.customer_id,'insurance_claim_id',c.id,
      'vehicle_location',case when c.vehicle_id is null then null when c.vehicle_presence_status='in_workshop' then 'داخل الورشة' when c.vehicle_presence_status='with_customer' then 'مع العميل' end,
      'claim',d.payload,'work_order',co.payload,
      'vehicle',coalesce(nullif(d.payload->'vehicle','null'),'{}'::jsonb) || jsonb_build_object(
        'tenant_id',c.tenant_id,'brand',coalesce(nullif(d.payload->'vehicle'->>'brand',''),c.vehicle_make,''),
        'model',coalesce(nullif(d.payload->'vehicle'->>'model',''),c.vehicle_model,''),'plate_number',coalesce(nullif(d.payload->'vehicle'->>'plate_number',''),c.vehicle_plate,'')),
      'customer',coalesce(nullif(d.payload->'customer','null'),'{}'::jsonb) || jsonb_build_object('tenant_id',c.tenant_id,
        'name',coalesce(nullif(d.payload->'customer'->>'name',''),c.vehicle_owner_name,''),'phone',coalesce(nullif(d.payload->'customer'->>'phone',''),c.vehicle_owner_phone,'')),
      'vehicle_snapshot',jsonb_build_object('make',c.vehicle_make,'model',c.vehicle_model,'plate_number',c.vehicle_plate),
      'customer_snapshot',jsonb_build_object('name',c.vehicle_owner_name,'phone',c.vehicle_owner_phone),
      'insurance_snapshot',jsonb_build_object('claim_number',c.claim_number,'company_name',c.insurance_company)
    ) entry, null::jsonb workflow, false final_handover, false temporary_release, 'arrived'::text evidence_stage, true claim_only,
    co.candidates>1 duplicate_order
  from claims c join claim_data d on d.id=c.id
  left join lateral (
    select count(*) candidates,case when count(*)=1 then jsonb_agg(od.payload)->0 end payload
    from orders o join order_data od on od.id=o.id where o.claim_id=c.id and o.vehicle_id=c.vehicle_id
  ) co on true
  where not exists(select 1 from entries e where e.insurance_claim_id=c.id or e.converted_claim_id=c.id
    or (c.vehicle_entry_id=e.id and c.vehicle_id=e.vehicle_id
      and (e.insurance_claim_id is null or e.insurance_claim_id=c.id) and (e.converted_claim_id is null or e.converted_claim_id=c.id)
      and (e.insurance_claim_id=c.id or e.converted_claim_id=c.id or
        (select count(*) from claims c2 where c2.vehicle_entry_id=e.id and c2.vehicle_id=e.vehicle_id)=1)))
), raw_rows as (
  select ed.*, false duplicate_order from entry_data ed union all select * from claim_only_data
), resolved as materialized (
  select r.*, public.vehicle_visit_center_evidence_v1(p_tenant_id,entry,workflow,final_handover,temporary_release) projection from raw_rows r
), duplicates as (
  -- Whole-tenant scope, before filters/pages: a duplicate on another page must
  -- not turn into an apparently valid active arrival on this page.
  select r.*,
    duplicate_order or (entry->>'vehicle_id' is not null and projection->>'operationalStage' not in ('delivered','cancelled')
      and count(*) filter(where projection->>'operationalStage' not in ('delivered','cancelled')) over (
        partition by claim_only,entry->>'vehicle_id',case when claim_only then arrival_date end)>1) duplicate_open
  from resolved r
)
select jsonb_build_object('itemKey',item_key,'entry',entry,'workflow',workflow,'arrivalDate',arrival_date,
    'hasFinalHandover',final_handover,'hasSignedTemporaryRelease',temporary_release,'duplicateOpenVisit',duplicate_open,
    'technician',coalesce(entry->'work_order'->>'technician_name',entry->'converted_work_order'->>'technician_name',''))
  || projection || case when duplicate_open then jsonb_build_object('stage','needs_review','operationalStage','needs_review',
    'reviewReason',coalesce(projection->>'reviewReason','duplicate_open_visit'),'centerTab','needs_review') else '{}'::jsonb end
from duplicates
  ), filtered as materialized (
    select r from center_rows data(r)
    where (coalesce(p_filters->>'search','')='' or position(lower(trim(p_filters->>'search')) in lower(concat_ws(' ',
      r->'entry'->>'entry_number',r->'entry'->'customer'->>'name',r->'entry'->'customer'->>'phone',
      r->'entry'->'customer_snapshot'->>'name',r->'entry'->'customer_snapshot'->>'phone',
      r->'entry'->'vehicle'->>'plate_number',r->'entry'->'vehicle'->>'plate_letters',r->'entry'->'vehicle'->>'vin_number',
      r->'entry'->'vehicle'->>'brand',r->'entry'->'vehicle'->>'model',r->'entry'->'vehicle_snapshot'->>'plate_number',
      r->'entry'->'vehicle_snapshot'->>'vin',r->'entry'->'vehicle_snapshot'->>'make',r->'entry'->'vehicle_snapshot'->>'model',
      r->'entry'->'claim'->>'claim_number',r->'entry'->'converted_claim'->>'claim_number',
      r->'entry'->'work_order'->>'order_number',r->'entry'->'converted_work_order'->>'order_number',
      r->'entry'->'insurance_snapshot'->>'claim_number',r->'entry'->'insurance_snapshot'->>'company_name'))) > 0)
    and (coalesce(p_filters->>'status','all')='all' or r->'entry'->>'status'=p_filters->>'status')
    and (nullif(p_filters->>'from','') is null or (r->>'arrivalDate')::date >= (p_filters->>'from')::date)
    and (nullif(p_filters->>'to','') is null or (r->>'arrivalDate')::date <= (p_filters->>'to')::date)
    and (coalesce(p_filters->>'technician','all')='all' or r->>'technician'=p_filters->>'technician')
    and (coalesce(p_filters->>'location','all')='all' or r->>'presence'=p_filters->>'location')
    and (coalesce((p_filters->>'minDays')::integer,0)<=0 or
      greatest(0,extract(epoch from (now()-((r->>'arrivalDate')||'T00:00:00+04:00')::timestamptz))/86400) >= (p_filters->>'minDays')::integer)
  ), stage_filtered as materialized (
    select r from filtered where coalesce(p_filters->>'stage','all')='all'
      or (p_filters->>'stage'='needs_review' and r->>'reviewReason' is not null)
      or r->>'operationalStage'=p_filters->>'stage'
  ), selected as materialized (
    select r from stage_filtered where r->>'centerTab'=p_tab
  ), page_rows as (
    select r from selected order by r->>'arrivalDate' desc nulls last,r->'entry'->>'arrival_time' desc nulls last,r->>'itemKey'
    limit p_page_size offset ((p_page::bigint-1)*p_page_size)
  )
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(r order by r->>'arrivalDate' desc nulls last,r->'entry'->>'arrival_time' desc nulls last,r->>'itemKey') from page_rows),'[]'::jsonb),
    'page',p_page,'pageSize',p_page_size,'total',(select count(*) from selected),
    'scopeToken',(select md5(coalesce(string_agg(md5(r::text),'' order by r->>'itemKey'),'')) from selected),
    'tabs',(select jsonb_object_agg(tab,(select count(*) from stage_filtered where r->>'centerTab'=tab))
      from unnest(array['in_workshop','with_customer','delivered','cancelled','needs_review']) tab),
    'stages',(select jsonb_object_agg(stage,(select count(*) from filtered where r->>'centerTab'=p_tab
      and (r->>'operationalStage'=stage or (stage='needs_review' and r->>'reviewReason' is not null))))
      from unnest(array['arrived','approved','in_progress','ready','delivered','cancelled','needs_review']) stage),
    'technicians',coalesce((select jsonb_agg(name order by name) from (
      select distinct r->>'technician' name from filtered where r->>'centerTab'=p_tab and nullif(r->>'technician','') is not null
    ) names),'[]'::jsonb),
    'entryCount',(select count(*) from selected where not coalesce((r->'entry'->>'_claimOnly')::boolean,false)),
    'claimOnlyCount',(select count(*) from selected where coalesce((r->'entry'->>'_claimOnly')::boolean,false))
  ) into result;
  return result;
end;
$$;

revoke all on function public.vehicle_visit_center_resolve_v1(jsonb,jsonb,boolean,boolean,text),
  public.vehicle_visit_center_rows_v1(uuid), public.vehicle_visit_center_evidence_v1(uuid,jsonb,jsonb,boolean,boolean),
  public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer) from public,anon,authenticated;
grant execute on function public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer),
  public.vehicle_visit_center_evidence_v1(uuid,jsonb,jsonb,boolean,boolean) to authenticated;
