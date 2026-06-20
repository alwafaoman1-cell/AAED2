---
name: Customer Notifications Phase 2
description: نظام إشعارات تلقائية للعملاء — جداول customer_notifications + customer_notification_settings + triggers أحداث + edge function send-customer-notification + صفحة /messages + /settings/customer-notifications + زر SendStageNotificationButton في WorkOrderDetail
type: feature
---

## المرحلة 2 — الإشعارات الذكية ومركز الرسائل

### قاعدة البيانات
- `customer_notification_settings` (per tenant per event_type): enabled/auto_send/default_channel/template_ar/template_en
- `customer_notifications` (queue + log): event_type, channel, status (queued/sent/failed/delivered), recipient, body, error, payload, sent_at
- RPC `enqueue_customer_notification(tenant, job_order, event, body?, channel?, force?)` — يستبدل {name}/{order}/{link}
- RPC `seed_default_notification_settings(tenant)` — يبذر 10 أحداث افتراضية
- Triggers تلقائية:
  - `notify_on_job_order_status` → received/inspection_started/waiting_parts/repair_started/ready_for_pickup/delivered
  - `notify_on_insurance_approved` → insurance_approved
  - `notify_on_supplement_pending` → supplement_pending
- جميعها تشتغل فقط عند `auto_send=true` في الإعدادات.

### Edge Function
- `send-customer-notification` يقرأ notification_id ويرسل عبر:
  - whatsapp → يبني wa.me URL ويُرجعه (يُفتح في تبويب جديد)
  - sms → يستدعي `send-sms`
  - email → placeholder (لاحقاً يربط بـ Lovable Emails)
- يحدّث status=sent/failed + sent_at + error

### الواجهة
- `/messages` — مركز رسائل العملاء (فلترة بالحالة/القناة/البحث + Realtime + إعادة إرسال)
- `/settings/customer-notifications` — تخصيص قوالب وقنوات كل حدث (Admin/Manager فقط)
- `SendStageNotificationButton` في `WorkOrderDetail` — قائمة منسدلة لإرسال إشعار يدوي لأي مرحلة (force=true يتجاوز enabled)

### الخصوصية
- لا تُرسل أي قيم مالية للعميل — فقط روابط + اسم + رقم أمر العمل.
- {link} = `/p/<token>` المرتبط بـ customer_portal_tokens.
