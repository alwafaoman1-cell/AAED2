import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("insurance customer code contract", () => {
  it("loads the persisted customer code for claim detail and customer lookup", () => {
    const hooks = readFileSync("src/hooks/useInsuranceClaims.ts", "utf8");
    const detail = readFileSync("src/pages/insurance/InsuranceClaimDetail.tsx", "utf8");
    expect(hooks).toContain("customer:customers(name, phone, customer_code)");
    expect(hooks).toContain('.select("id, name, phone, customer_code")');
    expect(detail).toContain('(existing as any)?.customer');
  });
});
