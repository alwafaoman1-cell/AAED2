-- Non-destructive support for vehicle thumbnails and richer expense linking.
-- No data is deleted and no strict constraints are added.

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS vehicle_cover_image_url text,
  ADD COLUMN IF NOT EXISTS vehicle_thumbnail_url text;

ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claim_id uuid REFERENCES public.insurance_claims(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invoice_id uuid;

CREATE INDEX IF NOT EXISTS idx_expenses_customer_id ON public.expenses(customer_id);
CREATE INDEX IF NOT EXISTS idx_expenses_vehicle_id ON public.expenses(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_expenses_claim_id ON public.expenses(claim_id);
CREATE INDEX IF NOT EXISTS idx_expenses_invoice_id ON public.expenses(invoice_id);
CREATE INDEX IF NOT EXISTS idx_vehicles_cover_image ON public.vehicles(vehicle_cover_image_url) WHERE vehicle_cover_image_url IS NOT NULL;
