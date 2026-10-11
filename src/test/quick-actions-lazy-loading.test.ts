import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("quick actions loading", () => {
  it("mounts work-order readers only after a user opens the picker", () => {
    for (const path of ["src/components/QuickActionsFAB.tsx", "src/components/dashboard/QuickActionsMenu.tsx"]) {
      const source = readFileSync(path, "utf8");
      expect(source).toContain('lazy(() => import("@/components/workorders/WorkOrderPickerDialog"))');
      expect(source).toContain("pickerOpen &&");
      expect(source).not.toContain('import { stockMovementsStore } from "@/lib/stockMovementsStore"');
      expect(source).not.toContain('import { inventoryStore } from "@/lib/inventoryStore"');
    }
  });

  it("keeps dashboard quick action labels in the active language", () => {
    const source = readFileSync("src/components/dashboard/QuickActionsMenu.tsx", "utf8");
    expect(source).toContain('label("إجراءات سريعة", "Quick actions")');
    expect(source).toContain('style={{ direction: isRtl ? "rtl" : "ltr" }}');
  });
});
