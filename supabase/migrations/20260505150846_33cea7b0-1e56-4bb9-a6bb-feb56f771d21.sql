-- توسيع المزامنة الفورية لتشمل كل الجداول
ALTER TABLE public.customers REPLICA IDENTITY FULL;
ALTER TABLE public.vehicles REPLICA IDENTITY FULL;
ALTER TABLE public.inventory REPLICA IDENTITY FULL;
ALTER TABLE public.job_order_parts REPLICA IDENTITY FULL;
ALTER TABLE public.insurance_companies REPLICA IDENTITY FULL;
ALTER TABLE public.daily_tasks REPLICA IDENTITY FULL;
ALTER TABLE public.sms_logs REPLICA IDENTITY FULL;
ALTER TABLE public.tenant_sms_settings REPLICA IDENTITY FULL;
ALTER TABLE public.claim_audit_logs REPLICA IDENTITY FULL;
ALTER TABLE public.inspections REPLICA IDENTITY FULL;
ALTER TABLE public.damage_markers REPLICA IDENTITY FULL;
ALTER TABLE public.job_order_logs REPLICA IDENTITY FULL;
ALTER TABLE public.invoices REPLICA IDENTITY FULL;
ALTER TABLE public.insurance_claims REPLICA IDENTITY FULL;
ALTER TABLE public.insurance_invoices REPLICA IDENTITY FULL;
ALTER TABLE public.claim_payments REPLICA IDENTITY FULL;
ALTER TABLE public.job_orders REPLICA IDENTITY FULL;
ALTER TABLE public.profiles REPLICA IDENTITY FULL;
ALTER TABLE public.vehicle_makes REPLICA IDENTITY FULL;
ALTER TABLE public.vehicle_models REPLICA IDENTITY FULL;

DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT unnest(ARRAY[
    'customers','vehicles','inventory','job_order_parts','insurance_companies',
    'daily_tasks','sms_logs','tenant_sms_settings','claim_audit_logs',
    'inspections','damage_markers','job_order_logs','profiles',
    'vehicle_makes','vehicle_models'
  ]) LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename=t
    ) THEN
      EXECUTE format('ALTER PUBLICATION supabase_realtime ADD TABLE public.%I', t);
    END IF;
  END LOOP;
END $$;