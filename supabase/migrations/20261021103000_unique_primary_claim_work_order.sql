-- Final database invariant. Apply only after reconciling any pre-existing
-- duplicate primary orders; never delete or renumber historical rows here.
do $$
begin
  if exists (
    select 1
    from public.job_orders
    where claim_id is not null and deleted_at is null and parent_work_order_id is null
    group by tenant_id, claim_id
    having count(*) > 1
  ) then
    raise exception 'Existing duplicate primary claim work orders require reviewed reconciliation before this unique index';
  end if;
end;
$$;

create unique index if not exists uq_job_orders_one_primary_claim_per_tenant
  on public.job_orders (tenant_id, claim_id)
  where claim_id is not null and deleted_at is null and parent_work_order_id is null;
