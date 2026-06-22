# Phase 3 Rollback Guide

## قبل التراجع

1. أوقف النشر الجديد.
2. خذ نسخة احتياطية من قاعدة البيانات.
3. صدّر `whatsapp_logs` إذا كان يحتوي سجلات تشغيلية.
4. لا تحذف أعمدة `metadata` قبل التأكد أن الإصدار السابق لا يحتاج البيانات المخزنة فيها.

## تراجع التطبيق

- أعد نشر آخر إصدار مستقر من Vercel أو الحزمة السابقة.
- لا تستخدم `git reset --hard` على جهاز العمل.
- لا تحذف بيانات العملاء أو المطالبات أو أوامر العمل أو الفواتير.

## تراجع قاعدة البيانات المحافظ

نفّذ فقط عند الحاجة وبعد أخذ نسخة احتياطية:

```sql
begin;

drop view if exists public.sales_invoices_archive_report;
drop view if exists public.insurance_statement_report;
drop view if exists public.claims_archive_report;
drop view if exists public.delivered_vehicles_report;
drop view if exists public.workshop_operations_report;

drop trigger if exists trg_touch_job_order_for_expense on public.expenses;
drop function if exists public.touch_job_order_for_expense();

drop trigger if exists trg_sync_claim_from_job_order on public.job_orders;
drop function if exists public.sync_claim_from_job_order();

drop index if exists public.uq_insurance_claims_tenant_claim_number;
drop index if exists public.uq_job_orders_tenant_order_number;
drop index if exists public.uq_vehicles_tenant_normalized_vin;

commit;
```

هذا التراجع لا يحذف `whatsapp_logs` ولا أعمدة `metadata` حتى لا تُفقد البيانات.

## حذف مكونات واتساب اختياريًا

بعد تصدير السجلات والتأكد من عدم حاجة أي إصدار لها:

```sql
begin;
alter publication supabase_realtime drop table public.whatsapp_logs;
alter table public.whatsapp_logs rename to whatsapp_logs_phase3_backup;
commit;
```

يفضل إعادة تسمية الجدول بدل حذفه. يمكن حذفه لاحقًا بعد انتهاء مدة الاحتفاظ المعتمدة.

## التحقق بعد التراجع

- تسجيل الدخول.
- فتح مطالبة وأمر عمل موجودين.
- التحقق من الفواتير والتقارير.
- التأكد من عدم وجود أخطاء 500 أو أخطاء RLS.
- التحقق من أن النسخة السابقة لا تحاول القراءة من views أو `whatsapp_logs`.

