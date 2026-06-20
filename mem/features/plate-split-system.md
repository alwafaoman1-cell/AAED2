---
name: Plate Split System
description: نظام فصل لوحة المركبة إلى رقم/حروف/دولة + قيد فرادة UNIQUE نهائي
type: feature
---

# نظام لوحة المركبة المفصولة

## البنية في DB
- `vehicles.plate_number` = أرقام فقط
- `vehicles.plate_letters` = إنجليزية A-Z فقط (Trigger يحوّل عربي → Latin)
- `vehicles.plate_country` = افتراضياً `OM`
- **قيد فرادة نهائي** `uniq_vehicle_plate UNIQUE (tenant_id, plate_letters, plate_number, plate_country)` ✅ مُفعَّل
- Trigger `normalize_vehicle_plate` BEFORE INSERT/UPDATE — يطبّع كل المُدخلات تلقائياً (يحوّل أي لوحة كاملة مُدخلة في `plate_number` إلى تقسيم صحيح)
- دالة `find_vehicle_by_plate(letters, digits, country)` للبحث المسبق
- View `vehicle_duplicates` للرصد المستقبلي

## نقاط الإدخال المُحدَّثة (Phase 2 ✅)
- `src/components/customers/VehicleQuickFormDialog.tsx` — حقلان منفصلان + بحث ذكي + رفض الحفظ عند التكرار
- `src/lib/workOrdersStore.ts` → `ensureVehicle()` — يستخدم `findVehicleByPlate` RPC ويُرسل `plate_letters` + `plate_number` + `plate_country` منفصلة
- `src/pages/insurance/NewInsuranceClaim.tsx` — موضعَي إنشاء المركبة (Step1 inline + submit) يستخدمان نفس النمط
- `src/pages/insurance/InsuranceImport.tsx` — استيراد Excel يستخدم RPC + الحقول المفصولة
- `src/lib/vehiclesStore.ts` — جلب السحاب يبني `plate` المعروض من `letters + " " + digits`، ومزامنة الأرشيف تستخدم الحقول المفصولة

## صيغة العرض الموحدة
- المكتبة المركزية: `src/lib/plateUtils.ts` → `formatPlate()` تُرجِع `"AA 12345"` مع `dir="ltr"` و `font-mono`
- مزامنة local↔cloud في `vehiclesStore` تستخدم الصيغة الموحدة → كل الواجهات القديمة (`v.plate`) تستلم الصيغة الجديدة تلقائياً

## شاشة تنظيف المكررات
- `/settings/vehicles-cleanup` — admin/manager فقط
- ينقل FK من `job_orders`/`insurance_claims`/`customer_advances` للسجل الأصلي
- بعد دمج تلقائي في ترحيلة 2026-06-17، عدد المكررات = 0

## ⚠️ متبقي للتلميع (اختياري)
- توحيد العرض عبر `formatPlate()` بدلاً من حقل `plate` القديم في:
  - `WorkOrderDetail`، `InsuranceClaimDetail`، `InsuranceEstimates`، `ClaimArchivePage`، `WorkshopOperationsReportDialog`
  - PDF templates: `claimArchivePdf.ts`، `insuranceWorkshopReport.ts`
- `WorkOrderForm.tsx` — استخدام حقلين مفصولين بدلاً من input وحيد `"أ ب ج 1234"`
- ملاحظة: العرض الحالي يعمل لأن `vehiclesStore` يبني `plate` الموحد، لكن الأفضل التحويل لاستدعاء `formatPlate()` صراحةً
