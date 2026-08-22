// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");

describe("vehicle entry receipt contract", () => {
  it("defines non-destructive vehicle entry migration objects", () => {
    const sql = read("supabase/migrations/20260725173000_vehicle_entry_receipt.sql");
    expect(sql).toContain("create table if not exists public.vehicle_entries");
    expect(sql).toContain("create table if not exists public.vehicle_entry_damage_marks");
    expect(sql).toContain("create table if not exists public.vehicle_entry_documents");
    expect(sql).toContain("create table if not exists public.vehicle_entry_signatures");
    expect(sql).toContain("create table if not exists public.vehicle_entry_audit_logs");
    expect(sql).toContain("create or replace function public.next_vehicle_entry_number");
    expect(sql).toContain("alter table public.vehicle_media");
    expect(sql).toContain("add column if not exists vehicle_entry_id");
    expect(sql.toLowerCase()).not.toContain("drop table");
    expect(sql.toLowerCase()).not.toContain("delete from public.insurance_claims");
    expect(sql.toLowerCase()).not.toContain("delete from public.job_orders");
  });

  it("registers vehicle entry routes and sidebar entry", () => {
    const app = read("src/App.tsx");
    const sidebar = read("src/components/AppSidebar.tsx");
    expect(app).toContain('import("./pages/vehicle-entry/VehicleEntryList")');
    expect(app).toContain('path="/vehicle-entry"');
    expect(app).toContain('path="/vehicle-entry/new"');
    expect(app).toContain('path="/vehicle-entry/:id"');
    expect(app).toContain('path="/vehicle-entry/:id/edit"');
    expect(sidebar).toContain('path: "/vehicle-entry"');
  });

  it("uses shared query keys and duplicate-safe vehicle resolution", () => {
    const queryKeys = read("src/lib/queryKeys.ts");
    const service = read("src/lib/vehicleEntryService.ts");
    expect(queryKeys).toContain("vehicleEntries");
    expect(queryKeys).toContain('["vehicle_entries"]');
    expect(service).toContain("next_vehicle_entry_number");
    expect(service).toContain("ensureVehicleForCustomer");
    expect(service).toContain("vehicle_entry_damage_marks");
    expect(service).toContain("uploadVehicleEntryFiles");
    expect(service).toContain("saveVehicleEntrySignature");
    expect(service).toContain("convertVehicleEntryToClaim");
    expect(service).toContain("createWorkOrderFromVehicleEntry");
    expect(service).toContain("softDeleteVehicleEntryMedia");
    expect(service).toContain("buildVehicleEntryHtml");
    expect(service).toContain("insurance_claims!vehicle_entries_insurance_claim_id_fkey");
    expect(service).toContain("job_orders!vehicle_entries_work_order_id_fkey");
    expect(service).not.toContain("localStorage");
  });

  it("registers claim vehicle entry with the shared sequence and an atomic duplicate guard", () => {
    const service = read("src/lib/vehicleEntryService.ts");
    const detail = read("src/pages/insurance/InsuranceClaimDetail.tsx");
    const guard = read("supabase/migrations/20260820120000_claim_vehicle_entry_duplicate_guard.sql");
    expect(service).toContain("ensureVehicleEntryForClaim");
    expect(service).toContain("getVehicleEntryByClaimId");
    expect(detail).toContain("handleRegisterVehicleEntry");
    expect(detail).toContain('vehicle_presence_status: "in_workshop"');
    expect(detail).toContain("فتح كرت الدخول");
    expect(guard).toContain("pg_advisory_xact_lock");
    expect(guard).toContain("Vehicle entry already exists for this claim");
    expect(guard.toLowerCase()).not.toContain("delete from");
  });

  it("shows a dedicated archived handover paper after claim cancellation", () => {
    const detail = read("src/pages/insurance/InsuranceClaimDetail.tsx");
    const handover = read("src/lib/cancelledClaimVehicleHandover.ts");
    const upload = read("src/lib/uploadHtmlAsPdf.ts");
    expect(detail).toContain("ورقة تسليم المطالبة الملغاة");
    expect(detail).toContain('status === "cancelled" && showCancelledHandover');
    expect(detail).toContain('category: "cancelled_delivery_proof"');
    expect(handover).toContain("CANCELLED CLAIM VEHICLE HANDOVER");
    expect(handover).toContain("ولا يُعد فاتورة");
    expect(upload).toContain('"cancelled_delivery_proof"');
  });

  it("keeps media in vehicle_media and exports real XLSX from the list", () => {
    const service = read("src/lib/vehicleEntryService.ts");
    const list = read("src/pages/vehicle-entry/VehicleEntryList.tsx");
    expect(service).toContain('.from("vehicle_media" as any)');
    expect(service).toContain("vehicle_entry_id");
    expect(service).toContain("onConflict: \"tenant_id,storage_bucket,storage_path\"");
    expect(list).toContain('import * as XLSX from "xlsx"');
    expect(list).toContain("XLSX.writeFile");
    expect(list).not.toContain("exportRowsAsCsv");
  });

  it("supports interactive damage map and signatures in the form", () => {
    const form = read("src/pages/vehicle-entry/VehicleEntryForm.tsx");
    expect(form).toContain("function DamageMap");
    expect(form).toContain("onPointerDown");
    expect(form).toContain("function SignaturePad");
    expect(form).toContain("toDataURL");
    expect(form).toContain("saveVehicleEntrySignature");
    expect(form).toContain("uploadVehicleEntryFiles");
  });

  it("keeps vehicle entry officer, delivery source, staged photos, and editable declaration cloud-backed", () => {
    const form = read("src/pages/vehicle-entry/VehicleEntryForm.tsx");
    const service = read("src/lib/vehicleEntryService.ts");
    expect(form).toContain("InsuranceCompanyAutocomplete");
    expect(form).toContain("useInsuranceEmployees");
    expect(form).toContain('chooseDeliveredBy("owner")');
    expect(form).toContain('chooseDeliveredBy("driver")');
    expect(form).toContain('chooseDeliveredBy("tow")');
    expect(form).toContain("ENTRY_PHOTO_SLOTS");
    expect(form).toContain("pendingPhotos");
    expect(form).toContain("تم تجهيز");
    expect(form).toContain("form.declaration_ar");
    expect(form).toContain("form.declaration_en");
    expect(service).toContain("declaration_ar: cleanText(form.declaration_ar)");
    expect(service).toContain("declaration_en: cleanText(form.declaration_en)");
  });

  it("prints a real barcode, categorized entry photos, and highlighted identity fields without removed accident fields", () => {
    const service = read("src/lib/vehicleEntryService.ts");
    const currentTemplate = service.slice(service.indexOf("export function buildVehicleEntryHtml(entry"));
    expect(service).toContain('import JsBarcode from "jsbarcode"');
    expect(currentTemplate).toContain("buildVehicleEntryBarcode");
    expect(currentTemplate).toContain("front_view");
    expect(currentTemplate).toContain("main_damage");
    expect(currentTemplate).toContain("/assets/vehicle-damage-map.png");
    expect(currentTemplate).toContain("damage-map-image");
    expect(currentTemplate).toContain("important-value");
    expect(currentTemplate).toContain("رقم أمر الإصلاح Repair Order No.");
    expect(currentTemplate).not.toContain("نوع الوقود Fuel Type");
    expect(currentTemplate).not.toContain("تاريخ الحادث Accident Date");
    expect(currentTemplate).not.toContain("مكان الحادث Accident Location");
    expect(currentTemplate).not.toContain("نوع الحادث Accident Type");
  });

  it("renders the entry barcode and the saved declaration into print HTML", async () => {
    const { buildVehicleEntryHtml } = await import("@/lib/vehicleEntryService");
    const html = buildVehicleEntryHtml({
      entry_number: "ENT-2026-00058",
      arrival_date: "2026-08-22",
      arrival_time: "10:30",
      customer_snapshot: { name: "Test Owner", phone: "90000000" },
      vehicle_snapshot: { plate_number: "12345", plate_letters: "A", make: "Toyota", vin: "VIN123", highlight_color: "#dc2626" },
      insurance_snapshot: {},
      delivered_by: { full_name: "Test Owner", delivery_type: "owner" },
      vehicle_condition: {},
      vehicle_contents: {},
      damage_marks: [],
      vehicle_media: [],
      vehicle_entry_signatures: [],
      declaration_ar: "إقرار مخصص محفوظ",
      declaration_en: "Saved custom declaration",
    });
    expect(html).toContain("<svg");
    expect(html).toContain("ENT-2026-00058");
    expect(html).toContain("إقرار مخصص محفوظ");
    expect(html).toContain("Saved custom declaration");
  });

  it("does not issue a vehicle entry before both required signatures are saved", () => {
    const service = read("src/lib/vehicleEntryService.ts");
    const saveStart = service.indexOf("export async function saveVehicleEntry");
    const saveBody = service.slice(saveStart, service.indexOf("async function saveDamageMarks"));
    expect(saveBody).toContain('form.status === "Issued"');
    expect(saveBody).toContain("assertVehicleEntryCanBeIssued(form.id, tenantId)");
    const issueStart = service.indexOf("export async function issueVehicleEntry");
    const issueBody = service.slice(issueStart, service.indexOf("async function insertVehicleEntryAudit"));
    expect(service).toContain("async function assertVehicleEntryCanBeIssued");
    expect(issueBody).toContain("vehicle_entry_signatures");
    expect(issueBody).toContain('roles.has("delivered_by")');
    expect(issueBody).toContain('roles.has("receiver")');
    expect(issueBody).toContain("لا يمكن إصدار نموذج دخول المركبة");
  });
});
