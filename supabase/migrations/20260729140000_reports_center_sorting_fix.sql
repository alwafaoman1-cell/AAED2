-- Preserve the requested row ordering when the paged rows are aggregated to JSON.
-- The original query selected the correct page, but its final jsonb_agg always
-- reordered that page by report_date descending.

do $migration$
declare
  function_definition text;
  old_aggregate text :=
    'select jsonb_agg(to_jsonb(p) - ''tenant_id'' - ''report_key'' order by p.report_date desc, p.record_id)';
  new_aggregate text := $new$
select jsonb_agg(
      to_jsonb(p) - 'tenant_id' - 'report_key'
      order by
        case when p_direction = 'asc' and p_sort = 'reference'
          then p.reference end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'reference'
          then p.reference end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'party_name'
          then p.party_name end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'party_name'
          then p.party_name end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'invoice_total'
          then p.invoice_total end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'invoice_total'
          then p.invoice_total end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'outstanding'
          then p.outstanding end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'outstanding'
          then p.outstanding end desc nulls last,
        case when p_direction = 'asc' and p_sort = 'gross_profit'
          then p.gross_profit end asc nulls last,
        case when p_direction = 'desc' and p_sort = 'gross_profit'
          then p.gross_profit end desc nulls last,
        case when p_direction = 'asc' then p.report_date end asc nulls last,
        case when p_direction <> 'asc' then p.report_date end desc nulls last,
        p.record_id
    )
$new$;
begin
  select pg_get_functiondef(
    'public.reports_center_query_rpc(uuid,text,date,date,text,jsonb,text,text,text,integer,integer)'::regprocedure
  )
  into function_definition;

  if position(old_aggregate in function_definition) = 0 then
    raise exception 'reports_center_query_rpc aggregate signature changed; sorting fix was not applied';
  end if;

  execute replace(function_definition, old_aggregate, new_aggregate);
end
$migration$;
