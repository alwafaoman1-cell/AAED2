-- مقترح فقط — لم يُطبق ولم يُضف إلى supabase/migrations
-- يجب تشغيل قسم الفحص أولاً ومعالجة أي نتائج قبل إنشاء الفهارس.

-- ============================================================
-- 1) كشف التكرارات
-- ============================================================

-- أرقام المطالبات المكررة داخل نفس المستأجر
SELECT tenant_id, lower(trim(claim_number)) AS normalized_claim_number, count(*) AS duplicate_count
FROM public.insurance_claims
WHERE nullif(trim(claim_number), '') IS NOT NULL
GROUP BY tenant_id, lower(trim(claim_number))
HAVING count(*) > 1;

-- أرقام أوامر العمل المكررة داخل نفس المستأجر
SELECT tenant_id, lower(trim(order_number)) AS normalized_order_number, count(*) AS duplicate_count
FROM public.job_orders
WHERE nullif(trim(order_number), '') IS NOT NULL
GROUP BY tenant_id, lower(trim(order_number))
HAVING count(*) > 1;

-- أرقام فواتير المبيعات المكررة داخل نفس المستأجر والنوع
SELECT tenant_id, doc_type, lower(trim(doc_number)) AS normalized_doc_number, count(*) AS duplicate_count
FROM public.sales_documents
WHERE nullif(trim(doc_number), '') IS NOT NULL
GROUP BY tenant_id, doc_type, lower(trim(doc_number))
HAVING count(*) > 1;

-- VIN المكرر داخل نفس المستأجر
SELECT tenant_id, upper(regexp_replace(vin, '[^A-Za-z0-9]', '', 'g')) AS normalized_vin,
       count(*) AS duplicate_count
FROM public.vehicles
WHERE nullif(regexp_replace(coalesce(vin, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL
GROUP BY tenant_id, upper(regexp_replace(vin, '[^A-Za-z0-9]', '', 'g'))
HAVING count(*) > 1;

-- ============================================================
-- 2) القيود المقترحة بعد تنظيف التكرارات
-- ============================================================

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_insurance_claims_tenant_claim_number
ON public.insurance_claims (tenant_id, lower(trim(claim_number)))
WHERE nullif(trim(claim_number), '') IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_job_orders_tenant_order_number
ON public.job_orders (tenant_id, lower(trim(order_number)))
WHERE nullif(trim(order_number), '') IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_sales_documents_tenant_type_number
ON public.sales_documents (tenant_id, doc_type, lower(trim(doc_number)))
WHERE nullif(trim(doc_number), '') IS NOT NULL;

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_vehicles_tenant_normalized_vin
ON public.vehicles (
  tenant_id,
  upper(regexp_replace(vin, '[^A-Za-z0-9]', '', 'g'))
)
WHERE nullif(regexp_replace(coalesce(vin, ''), '[^A-Za-z0-9]', '', 'g'), '') IS NOT NULL;

-- اللوحة لديها قيد قائم حاليًا:
-- UNIQUE (tenant_id, plate_letters, plate_number, plate_country)
