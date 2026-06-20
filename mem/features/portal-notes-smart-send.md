---
name: Customer Portal Notes & Smart Send
description: ملاحظات العملاء من بوابة QR (Pending Approval + صوت Realtime) + شريط إرسال ذكي 3 رسائل + توقيع العميل في طباعة أمر العمل
type: feature
---

## 1) جدول `customer_portal_notes`
- يحفظ ملاحظات العميل المُرسَلة من `/p/:token` بحالة `pending`/`approved`/`rejected`.
- RPC `submit_portal_note(p_token,...)` anon — العميل لا يمكنه تعديل/حذف بعد الإرسال.
- RPC `review_portal_note(p_id, p_decision)` للمشرف (admin/manager/...).
- في Realtime publication. القناة العامة `portal-notes-global` تشغّل `notificationSound.play()` + توست عند وصول pending جديد.
- المكوّن `PortalNotesRealtimeListener` يُركَّب في `AppLayout` ويصفّى على `tenant_id`.

## 2) واجهات
- `src/pages/CustomerPortal.tsx`: قسم `CustomerNotesBox` — إرسال ملاحظة + اسم اختياري.
- `src/components/workorders/PortalNotesPending.tsx`: داخل صفحة أمر العمل، قبول/رفض الملاحظات مع سجل.

## 3) شريط الإرسال الذكي
- `src/components/workorders/SmartCustomerSendBar.tsx` — 3 أزرار واتساب:
  - "تم تحديث الحالة" → `تم تحديث حالة أمر العمل {no} إلى: {status}`
  - "تم إضافة صورة" → `تم إضافة صورة جديدة لمركبتك`
  - "صورة + حالة" → الرسالتان معاً
- يجلب token بوابة العميل تلقائياً ويرفقه كرابط متابعة.

## 4) التوقيع الإلكتروني في الطباعة
- `WorkOrderData` في `pdfGenerator.ts` اكتسب `customerSignatureDataUrl/Name/Date`.
- `WorkOrderDetail.handlePrintWorkOrder` يجلب `signature_data_url/signer_name/signed_at` من `customer_portal_tokens` قبل توليد HTML — يظهر التوقيع فوق سطر "توقيع العميل" في PDF.
- RPC إداري `admin_reopen_signature(p_job_order_id)` (admin فقط) يمسح التوقيع للسماح بإعادة التوقيع.
