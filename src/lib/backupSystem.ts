// Backup & Restore — full tenant data dump
// JSON manifest of all tables + optional ZIP with attachments from storage buckets.
import JSZip from "jszip";
import { supabase } from "@/integrations/supabase/client";

export const BACKUP_TABLES = [
  "tenants", "profiles",
  "customers", "vehicles", "vehicle_makes", "vehicle_models",
  "job_orders", "job_order_parts", "job_order_logs",
  "inspections", "damage_markers",
  "insurance_companies", "insurance_claims", "insurance_invoices",
  "claim_payments", "claim_audit_logs",
  "invoices",
  "inventory",
  "daily_tasks",
  "payment_links",
  "print_templates",
  "sms_logs",
  "tenant_integrations", "tenant_sms_settings",
] as const;

export const BACKUP_BUCKETS = ["damage-photos", "insurance-docs", "invoices-pdf", "avatars"] as const;

export type BackupManifest = {
  version: 1;
  generated_at: string;
  tenant_id: string | null;
  app: "alwafa-erp";
  tables: Record<string, any[]>;
  storage_files?: { bucket: string; path: string }[];
};

async function dumpTable(name: string): Promise<any[]> {
  const all: any[] = [];
  const PAGE = 1000;
  let from = 0;
  // Page through using range to bypass 1000-row default
  while (true) {
    const { data, error } = await supabase.from(name as any).select("*").range(from, from + PAGE - 1);
    if (error) {
      // table may not exist or RLS blocks → skip silently with warning
      console.warn(`[backup] skip ${name}:`, error.message);
      break;
    }
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

export async function buildBackupJson(opts?: { onProgress?: (msg: string) => void }): Promise<BackupManifest> {
  const onP = opts?.onProgress ?? (() => {});
  const tables: Record<string, any[]> = {};
  for (const t of BACKUP_TABLES) {
    onP(`جاري تصدير ${t}…`);
    tables[t] = await dumpTable(t);
  }
  const tenantId = tables.profiles?.[0]?.tenant_id ?? null;
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    tenant_id: tenantId,
    app: "alwafa-erp",
    tables,
  };
}

export async function listTenantStorageFiles(tenantId: string): Promise<{ bucket: string; path: string }[]> {
  const out: { bucket: string; path: string }[] = [];
  for (const bucket of BACKUP_BUCKETS) {
    try {
      // best-effort list root then one level deep
      const { data: roots } = await supabase.storage.from(bucket).list("", { limit: 1000 });
      for (const r of roots ?? []) {
        if (!r.name) continue;
        if (r.id === null) {
          // folder
          const { data: items } = await supabase.storage.from(bucket).list(r.name, { limit: 1000 });
          for (const it of items ?? []) {
            if (it.id) out.push({ bucket, path: `${r.name}/${it.name}` });
          }
        } else {
          out.push({ bucket, path: r.name });
        }
      }
    } catch (e) {
      console.warn(`[backup] list ${bucket} failed`, e);
    }
  }
  return out;
}

export async function buildBackupZip(opts: {
  manifest: BackupManifest;
  includeAttachments: boolean;
  onProgress?: (msg: string) => void;
}): Promise<Blob> {
  const { manifest, includeAttachments, onProgress = () => {} } = opts;
  const zip = new JSZip();
  zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  zip.file("README.txt",
    `نسخة احتياطية كاملة\nالتاريخ: ${manifest.generated_at}\nعدد الجداول: ${Object.keys(manifest.tables).length}\n`
  );

  if (includeAttachments && manifest.tenant_id) {
    onProgress("جاري قراءة قائمة المرفقات…");
    const files = await listTenantStorageFiles(manifest.tenant_id);
    manifest.storage_files = files;
    let i = 0;
    for (const f of files) {
      i++;
      onProgress(`تنزيل المرفقات ${i}/${files.length}…`);
      try {
        const { data } = await supabase.storage.from(f.bucket).download(f.path);
        if (data) zip.file(`attachments/${f.bucket}/${f.path}`, data);
      } catch (e) {
        console.warn("[backup] download failed", f, e);
      }
    }
    zip.file("manifest.json", JSON.stringify(manifest, null, 2));
  }

  onProgress("جاري ضغط الأرشيف…");
  return zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 1000);
}

// Restore — best-effort upsert per table.
export async function restoreFromManifest(
  manifest: BackupManifest,
  opts?: { onProgress?: (msg: string) => void }
): Promise<{ inserted: Record<string, number>; errors: Record<string, string> }> {
  const onP = opts?.onProgress ?? (() => {});
  const inserted: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const t of BACKUP_TABLES) {
    const rows = manifest.tables?.[t];
    if (!rows || rows.length === 0) continue;
    onP(`استعادة ${t} (${rows.length})…`);
    // Upsert in chunks of 500
    const CHUNK = 500;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      const { error } = await supabase.from(t as any).upsert(chunk as any, { onConflict: "id" } as any);
      if (error) {
        errors[t] = error.message;
        break;
      }
      inserted[t] = (inserted[t] || 0) + chunk.length;
    }
  }
  return { inserted, errors };
}
