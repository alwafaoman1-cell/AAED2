---
name: Admin Notifications Center
description: نظام إشعارات داخلي من المدير لجميع مستخدمي المستأجر — جدول admin_notifications + admin_notification_reads + Realtime + تبويب "المدير" داخل NotificationsBell + صفحة /admin/notifications للإنشاء
type: feature
---

## مركز إشعارات المدير

### قاعدة البيانات
- `admin_notifications`: tenant_id, sender_id, sender_name, title, body, type (info/warning/urgent/success/error), link, created_at
- `admin_notification_reads`: (notification_id, user_id) PK + read_at + deleted_at (حذف شخصي لكل مستخدم)
- RLS: قراءة لكل أعضاء المستأجر، إنشاء فقط admin/manager، حذف للمرسل أو admin
- Realtime مفعّل عبر `supabase_realtime` publication

### الواجهة
- `src/lib/adminNotificationsStore.ts`: store يجمع الإشعارات + حالة القراءة، Realtime على INSERT يشغّل صوت + Toast (سوني)
- `src/pages/AdminNotifications.tsx` (/admin/notifications): إنشاء إشعار + سرد + حذف للجميع
- `NotificationsBell` فيه تبويب جديد "المدير" مع badge أحمر للعدد غير المقروء + إخفاء شخصي عبر X
