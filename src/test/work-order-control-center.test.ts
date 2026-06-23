import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  isInsuranceWorkOrder,
  resolveWorkOrderType,
  workOrderTypeLabel,
} from "@/lib/workOrderType";

describe("work order type rules", () => {
  it("defaults a manual work order to general customer", () => {
    expect(resolveWorkOrderType({})).toBe("general_customer");
    expect(workOrderTypeLabel("general_customer")).toContain("GENERAL");
  });

  it("forces a claim-linked work order to insurance", () => {
    expect(resolveWorkOrderType({
      workOrderType: "general_customer",
      claimId: "85e677ce-754e-4a79-a85c-fef782b31ea0",
    })).toBe("insurance");
    expect(isInsuranceWorkOrder({ claimId: "claim-id" })).toBe(true);
  });

  it("keeps explicitly authorized insurance orders without creating claims", () => {
    expect(resolveWorkOrderType({
      workOrderType: "insurance",
      claimNumber: "CLM-2026-100",
    })).toBe("insurance");
  });
});

describe("work order production contract", () => {
  const root = process.cwd();
  const migration = readFileSync(
    resolve(root, "supabase/migrations/20260623090000_work_order_control_center.sql"),
    "utf8",
  );
  const qrLabel = readFileSync(resolve(root, "src/components/workorders/QrLabel.tsx"), "utf8");
  const listPage = readFileSync(resolve(root, "src/pages/WorkOrders.tsx"), "utf8");

  it("backfills and constrains work order type", () => {
    expect(migration).toContain("job_orders_work_order_type_check");
    expect(migration).toContain("WHEN claim_id IS NOT NULL THEN 'insurance'");
    expect(migration).toContain("work_order_type IN ('general_customer', 'insurance')");
  });

  it("uses opaque tracking tokens with expiry handling", () => {
    expect(migration).toContain("tracking_token uuid NOT NULL DEFAULT gen_random_uuid()");
    expect(migration).toContain("tracking_expires_at");
    expect(migration).toContain("access_state");
    expect(migration).not.toContain("WHERE id::text = p_key OR order_number = p_key");
  });

  it("does not print work-order or QR HTML directly", () => {
    expect(qrLabel).not.toContain("window.print(");
    expect(qrLabel).not.toContain("document.write(");
    expect(listPage).not.toContain("window.print(");
  });

  it("does not offer claim creation for general orders", () => {
    expect(listPage).toContain('resolveWorkOrderType(order) === "insurance"');
    expect(listPage).toContain("إنشاء مطالبة تأمين");
  });
});
