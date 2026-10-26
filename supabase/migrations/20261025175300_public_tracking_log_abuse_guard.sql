-- Public tracking remains anonymous, but a caller must present a real active
-- portal/legacy token. Never let arbitrary input fill the privileged log table.
create or replace function public.log_public_tracking_open(
  p_short_code text,
  p_target_type text default 'customer_tracking',
  p_user_agent text default null,
  p_result text default 'success'
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_token text := trim(coalesce(p_short_code, ''));
  v_order record;
  v_log_id uuid;
begin
  if v_token = '' or length(v_token) > 128
     or p_target_type is distinct from 'customer_tracking'
     or coalesce(p_result, 'success') not in ('success', 'opened', 'invalid', 'expired', 'network') then
    return jsonb_build_object('ok', false, 'error', 'invalid_request');
  end if;

  select jo.id, jo.vehicle_id, jo.claim_id into v_order
  from public.customer_portal_tokens cpt
  join public.job_orders jo on jo.id = cpt.job_order_id and jo.tenant_id = cpt.tenant_id
  where cpt.token::text = v_token and cpt.revoked_at is null and jo.deleted_at is null
  limit 1;

  if v_order.id is null then
    select jo.id, jo.vehicle_id, jo.claim_id into v_order
    from public.job_orders jo
    where jo.tracking_token::text = v_token and jo.deleted_at is null
    limit 1;
  end if;

  if v_order.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;

  -- Serialize concurrent opens of the same link before checking the window.
  perform pg_advisory_xact_lock(hashtextextended(v_token, 0));
  if exists (
    select 1 from public.public_tracking_logs l
    where l.short_code = v_token and l.opened_at >= now() - interval '1 minute'
  ) then
    return jsonb_build_object('ok', true, 'deduplicated', true);
  end if;

  insert into public.public_tracking_logs (
    short_code, target_type, vehicle_id, claim_id, work_order_id, user_agent, result
  ) values (
    v_token, 'customer_tracking', v_order.vehicle_id, v_order.claim_id, v_order.id,
    left(coalesce(p_user_agent, ''), 500),
    case when p_result = 'opened' then 'success' else coalesce(p_result, 'success') end
  ) returning id into v_log_id;

  return jsonb_build_object('ok', true, 'id', v_log_id);
exception when others then
  -- Anonymous callers must not receive internal SQL or schema details.
  return jsonb_build_object('ok', false, 'error', 'log_unavailable');
end;
$$;

revoke all on function public.log_public_tracking_open(text, text, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.log_public_tracking_open(text, text, text, text)
  to anon, authenticated, service_role;
