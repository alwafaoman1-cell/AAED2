SET LOCAL lock_timeout = '20s';
SET LOCAL statement_timeout = '60s';

-- Lock all touched tables upfront in a consistent alphabetical order
LOCK TABLE public.customer_advances IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.insurance_claims  IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.job_orders        IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public.vehicles          IN ACCESS EXCLUSIVE MODE;

-- 1) Normalize
UPDATE public.vehicles
SET plate_letters = public.extract_plate_letters(COALESCE(plate_letters,'') || COALESCE(plate_number,'')),
    plate_number  = public.extract_plate_digits(plate_number),
    plate_country = COALESCE(NULLIF(upper(trim(plate_country)), ''), 'OM')
WHERE plate_letters IS NULL OR plate_letters = ''
   OR plate_country IS NULL OR plate_country = '';

-- 2) Merge duplicates
DO $$
DECLARE
  r RECORD; v_master uuid; v_dup_ids uuid[];
BEGIN
  FOR r IN
    SELECT tenant_id, COALESCE(plate_letters,'') AS L, plate_number AS D,
           COALESCE(plate_country,'OM') AS C, array_agg(id ORDER BY created_at ASC) AS ids
    FROM public.vehicles
    GROUP BY tenant_id, COALESCE(plate_letters,''), plate_number, COALESCE(plate_country,'OM')
    HAVING COUNT(*) > 1
  LOOP
    v_master := r.ids[1];
    v_dup_ids := r.ids[2:array_length(r.ids,1)];
    UPDATE public.job_orders        SET vehicle_id = v_master WHERE vehicle_id = ANY(v_dup_ids);
    UPDATE public.insurance_claims  SET vehicle_id = v_master WHERE vehicle_id = ANY(v_dup_ids);
    UPDATE public.customer_advances SET vehicle_id = v_master WHERE vehicle_id = ANY(v_dup_ids);
    DELETE FROM public.vehicles WHERE id = ANY(v_dup_ids);
  END LOOP;
END $$;

-- 3) Unique constraint
ALTER TABLE public.vehicles
  ADD CONSTRAINT uniq_vehicle_plate
  UNIQUE (tenant_id, plate_letters, plate_number, plate_country);

-- 4) Duplicates view
DROP VIEW IF EXISTS public.vehicle_duplicates;
CREATE VIEW public.vehicle_duplicates AS
SELECT tenant_id, COALESCE(plate_letters,'') AS plate_letters, plate_number,
       COALESCE(plate_country,'OM') AS plate_country, COUNT(*) AS dup_count,
       array_agg(id ORDER BY created_at ASC) AS vehicle_ids
FROM public.vehicles
GROUP BY tenant_id, COALESCE(plate_letters,''), plate_number, COALESCE(plate_country,'OM')
HAVING COUNT(*) > 1;

GRANT SELECT ON public.vehicle_duplicates TO authenticated;
GRANT ALL ON public.vehicle_duplicates TO service_role;