import { describe, expect, it } from "vitest";
import { buildCustomerPortalInvitation } from "@/lib/customerPortalInvitation";
describe("customer portal invitations", () => {
  it.each(["en", "ar"] as const)("uses only the safe field allowlist in %s", language => {
    const body = buildCustomerPortalInvitation({ customerName: "Customer", vehicleMake: "Toyota", vehicleModel: "Corolla", vehicleYear: 2026,
      url: "https://example.invalid/customer/vehicle/canonical", plate: "QA 1234", vin: "SECRET-VIN", order: "SECRET-ORDER", claim: "SECRET-CLAIM", work_items: "SECRET-WORK", invoice: 777 } as any, language);
    expect(body).toContain("Customer"); expect(body).toContain("Toyota Corolla 2026");
    expect(body.match(/https:\/\//g)).toHaveLength(1);
    expect(body).not.toMatch(/QA 1234|SECRET|777/);
    expect(body).toContain(language === "en" ? "letters may be entered in English" : "يمكن إدخال الحروف بالإنجليزية");
    if (language === "en") expect(body).not.toMatch(/[\u0600-\u06ff]/);
  });
});
