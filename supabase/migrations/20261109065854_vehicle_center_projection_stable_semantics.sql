-- The resolver now reads a transaction-local presentation version. Its result
-- must be evaluated at execution, not folded into an IMMUTABLE cached constant.
-- No body, privilege, source row, workflow or financial value is changed.
do $migration$
begin
  if (select md5(pg_get_functiondef(oid)) from pg_proc where oid=
      'public.vehicle_visit_center_resolve_v1(jsonb,jsonb,boolean,boolean,text)'::regprocedure)
      is distinct from '9c0d94a6d479d017d9c5565c38c51d36' then
    raise exception 'CENTER_PROJECTION_VOLATILITY_REVIEW_REQUIRED';
  end if;
  alter function public.vehicle_visit_center_resolve_v1(jsonb,jsonb,boolean,boolean,text) stable;
end;
$migration$;
