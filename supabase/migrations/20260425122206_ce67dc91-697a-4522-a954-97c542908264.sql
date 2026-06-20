ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS vehicle_owner_name text,
  ADD COLUMN IF NOT EXISTS vehicle_owner_phone text,
  ADD COLUMN IF NOT EXISTS estimated_cost numeric DEFAULT 0;
