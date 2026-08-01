-- Exact formatting variant produced by pg_get_functiondef on Development.
do $$
declare v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='accounting_vehicle_profit_loss_rpc';
  if v_definition is null then raise exception 'ACCOUNTING_VEHICLE_PNL_RPC_NOT_FOUND';end if;
  v_definition:=replace(v_definition,'w.id::text=i.work_order_id','w.id=i.work_order_id');
  v_definition:=replace(v_definition,'w.id::text=e.work_order_id','w.id=e.work_order_id');
  v_definition:=replace(v_definition,'i.work_order_id=w.id::text','i.work_order_id=w.id');
  v_definition:=replace(v_definition,'x.work_order_id=w.id::text','x.work_order_id=w.id');
  v_definition:=replace(v_definition,'le.work_order_id=w.id::text','le.work_order_id=w.id');
  execute v_definition;
end$$;
