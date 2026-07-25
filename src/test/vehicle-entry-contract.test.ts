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
    expect(service).not.toContain("localStorage");
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

  it("does not issue a vehicle entry before both required signatures are saved", () => {
    const service = read("src/lib/vehicleEntryService.ts");
    const issueStart = service.indexOf("export async function issueVehicleEntry");
    const issueBody = service.slice(issueStart, service.indexOf("async function insertVehicleEntryAudit"));
    expect(issueBody).toContain("vehicle_entry_signatures");
    expect(issueBody).toContain('roles.has("delivered_by")');
    expect(issueBody).toContain('roles.has("receiver")');
    expect(issueBody).toContain("لا يمكن إصدار نموذج دخول المركبة");
  });
});
