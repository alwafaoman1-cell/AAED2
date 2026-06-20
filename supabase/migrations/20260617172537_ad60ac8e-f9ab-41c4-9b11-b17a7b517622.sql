ALTER TABLE public.insurance_claims ADD COLUMN IF NOT EXISTS vehicle_vin text;
ALTER TABLE public.insurance_invoices ADD COLUMN IF NOT EXISTS vehicle_vin text;