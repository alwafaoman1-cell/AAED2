---
name: Work Order Signing
description: بنود الأعمال داخل أمر العمل + صفحة /sign/:token لتوقيع العميل إلكترونياً + رسالة ترحيب واتساب تجمع كل ذلك
type: feature
---

## نظرة عامة
عند إنشاء أمر عمل جديد، يضيف الموظف قائمة **بنود الأعمال المطلوبة** (عنوان + ملاحظة لكل بند). ثم بعد الحفظ يستطيع إرسال **رابط ترحيبي للعميل عبر واتساب** يحتوي على البنود + رابط التوقيع الإلكتروني + رابط متابعة الحالة.

## المكونات الرئيسية
- **DB**: `job_orders.work_items jsonb` (افتراضي `[]`)، `customer_portal_tokens` صار يحتوي `signature_data_url`, `signed_at`, `signer_ip`, `signer_user_agent`, `signer_name`.
- **RPC عامة (anon + authenticated)**:
  - `get_work_order_for_sign(p_token)` — تُرجع بيانات الأمر + المركبة + العميل + البنود + حالة التوقيع.
  - `submit_work_order_signature(p_token, p_signature, p_signer_name, p_ip, p_user_agent)` — تستقبل توقيع dataURL وتختمه بالوقت.
- **WorkOrder type** (`src/lib/workOrdersStore.ts`): حقل `workItems?: WorkItem[]` يُمرَّر للسحابة عبر `pushOrderToCloud` و `_flushPatch`.
- **WorkOrderForm**: قسم «📋 بنود الأعمال المطلوبة» مع إضافة/حذف/ملاحظة لكل بند.
- **صفحة `/sign/:token`** (`src/pages/public/WorkOrderSignPage.tsx`): تعرض البنود وتجمع التوقيع بإصبع/قلم على Canvas + checkbox موافقة + اسم الموقّع. مرة واحدة فقط (لا يمكن تعديل توقيع موجود).
- **`CustomerPortalLink`**: يعرض رابطَين منفصلين — **رابط التوقيع** (CTA رئيسي ببطاقة بارزة + شارة «تم التوقيع» عند الاكتمال) و**رابط المتابعة**. زر «إرسال للعميل (ترحيب + توقيع)» يولّد رسالة واتساب جاهزة تتضمن البنود من `getWorkOrderById`.

## ملاحظات
- التوقيع **اختياري** (يبدأ العمل بدونه)، يُذكَّر العميل لاحقاً.
- الرابط يستخدم نفس `customer_portal_tokens` الذي يولَّد تلقائياً عبر trigger `ensure_portal_token`.
- التوقيع لا يمكن استبداله بعد الإرسال (حماية قانونية)؛ إعادة فتحه تحتاج RPC جديدة في المستقبل.
