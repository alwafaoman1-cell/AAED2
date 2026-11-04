import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("insurance customer code contract", () => {
  it("loads the persisted customer code for claim detail and customer lookup", () => {
    const hooks = readFileSync("src/hooks/useInsuranceClaims.ts", "utf8");
    const detail = readFileSync("src/pages/insurance/InsuranceClaimDetail.tsx", "utf8");
    expect(hooks).toContain("customer:customers(name, phone, customer_code)");
    expect(hooks).toContain('.select("id, name, phone, customer_code")');
    const picker=hooks.slice(hooks.indexOf("export function useCustomers()"),hooks.indexOf("export function useVehiclesByCustomer"));
    expect(picker).toContain('await getCurrentTenantId()');
    expect(picker).toContain('.eq("tenant_id", tenantId)');
    expect(picker).toContain('.is("deleted_at", null)');
    expect(detail).toContain('(existing as any)?.customer');
    expect(hooks).toContain("createClaimInCloud(claimInput");
    expect(detail).toContain("const plateParts=parseFullPlate(vehiclePlate)");
    expect(detail).not.toContain("vehiclePatch.plate_number = vehiclePlate");
  });
  it("clears claim drafts with a valid empty document rather than forbidden SQL NULL", () => {
    const page = readFileSync("src/pages/insurance/NewInsuranceClaim.tsx", "utf8");
    expect(page).not.toMatch(/writeCloudSetting\(cloudDraftKey,\s*null\)/);
    expect(page.match(/createEmptyClaimDraft\(emptyDraft\(\)\)/g)).toHaveLength(2);
    expect(page).toContain("if (!stored?.savedAt");
  });
});
