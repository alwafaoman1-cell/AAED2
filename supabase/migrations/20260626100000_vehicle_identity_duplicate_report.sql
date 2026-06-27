-- Vehicle identity safety report only.
-- Primary matching key is plate identity:
-- tenant_id + normalized_plate_number + normalized_plate_letters/plate_code + plate_country.
-- VIN is reported as an optional secondary duplicate signal only, not as the primary matching key.
-- This migration intentionally DOES NOT add unique constraints.
-- Use these reports first, merge duplicates safely, then add approved constraints later:
--   1) primary optional unique index for complete plate identity
--   2) optional secondary unique index for non-empty VIN only

CREATE OR REPLACE VIEW public.vehicle_identity_duplicate_report AS
WITH normalized AS (
  SELECT
    id,
    tenant_id,
    customer_id,
    upper(regexp_replace(coalesce(vin_number, vin, ''), '\s+', '', 'g')) AS normalized_vin,
    regexp_replace(coalesce(plate_number, ''), '\D+', '', 'g') AS normalized_plate_number,
    upper(regexp_replace(coalesce(plate_letters, ''), '[^A-Za-z]+', '', 'g')) AS normalized_plate_code,
    coalesce(nullif(upper(trim(plate_country)), ''), 'OM') AS plate_country,
    created_at
  FROM public.vehicles
)
SELECT
  tenant_id,
  'plate'::text AS duplicate_type,
  concat_ws('|', normalized_plate_code, normalized_plate_number, plate_country) AS duplicate_key,
  array_agg(id ORDER BY created_at, id) AS vehicle_ids,
  count(*) AS duplicate_count
FROM normalized
WHERE normalized_plate_number <> ''
  AND normalized_plate_code <> ''
  AND plate_country <> ''
GROUP BY tenant_id, normalized_plate_code, normalized_plate_number, plate_country
HAVING count(*) > 1
UNION ALL
SELECT
  tenant_id,
  'vin_secondary'::text AS duplicate_type,
  normalized_vin AS duplicate_key,
  array_agg(id ORDER BY created_at, id) AS vehicle_ids,
  count(*) AS duplicate_count
FROM normalized
WHERE normalized_vin <> ''
GROUP BY tenant_id, normalized_vin
HAVING count(*) > 1;

CREATE OR REPLACE FUNCTION public.find_vehicle_by_vin(p_vin text)
RETURNS TABLE (
  id uuid,
  customer_id uuid,
  plate_number text,
  plate_letters text,
  plate_country text,
  brand text,
  model text,
  year integer,
  color text,
  archived boolean
)
LANGUAGE sql
SECURITY INVOKER
STABLE
AS $$
  SELECT
    v.id, v.customer_id, v.plate_number, v.plate_letters, v.plate_country,
    v.brand, v.model, v.year, v.color, coalesce(v.archived, false)
  FROM public.vehicles v
  WHERE v.tenant_id = public.get_user_tenant_id()
    AND upper(regexp_replace(coalesce(v.vin_number, v.vin, ''), '\s+', '', 'g'))
        = upper(regexp_replace(coalesce(p_vin, ''), '\s+', '', 'g'))
  ORDER BY coalesce(v.archived, false), v.created_at ASC
  LIMIT 5;
$$;

GRANT SELECT ON public.vehicle_identity_duplicate_report TO authenticated;
GRANT EXECUTE ON FUNCTION public.find_vehicle_by_vin(text) TO authenticated;
