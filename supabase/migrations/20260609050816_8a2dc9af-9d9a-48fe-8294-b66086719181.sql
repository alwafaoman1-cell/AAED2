CREATE OR REPLACE FUNCTION public.generate_insurance_estimate_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.estimate_number IS NULL OR NEW.estimate_number = '' THEN
    NEW.estimate_number := 'INS-EST-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('public.insurance_estimate_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END;
$$;