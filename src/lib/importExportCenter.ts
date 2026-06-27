import * as XLSX from "xlsx";
import { supabase } from "@/integrations/supabase/client";
import { customersStore } from "@/lib/customersStore";
import { getWorkOrders } from "@/lib/workOrdersStore";
import { expensesStore } from "@/lib/expensesStore";
import { vehiclesStore } from "@/lib/vehiclesStore";
import { readSystemPreferences } from "@/lib/systemPreferences";
import { toE164 } from "@/lib/phoneUtils";
import { getCurrentTenantId } from "@/lib/cloud/createCloudStore";

export type ImportExportEntity =
  | "daily_log"
  | "claims"
  | "invoices"
  | "customers"
  | "vehicles"
  | "work_orders"
  | "expenses"
  | "archive"
  | "reports";

export interface ImportExportColumn {
  key: string;
  label: string;
  required?: boolean;
}

export interface ParsedImport {
  headers: string[];
  rows: Record<string, unknown>[];
}

export interface DuplicateCheckResult {
  rowIndex: number;
  reason: string;
}

export const IMPORT_EXPORT_ENTITIES: Array<{
  key: ImportExportEntity;
  labelAr: string;
  labelEn: string;
  columns: ImportExportColumn[];
  canImport: boolean;
  canExport: boolean;
}> = [
  { key: "daily_log", labelAr: "السجل اليومي", labelEn: "Daily Log", canImport: true, canExport: true, columns: [
    { key: "date", label: "Date", required: true }, { key: "customer", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "plate", label: "Plate" }, { key: "notes", label: "Notes" },
  ] },
  { key: "claims", labelAr: "المطالبات", labelEn: "Claims", canImport: true, canExport: true, columns: [
    { key: "claim_number", label: "Claim Number", required: true }, { key: "customer_name", label: "Customer" }, { key: "customer_phone", label: "Phone" }, { key: "plate", label: "Plate" }, { key: "insurance_company", label: "Insurance Company" },
  ] },
  { key: "invoices", labelAr: "الفواتير", labelEn: "Invoices", canImport: true, canExport: true, columns: [
    { key: "invoice_number", label: "Invoice Number", required: true }, { key: "customer_name", label: "Customer" }, { key: "customer_phone", label: "Phone" }, { key: "total", label: "Total" },
  ] },
  { key: "customers", labelAr: "العملاء", labelEn: "Customers", canImport: true, canExport: true, columns: [
    { key: "name", label: "Name", required: true }, { key: "phone", label: "Phone" }, { key: "email", label: "Email" }, { key: "address", label: "Address" },
  ] },
  { key: "vehicles", labelAr: "المركبات", labelEn: "Vehicles", canImport: true, canExport: true, columns: [
    { key: "plate", label: "Plate", required: true }, { key: "owner", label: "Owner" }, { key: "owner_phone", label: "Owner Phone" }, { key: "type", label: "Type" }, { key: "vin", label: "VIN" },
  ] },
  { key: "work_orders", labelAr: "أوامر العمل", labelEn: "Work Orders", canImport: true, canExport: true, columns: [
    { key: "order_number", label: "Order Number", required: true }, { key: "customer", label: "Customer" }, { key: "phone", label: "Phone" }, { key: "plate", label: "Plate" }, { key: "status", label: "Status" },
  ] },
  { key: "expenses", labelAr: "المصروفات", labelEn: "Expenses", canImport: false, canExport: true, columns: [
    { key: "voucher_number", label: "Voucher" }, { key: "date", label: "Date" }, { key: "beneficiary", label: "Beneficiary" }, { key: "amount", label: "Amount" },
  ] },
  { key: "archive", labelAr: "الأرشيف", labelEn: "Archive", canImport: false, canExport: true, columns: [
    { key: "reference", label: "Reference" }, { key: "type", label: "Type" }, { key: "date", label: "Date" },
  ] },
  { key: "reports", labelAr: "التقارير", labelEn: "Reports", canImport: false, canExport: true, columns: [
    { key: "name", label: "Report" }, { key: "generated_at", label: "Generated At" }, { key: "status", label: "Status" },
  ] },
];

export function getEntityDefinition(entity: ImportExportEntity) {
  return IMPORT_EXPORT_ENTITIES.find((item) => item.key === entity) || IMPORT_EXPORT_ENTITIES[0];
}

export async function parseImportFile(file: File): Promise<ParsedImport> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(firstSheet, { defval: "" });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
}

export function autoMapColumns(headers: string[], entity: ImportExportEntity): Record<string, string> {
  const normalized = new Map(headers.map((h) => [h.trim().toLowerCase().replace(/\s+/g, "_"), h]));
  const map: Record<string, string> = {};
  getEntityDefinition(entity).columns.forEach((col) => {
    const candidates = [
      col.key,
      col.label.toLowerCase().replace(/\s+/g, "_"),
      col.label.toLowerCase(),
      col.key.replace(/_/g, " "),
    ];
    const found = candidates.map((c) => normalized.get(c)).find(Boolean);
    if (found) map[col.key] = found;
  });
  return map;
}

export function mapRows(rows: Record<string, unknown>[], columnMap: Record<string, string>) {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    Object.entries(columnMap).forEach(([target, source]) => {
      out[target] = String(row[source] ?? "").trim();
    });
    return out;
  });
}

export function detectDuplicates(entity: ImportExportEntity, rows: Record<string, string>[]): DuplicateCheckResult[] {
  const duplicates: DuplicateCheckResult[] = [];
  const seen = new Set<string>();
  const existingCustomers = new Set(customersStore.getAll().map((c) => (c.phone || c.name).trim().toLowerCase()).filter(Boolean));
  const existingVehicles = new Set(vehiclesStore.getAll().map((v) => v.plate.trim().toLowerCase()).filter(Boolean));
  const existingOrders = new Set(getWorkOrders().map((o) => (o.displayNumber || o.id).trim().toLowerCase()).filter(Boolean));
  rows.forEach((row, index) => {
    const key = entity === "customers"
      ? (row.phone || row.name || "").toLowerCase()
      : entity === "vehicles"
      ? (row.plate || "").toLowerCase()
      : entity === "work_orders"
      ? (row.order_number || "").toLowerCase()
      : entity === "claims"
      ? (row.claim_number || "").toLowerCase()
      : entity === "invoices"
      ? (row.invoice_number || "").toLowerCase()
      : "";
    if (!key) return;
    if (seen.has(key)) duplicates.push({ rowIndex: index + 1, reason: "Duplicate inside uploaded file" });
    seen.add(key);
    if (entity === "customers" && existingCustomers.has(key)) duplicates.push({ rowIndex: index + 1, reason: "Customer already exists" });
    if (entity === "vehicles" && existingVehicles.has(key)) duplicates.push({ rowIndex: index + 1, reason: "Vehicle already exists" });
    if (entity === "work_orders" && existingOrders.has(key)) duplicates.push({ rowIndex: index + 1, reason: "Work order already exists" });
  });
  return duplicates;
}

export async function normalizePhonesInRows(rows: Record<string, string>[]) {
  const prefs = await Promise.race([
    readSystemPreferences(),
    new Promise<Awaited<ReturnType<typeof readSystemPreferences>>>((resolve) => {
      setTimeout(() => resolve({ defaultCountryCode: "968", activeThemeId: "gold", themes: [] }), 1200);
    }),
  ]);
  return rows.map((row) => {
    const next = { ...row };
    ["phone", "customer_phone", "owner_phone"].forEach((field) => {
      if (next[field]) next[field] = toE164(next[field], prefs.defaultCountryCode);
    });
    return next;
  });
}

export function buildTemplateWorkbook(entity: ImportExportEntity) {
  const def = getEntityDefinition(entity);
  const sample = Object.fromEntries(def.columns.map((col) => [col.label, col.required ? "Required" : ""]));
  const sheet = XLSX.utils.json_to_sheet([sample]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, def.labelEn.slice(0, 30));
  XLSX.writeFile(workbook, `${entity}-template.xlsx`);
}

export function exportRows(entity: ImportExportEntity) {
  let rows: Record<string, unknown>[] = [];
  if (entity === "customers") rows = customersStore.getAll().map((row) => ({ ...row }));
  else if (entity === "vehicles") rows = vehiclesStore.getAll().map((row) => ({ ...row }));
  else if (entity === "work_orders") rows = getWorkOrders().map((row) => ({ ...row }));
  else if (entity === "expenses") rows = expensesStore.getAll ? expensesStore.getAll().map((row) => ({ ...row })) : [];
  else rows = [{ name: getEntityDefinition(entity).labelEn, generated_at: new Date().toISOString(), status: "Ready" }];
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, getEntityDefinition(entity).labelEn.slice(0, 30));
  XLSX.writeFile(workbook, `${entity}-${new Date().toISOString().slice(0, 10)}.xlsx`);
  return rows.length;
}

export async function logImportExportOperation(payload: {
  operation: "import" | "export";
  entity: ImportExportEntity;
  status: "previewed" | "completed" | "failed";
  rowCount: number;
  duplicateCount?: number;
  errorCount?: number;
  metadata?: Record<string, unknown>;
}) {
  try {
    const tenantId = await getCurrentTenantId();
    if (!tenantId) return;
    await supabase.from("import_export_operations" as never).insert({
      tenant_id: tenantId,
      operation: payload.operation,
      entity: payload.entity,
      status: payload.status,
      row_count: payload.rowCount,
      duplicate_count: payload.duplicateCount || 0,
      error_count: payload.errorCount || 0,
      metadata: payload.metadata || {},
    } as never);
  } catch {
    // Logging must never block imports/exports.
  }
}
