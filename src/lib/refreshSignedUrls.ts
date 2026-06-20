// أداة مشتركة: تجديد الروابط الموقَّعة لمستندات Storage بحيث لا تنتهي صلاحيتها
// (كانت سابقاً 7 أيام فقط ومخزَّنة في claim_audit_logs.details.url مما يجعل الملفات الأقدم غير قابلة للقراءة).
import { supabase } from "@/integrations/supabase/client";

const TTL = 60 * 60 * 24 * 7; // 7 days — يكفي لجلسة واحدة

/**
 * يجدّد الروابط الموقَّعة لمجموعة مسارات في bucket واحد.
 * يعيد Map من file_path إلى signedUrl. يتجاهل الأخطاء بصمت لكل مسار.
 */
export async function refreshSignedUrls(
  bucket: string,
  paths: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const cleaned = Array.from(new Set(paths.filter((p) => !!p)));
  if (!cleaned.length) return map;

  // Supabase يدعم createSignedUrls كدفعة واحدة
  try {
    const { data, error } = await supabase.storage
      .from(bucket)
      .createSignedUrls(cleaned, TTL);
    if (!error && data) {
      data.forEach((row: any) => {
        if (row?.path && row?.signedUrl) map.set(row.path, row.signedUrl);
      });
    }
  } catch (e) {
    console.warn("[refreshSignedUrls] batch failed", e);
  }

  const missing = cleaned.filter((path) => !map.has(path));
  if (missing.length) {
    try {
      const { data, error } = await supabase.functions.invoke("sign-storage-url", {
        body: { bucket, paths: missing, expiresIn: TTL },
      });
      if (!error && data?.urls) {
        (data.urls as Array<{ path: string; signedUrl: string | null }>).forEach((row) => {
          if (row.path && row.signedUrl) map.set(row.path, row.signedUrl);
        });
      }
    } catch (e) {
      console.warn("[refreshSignedUrls] fallback failed", e);
    }
  }
  return map;
}

/**
 * يجدّد رابط موقَّع لمسار واحد. يستخدم في dialog المعاينة كـ fallback.
 */
export async function refreshSignedUrl(bucket: string, path: string): Promise<string | null> {
  if (!path) return null;
  const urls = await refreshSignedUrls(bucket, [path]);
  return urls.get(path) ?? null;
}
