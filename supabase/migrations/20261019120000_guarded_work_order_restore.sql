-- Restore exactly one soft-deleted work order. Keep delivered/closed orders
-- archived so they cannot reappear in active workshop or supervisor lists.
create or replace function public.restore_deleted_work_order(
  p_order_id uuid,
  p_expected_deleted_at timestamptz
)
returns public.job_orders
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_old public.job_orders%rowtype;
  v_new public.job_orders%rowtype;
begin
  if auth.uid() is null or v_tenant is null
     or public.get_user_role()::text not in ('admin', 'manager') then
    raise exception 'WORK_ORDER_RESTORE_PERMISSION_DENIED' using errcode = '42501';
  end if;
  if p_order_id is null or p_expected_deleted_at is null then
    raise exception 'WORK_ORDER_RESTORE_INPUT_REQUIRED' using errcode = '22023';
  end if;

  select * into v_old
    from public.job_orders
   where id = p_order_id and tenant_id = v_tenant
   for update;
  if not found then
    raise exception 'WORK_ORDER_RESTORE_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_old.deleted_at is distinct from p_expected_deleted_at then
    raise exception 'WORK_ORDER_RESTORE_STALE' using errcode = '40001';
  end if;

  update public.job_orders
     set deleted_at = null,
         deleted_by = null,
         archived_at = case
           when lower(coalesce(v_old.status::text, '')) in ('delivered', 'closed', 'تم التسليم', 'مغلق')
             then coalesce(v_old.archived_at, v_old.vehicle_delivered_at, v_old.completed_at, v_old.deleted_at)
           when v_old.archived_at is not distinct from v_old.deleted_at
             then null
           else v_old.archived_at
         end
   where id = v_old.id and tenant_id = v_tenant
   returning * into v_new;

  update public.app_trash
     set restore_status = 'restored',
         restored_at = now(),
         restored_by = auth.uid()
   where tenant_id = v_tenant
     and entity_type = 'work_order'
     and entity_id in (v_old.id::text, v_old.order_number)
     and restore_status = 'trashed';

  insert into public.operational_audit_log (
    tenant_id, user_id, action, entity_type, entity_id, delete_mode,
    before_snapshot, after_snapshot
  ) values (
    v_tenant, auth.uid(), 'work_order_restored', 'work_order',
    v_old.order_number, 'restore_work_order_only',
    jsonb_build_object('id', v_old.id, 'status', v_old.status,
      'deleted_at', v_old.deleted_at, 'archived_at', v_old.archived_at),
    jsonb_build_object('id', v_new.id, 'status', v_new.status,
      'deleted_at', v_new.deleted_at, 'archived_at', v_new.archived_at)
  );

  return v_new;
end;
$$;

revoke all on function public.restore_deleted_work_order(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.restore_deleted_work_order(uuid, timestamptz) to authenticated;
