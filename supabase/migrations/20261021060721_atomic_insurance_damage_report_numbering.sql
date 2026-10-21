-- A report number belongs to a saved inspection, never to a PDF download.
-- Existing DR codes and report contents are deliberately left untouched.
create table if not exists public.insurance_damage_report_sequences (
  tenant_id uuid primary key references public.tenants(id) on delete cascade,
  last_number integer not null check (last_number between 1 and 99999)
);

alter table public.insurance_damage_report_sequences enable row level security;
revoke all on public.insurance_damage_report_sequences from public, anon, authenticated;

create or replace function public.save_insurance_damage_report(
  p_existing_code text,
  p_request_id uuid,
  p_work_order_number text,
  p_report jsonb
)
returns text
language plpgsql
security definer
set search_path = pg_catalog
set row_security = off
as $$
declare
  v_tenant uuid := public.get_user_tenant_id();
  v_role public.app_role := public.get_user_role();
  v_code text;
  v_next integer;
  v_max integer;
  v_order_id uuid;
  v_existing public.inspections%rowtype;
  v_report jsonb;
  v_photos integer := 0;
  v_date date;
begin
  if auth.uid() is null or v_tenant is null or v_role is null or
     v_role <> all (array[
       'admin'::public.app_role, 'manager'::public.app_role,
       'technician'::public.app_role, 'supervisor'::public.app_role
     ]) then
    raise exception 'INSPECTION_SAVE_NOT_AUTHORIZED' using errcode = '42501';
  end if;
  if p_request_id is null or p_report is null or jsonb_typeof(p_report) <> 'object' then
    raise exception 'INSPECTION_REPORT_INVALID' using errcode = '22023';
  end if;
  if nullif(trim(p_report->>'claimNo'), '') is null and
     nullif(trim(p_report->>'regNo'), '') is null then
    raise exception 'INSPECTION_CLAIM_OR_PLATE_REQUIRED' using errcode = '22023';
  end if;

  v_date := coalesce(nullif(p_report->>'date', '')::date, current_date);
  if jsonb_typeof(p_report->'photos') = 'array' then
    v_photos := v_photos + jsonb_array_length(p_report->'photos');
  end if;
  if jsonb_typeof(p_report->'annotatedImages') = 'array' then
    v_photos := v_photos + jsonb_array_length(p_report->'annotatedImages');
  end if;
  if nullif(trim(p_work_order_number), '') is not null then
    select id into v_order_id from public.job_orders
    where tenant_id = v_tenant and order_number = trim(p_work_order_number)
    limit 1;
  end if;

  if nullif(trim(p_existing_code), '') is not null then
    select * into v_existing from public.inspections
    where tenant_id = v_tenant and inspection_code = trim(p_existing_code)
      and inspection_kind = 'insurance'
    for update;
    if not found then
      raise exception 'INSPECTION_REPORT_NOT_FOUND' using errcode = 'P0002';
    end if;
    v_code := v_existing.inspection_code;
    v_report := p_report || jsonb_build_object('reportNo', v_code);
    update public.inspections set
      job_order_id = coalesce(v_order_id, v_existing.job_order_id),
      customer_name = nullif(trim(v_report->>'customer'), ''),
      vehicle_summary = nullif(trim(v_report->>'makeModel'), ''),
      plate_number = nullif(trim(v_report->>'regNo'), ''),
      inspection_date = v_date,
      damage_type = 'Insurance Inspection — ' || coalesce(nullif(trim(v_report->>'insuranceCompany'), ''), '—'),
      photo_count = v_photos,
      status = 'مكتمل',
      details = coalesce(v_existing.details, '{}'::jsonb) ||
        jsonb_build_object('insuranceInspectionReport', v_report, 'claimNo', v_report->>'claimNo')
    where id = v_existing.id;
    return v_code;
  end if;

  -- The lock makes both allocation and retry of the same request atomic.
  perform pg_advisory_xact_lock(hashtextextended(v_tenant::text || ':insurance-damage-report', 0));
  select inspection_code into v_code from public.inspections
  where tenant_id = v_tenant and inspection_kind = 'insurance'
    and details->>'insuranceDamageSaveRequestId' = p_request_id::text
  limit 1;
  if found then return v_code; end if;

  select coalesce(max(substring(inspection_code from '^DR-([0-9]{5})$')::integer), 0)
    into v_max from public.inspections where tenant_id = v_tenant;
  insert into public.insurance_damage_report_sequences (tenant_id, last_number)
  values (v_tenant, v_max + 1)
  on conflict (tenant_id) do update set
    last_number = greatest(public.insurance_damage_report_sequences.last_number, excluded.last_number - 1) + 1
  returning last_number into v_next;
  if v_next > 99999 then
    raise exception 'INSPECTION_REPORT_NUMBER_LIMIT' using errcode = '22003';
  end if;
  v_code := 'DR-' || lpad(v_next::text, 5, '0');
  v_report := p_report || jsonb_build_object('reportNo', v_code);

  insert into public.inspections (
    tenant_id, inspection_code, inspection_kind, job_order_id,
    customer_name, vehicle_summary, plate_number, inspection_date,
    damage_type, photo_count, status, details
  ) values (
    v_tenant, v_code, 'insurance', v_order_id,
    nullif(trim(v_report->>'customer'), ''),
    nullif(trim(v_report->>'makeModel'), ''),
    nullif(trim(v_report->>'regNo'), ''), v_date,
    'Insurance Inspection — ' || coalesce(nullif(trim(v_report->>'insuranceCompany'), ''), '—'),
    v_photos, 'مكتمل',
    jsonb_build_object('insuranceInspectionReport', v_report,
      'insuranceDamageSaveRequestId', p_request_id::text,
      'claimNo', v_report->>'claimNo')
  );
  return v_code;
end;
$$;

revoke all on function public.save_insurance_damage_report(text, uuid, text, jsonb) from public, anon;
grant execute on function public.save_insurance_damage_report(text, uuid, text, jsonb) to authenticated;
