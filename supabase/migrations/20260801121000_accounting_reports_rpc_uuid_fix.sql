-- Correct Phase 4 report RPC without mutating any accounting or operational row.
do $$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='accounting_report_rpc'
    and pg_get_function_identity_arguments(p.oid)='p_report_key text, p_from date, p_to date, p_page integer, p_page_size integer, p_search text, p_filters jsonb, p_sort text, p_direction text';
  if v_definition is null then raise exception 'ACCOUNTING_REPORT_RPC_NOT_FOUND'; end if;
  v_definition:=replace(v_definition,'min(id) id,min(date) date','min(id::text)::uuid id,min(date) date');
  if position('p_filters->>''entry_id''' in v_definition)=0 then
    v_definition:=replace(v_definition,
      'and (p_from is null or e.accounting_date>=p_from) and (p_to is null or e.accounting_date<=p_to)',
      'and (p_from is null or e.accounting_date>=p_from) and (p_to is null or e.accounting_date<=p_to)'||E'\n        and (nullif(p_filters->>''entry_id'','''') is null or e.id=(p_filters->>''entry_id'')::uuid)');
  end if;
  if position('p_filters->>''work_order_id''' in v_definition)=0 then
    v_definition:=replace(v_definition,
      'and (nullif(p_filters->>''cost_center_id'','''') is null or l.cost_center_id=(p_filters->>''cost_center_id'')::uuid)',
      'and (nullif(p_filters->>''cost_center_id'','''') is null or l.cost_center_id=(p_filters->>''cost_center_id'')::uuid)'||E'\n        and (nullif(p_filters->>''work_order_id'','''') is null or l.work_order_id=(p_filters->>''work_order_id'')::uuid)');
  end if;
  execute v_definition;
end $$;
