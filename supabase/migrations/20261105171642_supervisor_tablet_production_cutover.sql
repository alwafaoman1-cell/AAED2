-- Authorized selective Production cutover: Supervisor tablet workspace.
-- Rehearsed against actual Production with no operational row changes.
-- Development expense dependency is deliberately excluded: Production already
-- has that contract. Preserve its existing read scope, triggers and accounting.
set local lock_timeout='2s';
set local statement_timeout='70s';
do $preflight$
begin
  if md5(pg_get_functiondef('public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure))<>'76a9abd04d4aa664fa6222416bf7d31a'
    or to_regprocedure('public.create_vehicle_inspection_release_view_link(uuid,integer)') is not null
    or md5(pg_get_functiondef('public.expense_duplicate_candidates_rpc(jsonb,uuid)'::regprocedure))<>'519ba8c609c86a5c6788ae2c515017ce'
    then raise exception 'SUPERVISOR_PRODUCTION_CATALOGUE_DRIFT'; end if;
end $preflight$;

;
-- COMPONENT supabase/migrations/20261105115513_supervisor_center_channel_filter.sql SHA256 5f797d6a5b92ddbe129cca62ff979e749f0b0a59d615d34d2e5dd4fdd7c83d9e
-- Development first. Read-only projection only: keep existing RLS, sources,
-- pagination, counts and scope token. No backfill and no business-row writes.
do $migration$
declare
  definition text;
  anchor text := '    and (coalesce(p_filters->>''status'',''all'')=''all'' or r->''entry''->>''status''=p_filters->>''status'')';
  insertion text := $filter$
    -- supervisor_channel_filter_v1: same contract as getVehicleVisitBillingKind.
    and (coalesce(p_filters->>'channel','all')='all' or p_filters->>'channel' = case when
      nullif(r->'entry'->>'insurance_claim_id','') is not null
      or nullif(r->'entry'->>'converted_claim_id','') is not null
      or nullif(r->'entry'->>'insurance_company_id','') is not null
      or r->'entry'->'insurance_snapshot'->'is_insurance_related'='true'::jsonb
      or nullif(btrim(r->'entry'->'insurance_snapshot'->>'claim_number'),'') is not null
      or nullif(btrim(r->'entry'->'insurance_snapshot'->>'company_name'),'') is not null
      or coalesce(nullif(r->'entry'->'work_order','null'::jsonb),nullif(r->'entry'->'converted_work_order','null'::jsonb))->>'work_order_type'='insurance'
      then 'insurance' else 'cash' end)
$filter$;
begin
  if not exists(select 1 from pg_proc where oid='public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure
    and not prosecdef and provolatile='s') then raise exception 'SUPERVISOR_CENTER_SECURITY_CONTRACT_CHANGED'; end if;
  select pg_get_functiondef('public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure) into definition;
  if position('supervisor_channel_filter_v1' in definition)>0 then
    if position(insertion in definition)=0 then raise exception 'SUPERVISOR_CENTER_FILTER_DRIFT'; end if;
    return;
  end if;
  if (length(definition)-length(replace(definition,anchor,'')))/length(anchor) <> 1
    or position('  with center_rows as materialized (' in definition)=0 then
    raise exception 'SUPERVISOR_CENTER_PROJECTION_DRIFT';
  end if;
  definition := replace(definition,anchor,insertion || anchor);
  definition := replace(definition,'  with center_rows as materialized (',
    '  if coalesce(p_filters->>''channel'',''all'') not in (''all'',''cash'',''insurance'') then raise exception ''VEHICLE_CENTER_INVALID_REQUEST''; end if;' || chr(10) || '  with center_rows as materialized (');
  execute definition;
end;
$migration$;

;
-- COMPONENT supabase/migrations/20261105120421_vehicle_inspection_release_readonly_link.sql SHA256 52f5c218c75387e9578958d20b0a84d21f0a1aedf327a70942711609ce7f9fb2
-- A completed temporary release is a signed historical document. Its customer
-- read link must never reopen it or authorize another signature. Reuse the
-- existing token table/public receipt renderer, with signing already consumed.
create function public.create_vehicle_inspection_release_view_link(
  p_release_id uuid, p_expires_hours integer default 168
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_release public.vehicle_inspection_releases%rowtype;
  v_entry public.vehicle_entries%rowtype;
  v_token text;
  v_expiry timestamptz;
begin
  if auth.uid() is null or v_tenant is null or coalesce(public.get_user_role()::text,'') not in ('admin','manager','insurance','supervisor')
    or not exists(select 1 from public.profiles p where p.user_id=auth.uid() and p.tenant_id=v_tenant and p.account_status='active' and p.disabled_at is null)
    then raise exception 'inspection_release_permission_denied' using errcode='42501'; end if;
  select * into v_release from public.vehicle_inspection_releases where id=p_release_id and tenant_id=v_tenant;
  if not found then raise exception 'inspection_release_not_found'; end if;
  select * into v_entry from public.vehicle_entries where id=v_release.vehicle_entry_id and tenant_id=v_tenant and deleted_at is null for update;
  if not found or v_entry.status not in ('Received','Issued','Converted to Claim','Converted to Work Order') then raise exception 'entry_unavailable'; end if;
  select * into v_release from public.vehicle_inspection_releases where id=p_release_id and tenant_id=v_tenant for update;
  if not found or v_release.status<>'signed' or v_release.released_at is null or v_release.returned_at is not null
    or v_entry.vehicle_location is distinct from 'مع العميل' then raise exception 'inspection_release_not_finalized'; end if;
  if (v_entry.insurance_claim_id is not null and v_entry.converted_claim_id is not null and v_entry.insurance_claim_id<>v_entry.converted_claim_id)
    or (v_entry.work_order_id is not null and v_entry.converted_work_order_id is not null and v_entry.work_order_id<>v_entry.converted_work_order_id)
    or coalesce(v_entry.insurance_claim_id,v_entry.converted_claim_id) is distinct from v_release.claim_id
    or coalesce(v_entry.work_order_id,v_entry.converted_work_order_id) is distinct from v_release.work_order_id then raise exception 'inspection_release_link_conflict'; end if;
  if v_release.claim_id is not null and not exists(select 1 from public.insurance_claims c
    where c.id=v_release.claim_id and c.tenant_id=v_tenant and c.deleted_at is null and c.vehicle_id=v_entry.vehicle_id
      and c.vehicle_presence_status='with_customer' and c.status::text not in ('cancelled','rejected','paid') and c.delivered_at is null and c.vehicle_delivered_at is null)
    then raise exception 'linked_claim_not_active'; end if;
  if v_release.work_order_id is not null and not exists(select 1 from public.job_orders j
    where j.id=v_release.work_order_id and j.tenant_id=v_tenant and j.deleted_at is null and j.vehicle_id=v_entry.vehicle_id
      and j.claim_id is not distinct from v_release.claim_id and j.vehicle_presence_status='with_customer' and j.status::text<>'delivered' and j.vehicle_delivered_at is null)
    then raise exception 'linked_work_order_not_active'; end if;
  v_token := encode(extensions.gen_random_bytes(32),'hex');
  v_expiry := now()+make_interval(hours=>greatest(1,least(coalesce(p_expires_hours,168),168)));
  insert into public.vehicle_inspection_release_links(tenant_id,release_id,token_hash,expires_at,consumed_at,created_by)
    values(v_tenant,v_release.id,encode(extensions.digest(v_token,'sha256'),'hex'),v_expiry,now(),auth.uid());
  insert into public.vehicle_entry_audit_logs(tenant_id,vehicle_entry_id,user_id,action,new_value)
    values(v_tenant,v_entry.id,auth.uid(),'vehicle_inspection_release.view_link_created',jsonb_build_object('release_id',v_release.id,'expires_at',v_expiry,'view_only',true));
  return jsonb_build_object('token',v_token,'expires_at',v_expiry,'view_only',true,'release_id',v_release.id);
end;
$$;
revoke all on function public.create_vehicle_inspection_release_view_link(uuid,integer) from public,anon,authenticated;
grant execute on function public.create_vehicle_inspection_release_view_link(uuid,integer) to authenticated;
comment on function public.create_vehicle_inspection_release_view_link(uuid,integer) is 'Staff-only same-tenant capability for an already signed temporary release. Consumed at creation: cannot authorize signing, never reopens a release.';

;
-- COMPONENT supabase/migrations/20261105155349_supervisor_media_realtime_dependency.sql SHA256 11f119a650a3da99e84f7a3feee5ac5710113064749cbdcfcc9daa92942304c1
-- Complete the existing tenant-filtered subscription, without changing rows,
-- grants, RLS or replica identity. Missing media publication must not degrade
-- the Supervisor's shared image readers into an assumed live subscription.
set local lock_timeout='2s';
set local statement_timeout='10s';
do $guard$
begin
  if not exists(select 1 from pg_publication where pubname='supabase_realtime' and not puballtables) then
    raise exception 'EXPECTED_REALTIME_PUBLICATION_REQUIRED';
  end if;
  if not exists(select 1 from pg_class where oid='public.vehicle_media'::regclass and relrowsecurity)
    or not exists(select 1 from information_schema.columns where table_schema='public' and table_name='vehicle_media' and column_name='tenant_id') then
    raise exception 'TENANT_MEDIA_RLS_REQUIRED';
  end if;
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='vehicle_media') then
    alter publication supabase_realtime add table public.vehicle_media;
  end if;
end $guard$;

