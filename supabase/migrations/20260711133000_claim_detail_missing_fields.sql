-- Non-destructive claim detail workflow fields used by the redesigned claim page.
-- Keep this migration additive only. Do not backfill or delete existing data here.

ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS lpo_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS lpo_requested_by uuid,
  ADD COLUMN IF NOT EXISTS lpo_followup_method text,
  ADD COLUMN IF NOT EXISTS lpo_followup_note text,
  ADD COLUMN IF NOT EXISTS lpo_received_at timestamptz,
  ADD COLUMN IF NOT EXISTS lpo_number text,
  ADD COLUMN IF NOT EXISTS lpo_amount numeric(12,3),
  ADD COLUMN IF NOT EXISTS lpo_file_url text,
  ADD COLUMN IF NOT EXISTS lpo_file_name text,
  ADD COLUMN IF NOT EXISTS vehicle_location_section text,
  ADD COLUMN IF NOT EXISTS vehicle_location_bay text,
  ADD COLUMN IF NOT EXISTS vehicle_location_note text,
  ADD COLUMN IF NOT EXISTS vehicle_location_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS vehicle_location_updated_by uuid,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS claim_registered_at timestamptz,
  ADD COLUMN IF NOT EXISTS inspection_at timestamptz,
  ADD COLUMN IF NOT EXISTS insurance_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS repair_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS quality_checked_at timestamptz,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz,
  ADD COLUMN IF NOT EXISTS invoice_collected_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_insurance_claims_lpo_requested_at
  ON public.insurance_claims (lpo_requested_at);

CREATE INDEX IF NOT EXISTS idx_insurance_claims_vehicle_location_updated_at
  ON public.insurance_claims (vehicle_location_updated_at);
