-- Versioned, read-only center contract. Prepared inspection forms are not
-- evidence of arrival or an inspection release. No source row is rewritten.
-- v1/v2 callers retain their existing five-tab contract during rollout.
do $migration$
declare body text; old_text text;
begin
  select pg_get_functiondef('public.vehicle_visit_center_page_v1(uuid,text,jsonb,integer,integer)'::regprocedure) into body;
  if md5(body)<>'6bea808c37a5d30d9379b4af51a88b73' then raise exception 'CENTER_V3_PAGE_REVIEW_REQUIRED'; end if;
  body:=replace(body,'FUNCTION public.vehicle_visit_center_page_v1(', 'FUNCTION public.vehicle_visit_center_page_v3(');
  -- Retain the same set-based, tenant-guarded evidence bridge and source-table
  -- RLS. Normalize only this version's read projection before duplicate checks,
  -- counts and paging. No new privileged bridge or per-row query is introduced.
  old_text:=$old$select r.*, p.projection from raw_rows r join projection_batch p on p.item_key=r.item_key$old$;
  if strpos(body,old_text)=0 then raise exception 'CENTER_V3_PROJECTION_REVIEW_REQUIRED'; end if;
  body:=replace(body,old_text,$new$select r.*, case
    when coalesce((r.entry->>'_claimOnly')::boolean,false)
      and r.entry->'claim'->>'status' in ('cancelled','rejected') then p.projection || jsonb_build_object(
        'stage','cancelled','operationalStage','cancelled','reviewReason','claim_without_entry','centerTab','cancelled')
    when p.projection->>'centerTab'='with_customer' and r.entry->>'vehicle_location'='مع العميل'
      and r.entry#>>'{vehicle_condition,arrival_confirmation}'='pending'
      and r.entry#>>'{vehicle_condition,visit_purpose}'='inspection'
      then jsonb_set(p.projection,'{centerTab}','"awaiting_arrival"'::jsonb)
    else p.projection end as projection
  from raw_rows r join projection_batch p on p.item_key=r.item_key$new$);
  body:=replace(body,$old$'in_workshop','with_customer','delivered','cancelled','needs_review'$old$,
    $new$'in_workshop','awaiting_arrival','with_customer','delivered','cancelled','needs_review'$new$);
  execute body;
end;
$migration$;

revoke all on function public.vehicle_visit_center_page_v3(uuid,text,jsonb,integer,integer) from public,anon;
grant execute on function public.vehicle_visit_center_page_v3(uuid,text,jsonb,integer,integer) to authenticated;
