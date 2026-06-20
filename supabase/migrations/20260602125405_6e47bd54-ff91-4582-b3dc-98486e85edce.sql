ALTER TABLE public.suppliers
  ADD COLUMN IF NOT EXISTS vehicle_brands text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS category text;

CREATE INDEX IF NOT EXISTS idx_suppliers_vehicle_brands
  ON public.suppliers USING GIN (vehicle_brands);