---
name: Customer Portal v2
description: بوابة متابعة العميل /p/:token مع خصوصية تأمين كاملة + نسبة إنجاز ذكية + ETA + معرض قبل/بعد + تقييم نجوم
type: feature
---

## النظرة العامة
- صفحة عامة `/p/:token` (`src/pages/CustomerPortal.tsx`) — بدون auth، ثنائية اللغة، Realtime.
- جدول `customer_portal_tokens`: token 64 hex فريد لكل أمر عمل، يُنشأ تلقائياً عبر `ensure_portal_token` trigger، قابل للإبطال (revoked_at).
- جدول `customer_feedback`: تقييم نجوم 1-5 + تعليق، واحد لكل أمر عمل، يُسمح فقط بعد `status=delivered`.

## RPC العامة (anon)
- `get_public_tracking(p_token)` → jsonb sanitized: order_number, eta, progress_pct, stage{key,label_ar,label_en,emoji}, vehicle, photos[], pending_approvals.
- `submit_customer_feedback(p_token, p_rating, p_comment, p_ip)`.

## خصوصية صارمة — البيانات المُخفية أبداً
- أي رقم مالي (parts_cost, labor_cost, total, vat, paid).
- insurance_claim_number, insurance_company.
- diagnosis الفني الكامل، عروض الأسعار، supplement unit_price.

## مراحل التأمين المعروضة للعميل
استلام 📥 → فحص 🔍 → بانتظار التأمين ⏳ → معتمد ✅ → قطع في الطريق 🚚 → إصلاح 🔧 → جودة 🛡️ → تسليم ✅
(محسوبة من `job_orders.status` + `insurance_approved` + `insurance_claim_number` بدون كشف أي رقم).

## واجهة الموظف
- مكوّن `<CustomerPortalLink/>` في `WorkOrderDetail` فوق قسم الأعمال الإضافية: نسخ + إرسال واتساب + معاينة.
