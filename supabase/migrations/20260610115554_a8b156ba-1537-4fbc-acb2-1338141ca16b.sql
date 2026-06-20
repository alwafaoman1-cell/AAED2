CREATE OR REPLACE FUNCTION public.generate_insurance_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- ترقيم تسلسلي مختصر للفواتير الضريبية: 00001, 00002, 00003 ...
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.invoice_number := lpad(nextval('public.insurance_invoice_seq')::text, 5, '0');
  END IF;
  RETURN NEW;
END $function$;