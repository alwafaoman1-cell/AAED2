-- Non-destructive support fields for the redesigned insurance claim detail page.
-- Keeps existing claim/accounting flows intact while allowing stage dates,
-- vehicle location, and LPO metadata to persist in Supabase.

ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_collected_at timestamptz,
  ADD COLUMN IF NOT EXISTS vehicle_location_section text,
  ADD COLUMN IF NOT EXISTS vehicle_location_bay text,
  ADD COLUMN IF NOT EXISTS vehicle_location_note text,
  ADD COLUMN IF NOT EXISTS lpo_number text,
  ADD COLUMN IF NOT EXISTS lpo_date date,
  ADD COLUMN IF NOT EXISTS lpo_amount numeric(12,3),
  ADD COLUMN IF NOT EXISTS lpo_file_url text,
  ADD COLUMN IF NOT EXISTS lpo_requested_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_vehicle_location_section
  ON public.insurance_claims (tenant_id, vehicle_location_section)
  WHERE vehicle_location_section IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_lpo_number
  ON public.insurance_claims (tenant_id, lpo_number)
  WHERE lpo_number IS NOT NULL;
