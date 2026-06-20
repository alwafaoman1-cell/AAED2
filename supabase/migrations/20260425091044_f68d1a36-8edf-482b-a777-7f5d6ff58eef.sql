-- Make job_order_id optional
ALTER TABLE public.insurance_claims ALTER COLUMN job_order_id DROP NOT NULL;

-- Add new fields
ALTER TABLE public.insurance_claims
  ADD COLUMN IF NOT EXISTS incident_date timestamp with time zone,
  ADD COLUMN IF NOT EXISTS incident_location text,
  ADD COLUMN IF NOT EXISTS incident_description text,
  ADD COLUMN IF NOT EXISTS policy_number text,
  ADD COLUMN IF NOT EXISTS policy_expiry_date date,
  ADD COLUMN IF NOT EXISTS adjuster_name text,
  ADD COLUMN IF NOT EXISTS adjuster_phone text,
  ADD COLUMN IF NOT EXISTS deductible_amount numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS inspection_id uuid,
  ADD COLUMN IF NOT EXISTS damage_photos text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS documents jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS needed_parts jsonb DEFAULT '[]'::jsonb;

-- Trigger updated_at
DROP TRIGGER IF EXISTS update_insurance_claims_updated_at ON public.insurance_claims;
CREATE TRIGGER update_insurance_claims_updated_at
  BEFORE UPDATE ON public.insurance_claims
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Storage bucket for insurance documents
INSERT INTO storage.buckets (id, name, public)
VALUES ('insurance-docs', 'insurance-docs', true)
ON CONFLICT (id) DO NOTHING;

-- RLS policies for insurance-docs bucket
DROP POLICY IF EXISTS "Public read insurance docs" ON storage.objects;
CREATE POLICY "Public read insurance docs"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'insurance-docs');

DROP POLICY IF EXISTS "Staff upload insurance docs" ON storage.objects;
CREATE POLICY "Staff upload insurance docs"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'insurance-docs'
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'technician'::app_role, 'insurance'::app_role])
  );

DROP POLICY IF EXISTS "Staff update insurance docs" ON storage.objects;
CREATE POLICY "Staff update insurance docs"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'insurance-docs'
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
  );

DROP POLICY IF EXISTS "Staff delete insurance docs" ON storage.objects;
CREATE POLICY "Staff delete insurance docs"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'insurance-docs'
    AND public.get_user_role() = ANY (ARRAY['admin'::app_role, 'manager'::app_role, 'insurance'::app_role])
  );