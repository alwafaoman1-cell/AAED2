-- إضافة حقول رسمية لشركات التأمين
ALTER TABLE public.insurance_companies
  ADD COLUMN IF NOT EXISTS commercial_registration text,
  ADD COLUMN IF NOT EXISTS tax_number text,
  ADD COLUMN IF NOT EXISTS po_box text,
  ADD COLUMN IF NOT EXISTS branch_city text;