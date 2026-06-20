---
name: Vehicle Reception & Supplements System
description: نظام استلام المركبة + الأعمال الإضافية مع رابط موافقة عميل موقَّع رقمياً
type: feature
---

## النظرة العامة
- **استلام المركبة**: حقول جديدة في `job_orders`: `odometer_km`, `fuel_level_pct`, `reception_notes`, `reception_photos`, `vehicle_belongings`, `received_at`.
  - مُدار من `<VehicleReceptionSection jobOrderId/>` في `WorkOrderDetail`.
  - قائمة المقتنيات قابلة للتخصيص من `/settings/vehicle-belongings` (جدول `workshop_belongings_settings`).

## الأعمال الإضافية (Supplements)
- جدول `work_order_supplements`: بنود تتطلب موافقة العميل (pending_customer → approved/rejected → executed).
- منع تنفيذ بند غير معتمد عبر `enforce_supplement_execution_rule` trigger.
- مُدار من `<SupplementsSection/>` داخل صفحة أمر العمل.

## رابط موافقة العميل
- جدول `supplement_approval_requests`: token آمن 64 hex، صالح 24 ساعة، يحفظ التوقيع (Canvas → PNG base64) + IP + User-Agent.
- صفحة عامة: `/c/approve/:token` (`SupplementApprovalPage`) — لا تتطلب تسجيل دخول.
- Edge function: `supplement-public` (verify_jwt=false) → ينادي `get_supplement_request_by_token` و `submit_supplement_decision` (security definer).
- Edge function: `send-supplement-link` → ينشئ الطلب ويعيد الرابط للعميل (الإرسال الفعلي بواتساب/SMS من العميل عبر الـ APIs الموجودة).
- جدول `supplement_audit_logs`: append-only (لا UPDATE/DELETE policies) — يحفظ link_created, customer_signed إلخ.
- بعد التوقيع لا يمكن تعديل decisions/signature/ip عبر `protect_signed_supplement_request` trigger.

## واجهات المستخدم
- `<ApprovalHistoryTab/>` يعرض كل طلبات موافقة الأمر مع صورة التوقيع.
- `<SupplementsKpiCard/>` في `Dashboard` يعرض: بانتظار/معتمد/مرفوض/قيمة المعتمد (Realtime).

## الملفات الرئيسية
- Migration: `20260614142115_*`
- `supabase/functions/supplement-public/index.ts`, `send-supplement-link/index.ts`
- `src/components/workorders/{VehicleReceptionSection,SupplementsSection,ApprovalHistoryTab}.tsx`
- `src/pages/public/SupplementApprovalPage.tsx`
- `src/pages/settings/VehicleBelongingsSettingsPage.tsx`
- `src/components/dashboard/SupplementsKpiCard.tsx`
