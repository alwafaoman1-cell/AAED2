-- تفعيل المزامنة الفورية لجداول التأمين والفواتير وأوامر العمل
ALTER TABLE public.insurance_claims REPLICA IDENTITY FULL;
ALTER TABLE public.insurance_invoices REPLICA IDENTITY FULL;
ALTER TABLE public.job_orders REPLICA IDENTITY FULL;
ALTER TABLE public.invoices REPLICA IDENTITY FULL;
ALTER TABLE public.claim_payments REPLICA IDENTITY FULL;

DO $$
BEGIN
  -- إضافة الجداول إلى publication الـ realtime إذا لم تكن مضافة
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='insurance_claims'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_claims;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='insurance_invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.insurance_invoices;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='job_orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.job_orders;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='invoices'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.invoices;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables 
    WHERE pubname = 'supabase_realtime' AND schemaname='public' AND tablename='claim_payments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.claim_payments;
  END IF;
END $$;