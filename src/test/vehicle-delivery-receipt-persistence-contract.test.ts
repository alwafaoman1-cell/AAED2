import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");

describe("vehicle delivery receipt persistence contract", () => {
  it("uses a dedicated cloud SSOT and keeps metadata only as a compatibility fallback", () => {
    const service = read("src/lib/vehicleDeliveryReceipt.ts");
    expect(service).toContain('from("vehicle_handover_records" as any)');
    expect(service).toContain("finalizeVehicleDeliveryReceipt");
    expect(service).toContain("cancelLatestFinalizedVehicleHandover");
    expect(service).toContain('DELIVERY_RECEIPT_METADATA_KEY = "vehicle_delivery_receipt"');
    expect(service).toContain("...metadata");
    expect(service).toContain("saveVehicleDeliveryReceiptDraft");
    expect(service).not.toContain("localStorage");
  });

  it("reloads the saved draft whenever the receipt dialog opens", () => {
    const dialog = read("src/components/workorders/VehicleDeliveryReceiptDialog.tsx");
    expect(dialog).toContain("loadVehicleDeliveryReceiptDraft");
    expect(dialog).toContain("saveVehicleDeliveryReceiptDraft");
    expect(dialog).toContain("حفظ المسودة");
    expect(dialog).toContain("اعتماد الخروج والتسليم");
    expect(dialog).toContain("if (!(await handleSave(false))) return");
  });

  it("finalizes and cancels through tenant-scoped RPCs without deleting history", () => {
    const migration = read("supabase/migrations/20260829100000_vehicle_exit_handover_ssot.sql");
    expect(migration).toContain("create table if not exists public.vehicle_handover_records");
    expect(migration).toContain("create or replace function public.finalize_vehicle_handover");
    expect(migration).toContain("create or replace function public.cancel_vehicle_handover");
    expect(migration).toContain("VEHICLE_HANDOVER_DELETE_FORBIDDEN");
    expect(migration).toContain("VEHICLE_HANDOVER_FINALIZED_IMMUTABLE");
    expect(migration).toContain("tenant_id = public.get_user_tenant_id()");
    expect(migration).toContain("cancellation_reason");
    expect(migration).not.toContain("delete from public.vehicle_handover_records");
  });

  it("removes direct delete and sequence write privileges from application roles", () => {
    const hardening = read("supabase/migrations/20260829103000_vehicle_handover_privilege_hardening.sql");

    expect(hardening).toContain(
      "revoke all on table public.vehicle_handover_records from anon, authenticated",
    );
    expect(hardening).toContain(
      "grant select, insert, update on table public.vehicle_handover_records to authenticated",
    );
    expect(hardening).toContain(
      "revoke all on table public.vehicle_handover_sequences from anon, authenticated",
    );
    expect(hardening).toContain(
      "grant select on table public.vehicle_handover_sequences to authenticated",
    );
  });

  it("prevents the old status controls from bypassing the signed handover", () => {
    const statusDialog = read("src/components/workorders/WorkOrderStatusDialog.tsx");
    const claimDetail = read("src/pages/insurance/InsuranceClaimDetail.tsx");
    const claimDelivery = read("src/components/insurance/ClaimDeliverySection.tsx");
    expect(statusDialog).toContain("onRequestHandover");
    expect(statusDialog).toContain("اعتماد التسليم يتم فقط من نموذج خروج وتسليم المركبة");
    expect(claimDetail).toContain("cancelLatestFinalizedVehicleHandover");
    expect(claimDetail).toContain("لا يمكن اعتماد التسليم من شريط المراحل");
    expect(claimDelivery).toContain("متابعة واعتماد الخروج والتسليم");
    expect(claimDelivery).not.toContain("handleSave(true)");
  });
});
