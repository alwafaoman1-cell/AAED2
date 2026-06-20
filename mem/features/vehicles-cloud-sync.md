---
name: Vehicles Cloud Sync
description: مزامنة أرشيف السيارات مع جدول public.vehicles (Realtime + push على تغيير archived)
type: feature
---
`src/lib/vehiclesStore.ts` فيه طبقة Cloud Sync:
- جلب أولي + اشتراك Realtime على جدول `vehicles`.
- المطابقة بين المحلي والسحابي بـ `plate_number` (normalized: lowercase + trim + collapse spaces).
- السيارات الموجودة في السحابة فقط (مثلاً المُنشأة تلقائياً من `auto_create_job_order_on_approval` عند اعتماد مطالبة تأمين) تُضاف للقائمة المحلية تلقائياً.
- عند تبديل `archived/archivedAt/archivedReason` محلياً → push لـ `vehicles` السحابي (بـ id إن عُرف، وإلا بـ plate ضمن tenant).
- إعادة الجلب عند: focus / online / visibilitychange / تغيير المستخدم.
- الأعمدة السحابية المستخدمة: `archived boolean`, `archived_at timestamptz`, `archived_reason text`.
