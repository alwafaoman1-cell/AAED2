---
name: Cloud Update System
description: System version-update notifier with realtime push, modal/banner, unsaved-work guard, mandatory grace timer, and admin publish page
type: feature
---
- جدول `app_versions` (موجود) + Realtime مفعّل عليه.
- `src/lib/appVersion.ts`: `CURRENT_APP_VERSION` (من `VITE_APP_VERSION` أو ثابت) + `compareVersions()`.
- `src/lib/updateStore.ts`: `startUpdateWatcher()` يجلب أحدث صف ويستمع لـ Realtime، يقارن مع CURRENT_APP_VERSION. يحفظ "تجاهل/تذكير لاحقاً" في localStorage. `applyUpdateNow()` ينظف SW + caches ثم `reload()` مرة واحدة، ويعرض toast نجاح بعد الإقلاع عبر `sessionStorage.post_update_toast`.
- `src/lib/unsavedWork.ts`: `markDirty/markClean/hasUnsavedWork/subscribeUnsavedWork` يستخدمها أي نموذج فيه عمل غير محفوظ.
- `src/components/UpdateNotice.tsx`: Dialog (الإصدار الحالي/الجديد، التغييرات، التاريخ، شريط تنزيل وهمي ثم زر "تطبيق التحديث") + Banner عائم بعد الإغلاق. يحترم unsaved work ويعدّ تنازلياً عند `mandatory=true`.
- `src/pages/AdminVersions.tsx` على `/admin/versions` (admin/manager): نشر إصدار جديد + قائمة الإصدارات. مرتبط بالشريط الجانبي.
- بعد كل deploy: حدّث `CURRENT_APP_VERSION` في `appVersion.ts` ثم انشر صف في `/admin/versions` بنفس الرقم ليصل الإشعار للجميع.
