#!/usr/bin/env bash
# migrate-data.sh — تصدير بيانات public schema من Lovable Cloud واستيرادها للمشروع الجديد
# الاستخدام: ./migrate-data.sh
# يتطلب: pg_dump, psql

set -e

: "${OLD_DB_URL:?Set OLD_DB_URL explicitly before running this one-time migration script}"
NEW_DB_URL="${NEW_DB_URL:-postgresql://postgres:NEW_PWD@db.NEW_REF.supabase.co:5432/postgres}"
DUMP_FILE="${DUMP_FILE:-./data.sql}"

echo "📤 تصدير البيانات من المشروع القديم…"
pg_dump "$OLD_DB_URL" \
  --data-only \
  --schema=public \
  --no-owner \
  --no-privileges \
  --disable-triggers \
  --column-inserts \
  -f "$DUMP_FILE"

SIZE=$(du -h "$DUMP_FILE" | cut -f1)
echo "✅ تم التصدير: $DUMP_FILE ($SIZE)"

echo ""
read -p "📥 هل تريد الاستيراد للمشروع الجديد الآن؟ (y/N) " yn
if [[ "$yn" == "y" || "$yn" == "Y" ]]; then
  echo "📥 جاري الاستيراد…"
  psql "$NEW_DB_URL" -f "$DUMP_FILE"
  echo "✅ تم الاستيراد بنجاح"
else
  echo "ℹ️  لتنفيذ الاستيراد لاحقاً: psql \"\$NEW_DB_URL\" -f $DUMP_FILE"
fi
