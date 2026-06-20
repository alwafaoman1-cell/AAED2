---
name: Cloud Settings & Browser Cache Audit
description: جدول tenant_settings مركزي للإعدادات + cloudSettings helper + صفحة /settings/browser-cache لمراجعة localStorage ورفعها للسحابة + cache-bust تلقائي
type: feature
---

## النظرة العامة
نقل تدريجي من localStorage إلى السحابة كمصدر وحيد للحقيقة. خطوة أولى: الإعدادات.

## المكونات
- **DB**: جدول `tenant_settings(tenant_id, key, value jsonb, version, updated_by, updated_at)` مع unique على (tenant_id, key) و trigger `bump_tenant_settings_version` يزيد version عند كل تعديل. مفعّل realtime + RLS قائم على `get_user_tenant_id()`.
- **`src/lib/cloudSettings.ts`**: `readCloudSetting<T>(key, fallback)` + `writeCloudSetting(key, value)` + `subscribeCloudSetting(key, cb)`. localStorage يُستخدم فقط كـcache offline تحت prefix `cloud_setting_cache:` — ليس مصدر للحقيقة.
- **`src/lib/cacheVersion.ts`**: عند كل تحميل يقارن `VITE_APP_VERSION` بالمحفوظ. لو مختلف يمسح كل `cloud_setting_cache:*` و `store:*` ويُعيد التحميل من السحابة. يضمن أن تحديث النظام لا يترك إعدادات قديمة عالقة.
- **`/settings/browser-cache`** (`BrowserCacheAuditPage`): يعرض كل مفاتيح localStorage مصنّفة (إعدادات / تشغيلية / مؤقتة)، مع checkbox لكل واحد. أزرار: «رفع المحدد للسحابة» (يستدعي `writeCloudSetting`)، «مسح المحدد»، «مسح الكل وإعادة التحميل». مرتبط من `SettingsPage`.

## قواعد التطبيق
- أي ملف `*SettingsStore.ts` جديد يجب أن يبني على `cloudSettings.ts` لا على localStorage مباشرة.
- التحويل تدريجي: الإعدادات أولاً، ثم الفنيين، ثم باقي الكيانات.
- `version` في `tenant_settings` تمنع overwrite — استخدمه قبل أي merge update حساس.

## ما تبقى (في المراحل القادمة)
- ربط `financeSettingsStore`, `numberingSettings`, `pdfLayoutSettings`, `publicAccessSettingsStore`, `modulesStore`, `quickActionsSettingsStore`, `monthlySettingsStore`, `rbac STORAGE_KEY` بـ `cloudSettings`.
- نقل `staffStore` (الفنيين) و`hrStore` و`expenseCategories` إلى جداول سحابية مستقلة.
