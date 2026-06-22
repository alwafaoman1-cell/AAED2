# Phase 3 Deployment Guide

## المتطلبات

- نسخة احتياطية حديثة من قاعدة Supabase.
- Supabase CLI مسجل الدخول ومربوط بالمشروع `ifnfwssdtjuzdtshnrht`.
- صلاحية إدارية لتطبيق migrations ونشر Edge Functions.
- القيم التالية متاحة محليًا فقط، ولا تضاف إلى Git:
  - `SUPABASE_URL`
  - `SUPABASE_ANON_KEY`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SMOKE_TENANT_ID`
  - `SMOKE_WHATSAPP_TO` اختياري لإرسال رسالة اختبار حقيقية.

## 1. فحص التكرارات قبل النشر

نفّذ الاستعلامات التالية في SQL Editor:

```sql
select tenant_id, lower(trim(claim_number)) as value, count(*)
from public.insurance_claims
where nullif(trim(claim_number), '') is not null
group by tenant_id, lower(trim(claim_number))
having count(*) > 1;

select tenant_id, lower(trim(order_number)) as value, count(*)
from public.job_orders
where nullif(trim(order_number), '') is not null
group by tenant_id, lower(trim(order_number))
having count(*) > 1;

select tenant_id,
       upper(regexp_replace(coalesce(vin, vin_number), '[^A-Za-z0-9]', '', 'g')) as value,
       count(*)
from public.vehicles
where nullif(regexp_replace(coalesce(vin, vin_number, ''), '[^A-Za-z0-9]', '', 'g'), '') is not null
group by tenant_id,
         upper(regexp_replace(coalesce(vin, vin_number), '[^A-Za-z0-9]', '', 'g'))
having count(*) > 1;
```

يجب أن تعيد الاستعلامات الثلاثة صفر صفوف. لا تُعدّل أو تحذف أي تكرار تلقائيًا.

## 2. تطبيق قاعدة البيانات

```bash
supabase link --project-ref ifnfwssdtjuzdtshnrht
supabase db push
```

الـ migration المستهدفة:

`supabase/migrations/20260622090000_phase2_cloud_source_whatsapp_constraints.sql`

الـ migration تتوقف تلقائيًا إذا وجدت تكرارات.

## 3. نشر واتساب

```bash
supabase functions deploy whatsapp-meta-send --project-ref ifnfwssdtjuzdtshnrht
```

تُضبط أسرار Meta داخل Supabase فقط، وفق بنية `tenant_integrations`. لا تضع أي token في متغيرات Vite.

## 4. تشغيل اختبارات الإنتاج

PowerShell:

```powershell
$env:SUPABASE_URL="https://PROJECT.supabase.co"
$env:SUPABASE_ANON_KEY="..."
$env:SUPABASE_SERVICE_ROLE_KEY="..."
$env:SMOKE_TENANT_ID="..."
npm run smoke:production
```

الاختبار ينشئ بيانات مؤقتة للمطالبة والمركبة وأمر العمل والفاتورة، يختبر القيود وQR والتسليم، ثم يحذف بيانات الاختبار.

لإرسال رسالة واتساب اختبارية حقيقية:

```powershell
$env:SMOKE_WHATSAPP_TO="968XXXXXXXX"
npm run smoke:production
```

## 5. فحوص التطبيق

```bash
npm run typecheck
npm run lint
npm run test
npm run build
```

## 6. النشر

- ارفع الحزمة إلى GitHub بعد اعتماد Phase 3 فقط.
- اربط Vercel بالمستودع.
- أضف متغيرات Vite العامة المطلوبة في Vercel.
- لا تضف Service Role أو Meta token إلى Vercel frontend.
- نفّذ جولة QA بعد النشر على الرابط النهائي.
