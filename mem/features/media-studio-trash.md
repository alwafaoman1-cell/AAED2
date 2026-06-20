---
name: Media Studio Trash & Bulk Actions
description: استوديو الوسائط — تحديد متعدد، نقل لمجلد آخر داخل نفس bucket، حذف ناعم لسلة __trash/، وإفراغ السلة يحذف نهائياً من Storage + يستدعي edge function cleanup-media-references لتنظيف المراجع في insurance_claims, inspections, insurance_invoices, claim_audit_logs
type: feature
---
- صفحة `src/pages/MediaStudio.tsx`: شريط إجراءات بـ Checkbox للتحديد، نقل (storage.move داخل نفس bucket)، حذف ناعم (نقل إلى `__trash/<uuid>/<base>`)، تبويب "🗑️ سلة المحذوفات" يجمع الملفات تحت `__trash/` من كل المخازن.
- إفراغ السلة: `storage.remove(paths)` بدفعات 100 ثم `supabase.functions.invoke("cleanup-media-references")`.
- Edge function `supabase/functions/cleanup-media-references/index.ts`: تتطلب مستخدم admin/manager، تطابق بالـ basename + path وتنظف:
  - `insurance_claims.{damage_photos, delivery_photos, satisfaction_photos, documents, receiver_id_photo}`
  - `inspections.photos`
  - `insurance_invoices.pdf_url`
  - حذف سطور `claim_audit_logs` التي تشير لنفس `file_path`.
- المخزن `local-photos` يبقى للقراءة فقط (لا تحديد/نقل/حذف من الاستوديو).
