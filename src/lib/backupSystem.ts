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
  "invoices", "sales_documents", "payments", "expenses",
  "inventory",
  "daily_tasks",
  "payment_links",
  "print_templates",
  "sms_logs", "whatsapp_logs", "message_logs", "customer_notifications",
  "tenant_integrations", "tenant_sms_settings",
] as const;

export const BACKUP_BUCKETS = ["damage-photos", "insurance-docs", "invoices-pdf", "avatars"] as const;

export type BackupManifest = {
  version: 1;
  schema_version?: 1;
  generated_at: string;
  exported_at?: string;
  tenant_id: string | null;
  metadata?: {
    schema_version: 1;
    exported_at: string;
    tenant_id: string | null;
    tables: string[];
    row_counts: Record<string, number>;
    secrets_masked: boolean;
  };
  app: "alwafa-erp";
  tables: Record<string, any[]>;
  storage_files?: { bucket: string; path: string }[];
};

export type RestoreDryRunReport = {
  ok: boolean;
  mode: "merge" | "replace";
  schemaVersion: number | null;
  sourceTenantId: string | null;
  currentTenantId: string | null;
  tenantMapping: Record<string, string>;
  idMapping: Record<string, Record<string, string>>;
  tableCounts: Record<string, number>;
  duplicates: Record<string, number>;
  importable: Record<string, number>;
  skipped: Record<string, number>;
  rejected: Record<string, number>;
  errors: Record<string, string[]>;
  warnings: string[];
};

function emptyReport(mode: "merge" | "replace"): RestoreDryRunReport {
  return {
    ok: false,
    mode,
    schemaVersion: null,
    sourceTenantId: null,
    currentTenantId: null,
    tenantMapping: {},
    idMapping: {},
    tableCounts: {},
    duplicates: {},
    importable: {},
    skipped: {},
    rejected: {},
    errors: {},
    warnings: [],
  };
}

function addError(report: RestoreDryRunReport, table: string, message: string) {
  report.errors[table] = [...(report.errors[table] || []), message];
}

function cleanPhone(value: unknown) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeText(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/\s+/g, "");
}

function maskSecret(value: unknown) {
  const text = String(value || "");
  if (!text) return "";
  return `${text.slice(0, 3)}****${text.slice(-4)}`;
}

function sanitizeRow(table: string, row: any) {
  const next = { ...row };
  if (table === "tenant_integrations") {
    const secrets = next.secrets || {};
    next.secrets = Object.fromEntries(Object.keys(secrets).map((key) => [key, maskSecret(secrets[key])]));
    next.__secrets_masked = true;
  }
  return next;
}

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
    all.push(...data.map((row) => sanitizeRow(name, row)));
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
  const exportedAt = new Date().toISOString();
  const rowCounts = Object.fromEntries(Object.entries(tables).map(([key, rows]) => [key, rows.length]));
  return {
    version: 1,
    schema_version: 1,
    generated_at: exportedAt,
    exported_at: exportedAt,
    tenant_id: tenantId,
    metadata: {
      schema_version: 1,
      exported_at: exportedAt,
      tenant_id: tenantId,
      tables: Object.keys(tables),
      row_counts: rowCounts,
      secrets_masked: true,
    },
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

export async function readBackupManifestFromBlob(blob: Blob): Promise<BackupManifest> {
  const filename = "name" in blob ? String((blob as File).name || "").toLowerCase() : "";
  const isZipByName = filename.endsWith(".zip");
  const head = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  const isZipByMagic = head[0] === 0x50 && head[1] === 0x4b;

  if (isZipByName || isZipByMagic) {
    const zip = await JSZip.loadAsync(blob);
    const manifestEntry =
      zip.file("manifest.json") ||
      zip.file(/(^|\/)manifest\.json$/i)[0];
    if (!manifestEntry) {
      throw new Error("ملف ZIP لا يحتوي على manifest.json");
    }
    const text = await manifestEntry.async("string");
    return JSON.parse(text) as BackupManifest;
  }

  const text = await blob.text();
  return JSON.parse(text) as BackupManifest;
}

async function getCurrentTenantId(): Promise<string | null> {
  const { data } = await supabase.rpc("get_user_tenant_id" as any);
  return (data as string) || null;
}

async function countDuplicates(table: string, rows: any[], tenantId: string | null) {
  if (!tenantId || rows.length === 0) return 0;
  let duplicates = 0;
  if (table === "customers") {
    const phones = Array.from(new Set(rows.map((r) => cleanPhone(r.phone)).filter(Boolean)));
    if (phones.length) {
      const { data } = await supabase.from("customers" as any).select("id,phone").eq("tenant_id", tenantId).in("phone", phones as any);
      const existing = new Set((data || []).map((r: any) => cleanPhone(r.phone)).filter(Boolean));
      duplicates += phones.filter((phone) => existing.has(phone)).length;
    }
  }
  if (table === "vehicles") {
    const { data } = await supabase.from("vehicles" as any)
      .select("plate_number,plate_letters,plate_country")
      .eq("tenant_id", tenantId)
      .limit(10000);
    const existing = new Set((data || []).map((r: any) => `${normalizeText(r.plate_number)}|${normalizeText(r.plate_letters)}|${normalizeText(r.plate_country || "OM")}`));
    const keys = Array.from(new Set(rows.map((r) => `${normalizeText(r.plate_number)}|${normalizeText(r.plate_letters)}|${normalizeText(r.plate_country || "OM")}`).filter((key) => !key.startsWith("||"))));
    duplicates += keys.filter((key) => existing.has(key)).length;
  }
  if (table === "insurance_claims") {
    const nums = Array.from(new Set(rows.map((r) => normalizeText(r.claim_number)).filter(Boolean)));
    if (nums.length) {
      const { data } = await supabase.from("insurance_claims" as any).select("claim_number").eq("tenant_id", tenantId).in("claim_number", nums as any);
      const existing = new Set((data || []).map((r: any) => normalizeText(r.claim_number)));
      duplicates += nums.filter((n) => existing.has(n)).length;
    }
  }
  if (table === "job_orders") {
    const nums = Array.from(new Set(rows.map((r) => normalizeText(r.order_number)).filter(Boolean)));
    if (nums.length) {
      const { data } = await supabase.from("job_orders" as any).select("order_number").eq("tenant_id", tenantId).in("order_number", nums as any);
      const existing = new Set((data || []).map((r: any) => normalizeText(r.order_number)));
      duplicates += nums.filter((n) => existing.has(n)).length;
    }
  }
  if (table === "sales_documents" || table === "invoices") {
    const numberKey = table === "sales_documents" ? "doc_number" : "invoice_number";
    const nums = Array.from(new Set(rows.map((r) => normalizeText(r[numberKey] || r.invoice_number || r.doc_number)).filter(Boolean)));
    if (nums.length) {
      const { data } = await supabase.from(table as any).select(numberKey).eq("tenant_id", tenantId).in(numberKey, nums as any);
      const existing = new Set((data || []).map((r: any) => normalizeText(r[numberKey])));
      duplicates += nums.filter((n) => existing.has(n)).length;
    }
  }
  return duplicates;
}

export async function dryRunRestoreManifest(
  manifest: BackupManifest,
  opts?: { mode?: "merge" | "replace"; onProgress?: (msg: string) => void }
): Promise<RestoreDryRunReport> {
  const mode = opts?.mode || "merge";
  const onP = opts?.onProgress ?? (() => {});
  const report = emptyReport(mode);
  report.schemaVersion = manifest.schema_version || manifest.version || null;
  report.sourceTenantId = manifest.metadata?.tenant_id || manifest.tenant_id || null;
  report.currentTenantId = await getCurrentTenantId();
  if (report.sourceTenantId && report.currentTenantId) report.tenantMapping[report.sourceTenantId] = report.currentTenantId;

  if (manifest.app !== "alwafa-erp") addError(report, "manifest", "Invalid backup app.");
  if ((manifest.schema_version || manifest.version) !== 1) addError(report, "manifest", "Unsupported schema_version.");
  if (!manifest.tables || typeof manifest.tables !== "object") addError(report, "manifest", "Missing tables.");
  if (!report.currentTenantId) addError(report, "tenant", "Current tenant was not found.");

  for (const table of BACKUP_TABLES) {
    const rows = manifest.tables?.[table] || [];
    report.tableCounts[table] = rows.length;
    if (!Array.isArray(rows)) {
      addError(report, table, "Table payload must be an array.");
      continue;
    }
    onP(`Dry Run: فحص ${table} (${rows.length})…`);
    const duplicateCount = await countDuplicates(table, rows, report.currentTenantId);
    report.duplicates[table] = duplicateCount;
    report.importable[table] = mode === "merge" ? Math.max(0, rows.length - duplicateCount) : rows.length;
    report.skipped[table] = mode === "merge" ? duplicateCount : 0;
    report.rejected[table] = 0;

    for (const row of rows) {
      if (row?.id) {
        report.idMapping[table] ||= {};
        report.idMapping[table][row.id] = row.id;
      }
      if (table === "tenant_integrations" && row?.secrets && !row.__secrets_masked) {
        report.warnings.push("Backup contains tenant_integrations; secrets will not be restored.");
      }
    }
  }
  if (mode === "replace") {
    report.ok = false;
    addError(report, "replace_mode", "Replace Mode requires password + OTP + confirmation phrase and is disabled in this client restore flow.");
  } else {
    report.ok = Object.keys(report.errors).length === 0;
  }
  return report;
}

function mapTenant(row: any, currentTenantId: string | null) {
  if (!currentTenantId) return row;
  const next = { ...row };
  if ("tenant_id" in next) next.tenant_id = currentTenantId;
  return next;
}

function stripUnsafeRestoreFields(table: string, row: any, currentTenantId: string | null) {
  const next = mapTenant(row, currentTenantId);
  if (table === "tenants" || table === "profiles") return null;
  if (table === "tenant_integrations") {
    delete next.secrets;
    delete next.__secrets_masked;
  }
  return next;
}

// Restore — merge mode only by default; must pass successful dryRunReport.
export async function restoreFromManifest(
  manifest: BackupManifest,
  opts?: { onProgress?: (msg: string) => void; dryRunReport?: RestoreDryRunReport; mode?: "merge" | "replace" }
): Promise<{ inserted: Record<string, number>; errors: Record<string, string> }> {
  const onP = opts?.onProgress ?? (() => {});
  const mode = opts?.mode || "merge";
  if (mode !== "merge") throw new Error("Replace Mode requires protected server-side workflow and is disabled here.");
  const report = opts?.dryRunReport || await dryRunRestoreManifest(manifest, { mode, onProgress: onP });
  if (!report.ok) throw new Error("Dry Run failed. Review the report before restoring.");
  const inserted: Record<string, number> = {};
  const errors: Record<string, string> = {};
  for (const t of BACKUP_TABLES) {
    if (t === "tenants" || t === "profiles") continue;
    const rows = (manifest.tables?.[t] || [])
      .map((row) => stripUnsafeRestoreFields(t, row, report.currentTenantId))
      .filter(Boolean);
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
