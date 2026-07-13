import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { normalizeVin, normalizeVehiclePlate } from "@/lib/vehicleIdentity";

describe("vehicle identity guard", () => {
  it("normalizes VIN and plate before lookup", () => {
    expect(normalizeVin("  abc 123  ")).toBe("ABC123");
    expect(normalizeVehiclePlate({ plate: " aa 1234 " })).toEqual({
      letters: "AA",
      digits: "1234",
      country: "OM",
    });
  });

  it("keeps plate identity as the primary match and treats VIN as confirmation-only fallback", () => {
    const root = process.cwd();
    const identity = readFileSync(resolve(root, "src/lib/vehicleIdentity.ts"), "utf8");
    const plateLookup = identity.indexOf('rpc("find_vehicle_by_plate"');
    const vinLookup = identity.indexOf("vin.eq.");
    expect(plateLookup).toBeGreaterThan(-1);
    expect(vinLookup).toBeGreaterThan(-1);
    expect(plateLookup).toBeLessThan(vinLookup);
    expect(identity).toContain("vin_candidate_requires_user_confirmation");
    expect(identity).toContain("allowVinCandidate");
  });

  it("is used by work orders and insurance claims before creating vehicles", () => {
    const root = process.cwd();
    const workOrderForm = readFileSync(resolve(root, "src/components/workorders/WorkOrderForm.tsx"), "utf8");
    const newClaim = readFileSync(resolve(root, "src/pages/insurance/NewInsuranceClaim.tsx"), "utf8");
    const store = readFileSync(resolve(root, "src/lib/workOrdersStore.ts"), "utf8");
    expect(workOrderForm).toContain("ensureVehicleForCustomer");
    expect(workOrderForm).toContain("Use Existing Vehicle");
    expect(workOrderForm).toContain("ownershipConflict");
    expect(newClaim).toContain("ensureVehicleForCustomer");
    expect(newClaim).toContain("findExistingVehicle");
    expect(newClaim).toContain("Use Existing Customer");
    expect(newClaim).toContain("customer_id");
    expect(newClaim).not.toContain('.ilike("name", draft.ownerName.trim())');
    expect(newClaim).not.toContain("placeholderName");
    expect(newClaim).toContain("useCreateClaim");
    expect(newClaim).toContain("إنشاء/ربط المركبة يتم مركزياً داخل useCreateClaim");
    expect(store).toContain("vehicleId?: string");
  });

  it("adds duplicate reports without applying unsafe unique constraints", () => {
    const migration = readFileSync(
      resolve(rootPath(), "supabase/migrations/20260626100000_vehicle_identity_duplicate_report.sql"),
      "utf8",
    );
    expect(migration).toContain("vehicle_identity_duplicate_report");
    expect(migration).toContain("find_vehicle_by_vin");
    expect(migration).toContain("Primary matching key is plate identity");
    expect(migration).toContain("'vin_secondary'::text");
    expect(migration).not.toContain("CREATE UNIQUE INDEX");
  });
});

describe("cloud reset and login OTP safeguards", () => {
  it("keeps destructive reset behind password, OTP, and confirmation phrase", () => {
    const root = rootPath();
    const settings = readFileSync(resolve(root, "src/components/settings/SecurityDangerZone.tsx"), "utf8");
    const resetFunction = readFileSync(resolve(root, "supabase/functions/execute-cloud-reset/index.ts"), "utf8");
    const otpFunction = readFileSync(resolve(root, "supabase/functions/request-security-otp/index.ts"), "utf8");
    const auth = readFileSync(resolve(root, "src/pages/Auth.tsx"), "utf8");
    expect(settings).toContain("DELETE CLOUD DATA");
    expect(settings).toContain("signInWithPassword");
    expect(settings).toContain("isOwnerOrSuperAdmin");
    expect(settings).not.toContain('profile?.role === "manager"');
    expect(resetFunction).toContain("invalid_confirmation_phrase");
    expect(resetFunction).toContain("otp_invalid_or_expired");
    expect(resetFunction).toContain("security_otp_audit_log");
    expect(resetFunction).toContain("otp_locked");
    expect(otpFunction).toContain("RESEND_API_KEY");
    expect(otpFunction).toContain("otp_rate_limited");
    expect(auth).toContain("verify-security-otp");
    expect(auth).toContain("session && profile && otpVerified");
    expect(auth).not.toContain("if (session && profile) return <Navigate");
  });

  it("does not fall back to unsafe vehicle creation when identity lookup fails", () => {
    const store = readFileSync(resolve(rootPath(), "src/lib/workOrdersStore.ts"), "utf8");
    expect(store).not.toContain("UNK${Date.now()}");
    expect(store).not.toContain("find_vehicle_by_plate\", { p_letters: L");
    expect(store).toContain("[ensureVehicle:identity]");
  });
});

function rootPath() {
  return process.cwd();
}
