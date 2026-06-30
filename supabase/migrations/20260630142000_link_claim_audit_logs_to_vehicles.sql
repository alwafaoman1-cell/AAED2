-- Link claim audit events to the affected vehicle so the same cloud log can be
-- used as a real vehicle history without duplicating events.
ALTER TABLE public.claim_audit_logs
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_claim_audit_vehicle
  ON public.claim_audit_logs(vehicle_id)
  WHERE vehicle_id IS NOT NULL;

UPDATE public.claim_audit_logs AS log
SET vehicle_id = claim.vehicle_id
FROM public.insurance_claims AS claim
WHERE log.claim_id = claim.id
  AND log.vehicle_id IS NULL
  AND claim.vehicle_id IS NOT NULL;
