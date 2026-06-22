// migrate-storage.mjs
// نقل جميع ملفات Storage من Lovable Cloud إلى مشروع Supabase الجديد.
// الاستخدام:
//   1) عبّئ المتغيرات بالأسفل أو صدّرها كـ env vars
//   2) npm i @supabase/supabase-js
//   3) node migrate-storage.mjs

import { createClient } from "@supabase/supabase-js";

const OLD_URL = process.env.OLD_SUPABASE_URL;
if (!OLD_URL) throw new Error("Set OLD_SUPABASE_URL explicitly before running this one-time migration script");
const OLD_KEY = process.env.OLD_SERVICE_ROLE_KEY || "<OLD_SERVICE_ROLE_KEY>";
const NEW_URL = process.env.NEW_SUPABASE_URL || "<NEW_SUPABASE_URL>";
const NEW_KEY = process.env.NEW_SERVICE_ROLE_KEY || "<NEW_SERVICE_ROLE_KEY>";

const BUCKETS = ["invoices-pdf", "avatars", "damage-photos", "insurance-docs", "backups"];

const OLD = createClient(OLD_URL, OLD_KEY);
const NEW = createClient(NEW_URL, NEW_KEY);

async function ensureBucket(name) {
  const { data } = await NEW.storage.getBucket(name);
  if (data) return;
  const isPublic = name === "avatars";
  await NEW.storage.createBucket(name, { public: isPublic });
  console.log(`  ➕ created bucket ${name} (public=${isPublic})`);
}

async function migrate(bucket) {
  console.log(`\n📦 ${bucket}`);
  await ensureBucket(bucket);
  let count = 0, errors = 0;

  async function walk(prefix = "") {
    const { data: items, error } = await OLD.storage
      .from(bucket)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error) { console.error(`  ✗ list ${prefix}:`, error.message); return; }

    for (const it of items || []) {
      const path = prefix ? `${prefix}/${it.name}` : it.name;
      // مجلد (لا metadata) → استكشف داخله
      if (!it.metadata) { await walk(path); continue; }

      try {
        const { data: file, error: dlErr } = await OLD.storage.from(bucket).download(path);
        if (dlErr || !file) { errors++; console.error(`  ✗ dl ${path}:`, dlErr?.message); continue; }
        const buf = Buffer.from(await file.arrayBuffer());
        const { error: upErr } = await NEW.storage.from(bucket).upload(path, buf, {
          upsert: true,
          contentType: it.metadata.mimetype,
        });
        if (upErr) { errors++; console.error(`  ✗ up ${path}:`, upErr.message); continue; }
        count++;
        if (count % 25 === 0) console.log(`  … ${count} files`);
      } catch (e) {
        errors++;
        console.error(`  ✗ ${path}:`, e.message);
      }
    }
  }

  await walk();
  console.log(`  ✅ ${bucket}: ${count} files copied, ${errors} errors`);
}

(async () => {
  console.log("🚀 Storage migration starting…");
  for (const b of BUCKETS) await migrate(b);
  console.log("\n🎉 All buckets done.");
})();
