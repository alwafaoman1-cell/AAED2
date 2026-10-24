-- Keep legacy queue/seed logic and trigger behavior, but remove its public
-- SECURITY DEFINER entry point. Wrappers validate tenant identity first.
alter function public.enqueue_customer_notification(uuid, uuid, text, text, text, boolean)
  rename to enqueue_customer_notification_internal;
revoke all on function public.enqueue_customer_notification_internal(uuid, uuid, text, text, text, boolean)
  from public, anon, authenticated, service_role;

create function public.enqueue_customer_notification(
  p_tenant_id uuid,
  p_job_order_id uuid,
  p_event_type text,
  p_body text,
  p_channel text default null,
  p_force boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
declare
  v_order_tenant uuid;
  v_customer_tenant uuid;
  v_customer_id uuid;
  v_role text := current_setting('request.jwt.claim.role', true);
begin
  if auth.uid() is not null then
    if p_tenant_id is distinct from public.get_user_tenant_id() then
      raise exception 'CUSTOMER_NOTIFICATION_TENANT_DENIED' using errcode = '42501';
    end if;
  elsif pg_trigger_depth() = 0 and v_role is distinct from 'service_role' then
    raise exception 'CUSTOMER_NOTIFICATION_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select tenant_id, customer_id into v_order_tenant, v_customer_id
    from public.job_orders where id = p_job_order_id;
  if v_order_tenant is null or v_order_tenant is distinct from p_tenant_id then
    raise exception 'CUSTOMER_NOTIFICATION_ORDER_TENANT_DENIED' using errcode = '42501';
  end if;
  if v_customer_id is not null then
    select tenant_id into v_customer_tenant from public.customers where id = v_customer_id;
    if v_customer_tenant is null or v_customer_tenant is distinct from p_tenant_id then
      raise exception 'CUSTOMER_NOTIFICATION_CUSTOMER_TENANT_DENIED' using errcode = '42501';
    end if;
  end if;
  return public.enqueue_customer_notification_internal(
    p_tenant_id, p_job_order_id, p_event_type, p_body, p_channel, p_force
  );
end;
$function$;
revoke all on function public.enqueue_customer_notification(uuid, uuid, text, text, text, boolean)
  from public, anon;
grant execute on function public.enqueue_customer_notification(uuid, uuid, text, text, text, boolean)
  to authenticated, service_role;

alter function public.seed_default_notification_settings(uuid)
  rename to seed_default_notification_settings_internal;
revoke all on function public.seed_default_notification_settings_internal(uuid)
  from public, anon, authenticated, service_role;

create function public.seed_default_notification_settings(p_tenant_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $function$
begin
  if auth.uid() is not null then
    if p_tenant_id is distinct from public.get_user_tenant_id() then
      raise exception 'CUSTOMER_NOTIFICATION_SETTINGS_TENANT_DENIED' using errcode = '42501';
    end if;
  elsif current_setting('request.jwt.claim.role', true) is distinct from 'service_role' then
    raise exception 'CUSTOMER_NOTIFICATION_SETTINGS_AUTH_REQUIRED' using errcode = '42501';
  end if;
  perform public.seed_default_notification_settings_internal(p_tenant_id);
end;
$function$;
revoke all on function public.seed_default_notification_settings(uuid) from public, anon;
grant execute on function public.seed_default_notification_settings(uuid) to authenticated, service_role;
