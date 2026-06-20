# دليل النقل الكامل إلى استضافة مستقلة

نقل التطبيق من Lovable Cloud إلى Supabase خاص بك + استضافة خارجية (Vercel/Netlify/VPS).

---

## ✅ قائمة المتطلبات قبل البدء

- [ ] حساب على [supabase.com](https://supabase.com)
- [ ] حساب على [vercel.com](https://vercel.com) أو [netlify.com](https://netlify.com)
- [ ] Node.js 18+ و npm/bun على جهازك
- [ ] Supabase CLI: `npm i -g supabase`
- [ ] PostgreSQL client tools: `pg_dump`, `psql` (من [postgresql.org](https://www.postgresql.org/download/))
- [ ] دومين خاص (اختياري)

---

## المرحلة 1️⃣ — إنشاء مشروع Supabase جديد

1. سجّل دخول على [supabase.com](https://supabase.com) → **New Project**.
2. اختر:
   - **Region**: Frankfurt (أوروبا) أو الأقرب لك
   - **Database password**: قوية واحفظها
3. بعد الإنشاء، اذهب لـ **Settings → API** واحفظ:
   ```
   Project URL:        https://xxxxx.supabase.co
   anon public key:    eyJhbGc...
   service_role key:   eyJhbGc...  ⚠️ سري
   ```
4. من **Settings → Database**، انسخ:
   ```
   Connection string (URI): postgresql://postgres:[PWD]@db.xxxxx.supabase.co:5432/postgres
   ```

---

## المرحلة 2️⃣ — نقل بنية قاعدة البيانات (Schema)

```bash
# 1) حمّل الكود من Lovable (Code → Download codebase) وفك الضغط
cd مسار-المشروع

# 2) سجّل دخول لـ Supabase CLI
supabase login

# 3) اربط بالمشروع الجديد
supabase link --project-ref <NEW_PROJECT_REF>

# 4) ادفع كل الـ migrations
supabase db push
```

سيُنشئ هذا: كل الجداول، الـ Functions، Triggers، RLS Policies، Sequences، نوع `app_role`.

> ⚠️ إذا فشلت بعض الـ migrations لتعارضات في الترتيب، شغّلها يدوياً من لوحة Supabase → **SQL Editor** بترتيبها التاريخي من مجلد `supabase/migrations/`.

---

## المرحلة 3️⃣ — نقل البيانات

### استخراج كلمة مرور Lovable Cloud DB
من Lovable: **Cloud → Database → Connection** (Direct connection).

### تصدير البيانات

```bash
# تصدير البيانات فقط (بدون البنية)
pg_dump "postgresql://postgres.rvnphafedylethmvqsyp:[OLD_PWD]@aws-0-eu-central-1.pooler.supabase.com:6543/postgres" \
  --data-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  -f data.sql
```

### استيراد للمشروع الجديد

```bash
psql "postgresql://postgres:[NEW_PWD]@db.<NEW_REF>.supabase.co:5432/postgres" \
  -f data.sql
```

> **بديل أسهل**: استخدم الصفحة الموجودة `/settings/backup-restore` لتصدير ZIP من Lovable، ثم بعد تحديث `.env` للمشروع الجديد، ارفع الـ ZIP لاستعادته.

---

## المرحلة 4️⃣ — نقل ملفات Storage

5 buckets: `invoices-pdf`, `avatars`, `damage-photos`, `insurance-docs`, `backups`.

### أنشئ الـ buckets في المشروع الجديد

من **Storage → New bucket**، أنشئ نفس الأسماء بنفس الإعدادات:
- `avatars` → **Public**
- الباقي → **Private**

### انسخ الملفات بسكربت Node.js

أنشئ `migrate-storage.mjs`:

```javascript
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';

const OLD = createClient(
  'https://rvnphafedylethmvqsyp.supabase.co',
  'OLD_SERVICE_ROLE_KEY'
);
const NEW = createClient(
  'https://<NEW_REF>.supabase.co',
  'NEW_SERVICE_ROLE_KEY'
);

const BUCKETS = ['invoices-pdf', 'avatars', 'damage-photos', 'insurance-docs', 'backups'];

async function migrate(bucket) {
  console.log(`\n📦 ${bucket}`);
  async function walk(prefix = '') {
    const { data: items } = await OLD.storage.from(bucket).list(prefix, { limit: 1000 });
    for (const it of items || []) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      if (!it.metadata) { await walk(path); continue; }
      const { data: file } = await OLD.storage.from(bucket).download(path);
      if (!file) continue;
      const buf = Buffer.from(await file.arrayBuffer());
      await NEW.storage.from(bucket).upload(path, buf, { upsert: true, contentType: it.metadata.mimetype });
      console.log(`  ✓ ${path}`);
    }
  }
  await walk();
}

for (const b of BUCKETS) await migrate(b);
console.log('\n✅ Done');
```

شغّل:
```bash
npm i @supabase/supabase-js
node migrate-storage.mjs
```

---

## المرحلة 5️⃣ — نشر Edge Functions

```bash
supabase functions deploy --project-ref <NEW_REF>
```

أضف الـ Secrets من **Project Settings → Edge Functions → Manage secrets**:

| Secret | المصدر |
|--------|--------|
| `PAYMENT_WEBHOOK_SECRET` | اختر قيمة جديدة |
| `BACKUP_SECRET` | اختر قيمة جديدة |
| `LOVABLE_API_KEY` | ⚠️ لن يعمل خارج Lovable — استبدله بـ OpenAI/Gemini key وعدّل الكود |
| `GMAIL_*` | حساب Gmail OAuth |
| `META_WHATSAPP_TOKEN` | Meta Business |
| `SMS_*` | مزود SMS |

> ملاحظة: متغيرات `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` مُضافة تلقائياً.

---

## المرحلة 6️⃣ — تكوين Authentication

من **Authentication → Providers**:

1. **Email**: مفعّل افتراضياً. عطّل "Confirm email" إن أردت.
2. **Google OAuth**:
   - أنشئ OAuth Client في [Google Cloud Console](https://console.cloud.google.com)
   - Authorized redirect URI: `https://<NEW_REF>.supabase.co/auth/v1/callback`
   - الصق Client ID + Secret في Supabase

من **Authentication → URL Configuration**:
- **Site URL**: `https://yourdomain.com`
- **Redirect URLs**: `https://yourdomain.com/**`, `http://localhost:8080/**`

---

## المرحلة 7️⃣ — تحديث الواجهة وبناء النسخة

```bash
# 1) عدّل .env
cat > .env << 'EOF'
VITE_SUPABASE_URL="https://<NEW_REF>.supabase.co"
VITE_SUPABASE_PUBLISHABLE_KEY="<NEW_ANON_KEY>"
VITE_SUPABASE_PROJECT_ID="<NEW_REF>"
EOF

# 2) ثبّت واختبر محلياً
npm install
npm run dev
# افتح http://localhost:8080 وجرّب تسجيل الدخول

# 3) ابنِ نسخة الإنتاج
npm run build
# المخرجات في dist/
```

---

## المرحلة 8️⃣ — رفع الواجهة

### الخيار أ: Vercel (الأسهل)

```bash
npm i -g vercel
vercel --prod
```
أضف متغيرات `.env` من **Vercel Dashboard → Settings → Environment Variables**.

### الخيار ب: Netlify

اسحب وأفلت مجلد `dist/` على [netlify.com/drop](https://app.netlify.com/drop) أو اربط GitHub.

### الخيار ج: VPS مع Nginx

```nginx
server {
  listen 443 ssl http2;
  server_name yourdomain.com;
  root /var/www/autopro/dist;
  index index.html;

  ssl_certificate     /etc/letsencrypt/live/yourdomain.com/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/yourdomain.com/privkey.pem;

  # SPA fallback (مهم!)
  location / {
    try_files $uri $uri/ /index.html;
  }

  # Cache للأصول
  location ~* \.(js|css|png|jpg|woff2)$ {
    expires 1y;
    add_header Cache-Control "public, immutable";
  }
}
```

ارفع `dist/` عبر SCP وأعد تشغيل Nginx.

---

## المرحلة 9️⃣ — ربط الدومين

1. في Vercel/Netlify: **Domains → Add domain** → اتبع تعليمات DNS.
2. أضف الدومين في **Supabase → Auth → URL Configuration**.
3. حدّث رابط الـ OAuth callback في Google Console إن لزم.

---

## 🧪 قائمة الاختبار النهائية

- [ ] تسجيل دخول بحساب موجود
- [ ] إنشاء عميل + مركبة + أمر عمل
- [ ] إنشاء مطالبة تأمين + تحويلها لأمر عمل
- [ ] توليد PDF فاتورة ومشاركة WhatsApp
- [ ] رفع صورة فحص (يختبر Storage)
- [ ] قيد محاسبي تلقائي (يختبر Triggers)
- [ ] تشغيل النسخ الاحتياطي اليومي
- [ ] إشعارات (إذا فعّلت Edge Functions)

---

## 💰 التكلفة الشهرية

| البند | التكلفة |
|------|---------|
| Supabase Pro | $25 |
| Vercel / Netlify Hobby | مجاني |
| دومين | ~$1 |
| **الإجمالي** | **~$26** |

---

## ⚠️ تنبيهات مهمة

1. **`LOVABLE_API_KEY`** يعمل فقط داخل Lovable. أي دالة تستخدمه (مثل ترجمة AI) ستحتاج تعديل لاستخدام OpenAI/Gemini مباشرة.
2. **النسخ الاحتياطي اليومي** (`daily-backup`): تحتاج إعداد cron من **Database → Cron Jobs** في Supabase.
3. **`daily-alerts`**: نفس الشيء — أضف cron يومي عند 7:00 UTC.
4. **PWA Service Worker** يعمل تلقائياً بعد البناء — لا حاجة لإعداد إضافي.
5. **حقوق `GRANT`** في الـ migrations مطلوبة للجداول الجديدة — تُنقل تلقائياً.
6. بعد النقل، يمكنك **إيقاف Lovable Cloud** من **Connectors → Lovable Cloud → Disable** للمشاريع المستقبلية.

---

## 🆘 حل المشاكل الشائعة

| المشكلة | الحل |
|--------|------|
| "permission denied for table X" | شغّل `GRANT SELECT, INSERT, UPDATE, DELETE ON public.X TO authenticated;` |
| الدوال لا تعمل | تأكد من رفع الـ Secrets في لوحة Supabase الجديدة |
| Google OAuth يفشل | راجع Redirect URIs في Google Console + Supabase Auth |
| الصور لا تظهر | تأكد من إعدادات Public/Private للـ buckets |
| Realtime لا يعمل | فعّل من **Database → Replication** للجداول المطلوبة |

---

تم بحمد الله 🎉
