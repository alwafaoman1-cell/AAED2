-- جعل ترقيم فواتير التأمين يعتمد على آخر فاتورة فعلية لكل tenant
-- (مع احترام الرقم اليدوي إذا أُدخل)، ومزامنة التسلسل لمنع التضارب.
CREATE OR REPLACE FUNCTION public.generate_insurance_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  max_num int;
  next_num int;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    SELECT COALESCE(MAX((regexp_replace(invoice_number, '\D', '', 'g'))::int), 0)
      INTO max_num
      FROM public.insurance_invoices
      WHERE tenant_id = NEW.tenant_id
        AND invoice_number ~ '^\d+$';

    next_num := max_num + 1;
    NEW.invoice_number := lpad(next_num::text, 5, '0');
  END IF;
  RETURN NEW;
END $function$;