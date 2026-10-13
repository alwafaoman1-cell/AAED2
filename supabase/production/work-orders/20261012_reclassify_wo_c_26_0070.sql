-- Manual, one-record production repair. NOT a migration and NOT executed by
-- db push. Run only after 20261012100000_work_order_channel_number_alignment.
-- The insurance order WO-I-26-0070 is a different UUID and is not touched.

begin;

set local lock_timeout = '5s';
set local statement_timeout = '30s';

do $$
declare
  v_id uuid;
  v_tenant_id uuid;
  v_new_number text;
  v_matches integer;
begin
  select count(*) into v_matches
  from public.job_orders j
  join public.insurance_claims c
    on c.id = j.claim_id and c.tenant_id = j.tenant_id
  where j.order_number = 'WO-C-26-0070'
    and c.claim_number = '704/0501/2026/C/000023'
    and j.deleted_at is null
    and c.deleted_at is null;

  if v_matches <> 1 then
    raise exception 'WORK_ORDER_REPAIR_PRECHECK_FAILED: expected exactly one active matching insurance order, found %', v_matches;
  end if;

  select j.id, j.tenant_id into v_id, v_tenant_id
  from public.job_orders j
  join public.insurance_claims c
    on c.id = j.claim_id and c.tenant_id = j.tenant_id
  where j.order_number = 'WO-C-26-0070'
    and c.claim_number = '704/0501/2026/C/000023'
    and j.deleted_at is null
    and c.deleted_at is null
  for update of j;

  -- The UPDATE is intentionally a type reassertion. The channel-alignment
  -- trigger allocates the next unused insurance number for the original year.
  update public.job_orders
  set work_order_type = 'insurance'
  where id = v_id and tenant_id = v_tenant_id
  returning order_number into v_new_number;

  if v_new_number !~ '^WO-I-26-[0-9]{4}$' then
    raise exception 'WORK_ORDER_REPAIR_POSTCHECK_FAILED: insurance number was not assigned';
  end if;

  if not exists (
    select 1 from public.work_order_number_renumber_audit a
    where a.tenant_id = v_tenant_id
      and a.job_order_id = v_id
      and a.old_order_number = 'WO-C-26-0070'
      and a.new_order_number = v_new_number
  ) then
    raise exception 'WORK_ORDER_REPAIR_POSTCHECK_FAILED: old-number alias missing';
  end if;

  raise notice 'Work order number aligned: WO-C-26-0070 -> %', v_new_number;
end
$$;

commit;
