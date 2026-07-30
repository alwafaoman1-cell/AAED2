-- Keep the Completed Without Invoice KPI aligned with its detailed report.
-- Archived completed work orders remain valid audit candidates; only deleted
-- rows and rows with an active invoice are excluded.

do $migration$
declare
  function_definition text;
  source_pattern text := 'from[[:space:]]+work_orders[[:space:]]+jo[[:space:]]+where[[:space:]]+lower\(jo\.status::text\)';
  source_matches integer;
  new_source text := $new$
from public.job_orders jo
  join authorized a on a.tenant_id = jo.tenant_id
  where jo.deleted_at is null
    and (p_from_date is null or jo.created_at::date >= p_from_date)
    and (p_to_date is null or jo.created_at::date <= p_to_date)
    and (
      p_business_type = 'all'
      or (p_business_type = 'insurance' and jo.claim_id is not null)
      or (p_business_type = 'cash' and jo.claim_id is null)
    )
    and lower(jo.status::text)
$new$;
begin
  select pg_get_functiondef(
    'public.reports_center_summary_rpc(uuid,date,date,text,uuid)'::regprocedure
  )
  into function_definition;

  select count(*)
  into source_matches
  from regexp_matches(function_definition, source_pattern, 'g');

  if source_matches <> 1 then
    raise exception 'reports_center_summary_rpc completed-without-invoice source changed; parity fix was not applied';
  end if;

  execute regexp_replace(function_definition, source_pattern, new_source);
end
$migration$;
