CREATE OR REPLACE FUNCTION public.generate_invoice_secure_token()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.secure_token IS NULL OR NEW.secure_token = '' THEN
    NEW.secure_token := encode(extensions.gen_random_bytes(24), 'hex');
  END IF;
  RETURN NEW;
END
$$;

UPDATE public.insurance_invoices
SET secure_token = encode(extensions.gen_random_bytes(24), 'hex')
WHERE secure_token IS NULL;
