-- Reset sequence to start fresh from 1
ALTER SEQUENCE public.insurance_estimate_seq RESTART WITH 1;

-- Simplify numbering function to produce 1, 2, 3, …
CREATE OR REPLACE FUNCTION public.generate_insurance_estimate_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.estimate_number IS NULL OR NEW.estimate_number = '' THEN
    NEW.estimate_number := nextval('public.insurance_estimate_seq')::text;
  END IF;
  RETURN NEW;
END $function$;