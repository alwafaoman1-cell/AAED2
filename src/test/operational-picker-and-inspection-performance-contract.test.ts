import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("operational picker and inspection performance contract", () => {
  it("does not preload claims and insurance companies when the work-order form mounts", () => {
    const source = read("src/components/workorders/WorkOrderForm.tsx");

    expect(source).not.toContain(".limit(1000)");
    expect(source).not.toContain(".limit(500)");
    expect(source).toContain("claimSearch.trim()");
    expect(source).toContain("term.length < 2");
    expect(source).toContain('.eq("tenant_id", tenant)');
    expect(source).toContain("if (companiesLoaded || companiesLoading) return");
  });

  it("searches vehicles lazily on the new-claim form", () => {
    const source = read("src/pages/insurance/NewInsuranceClaim.tsx");

    expect(source).not.toContain(".limit(200)");
    expect(source).toContain("if (term.length < 2)");
    expect(source).toContain('.eq("tenant_id", tenant)');
    expect(source).toContain('.is("deleted_at", null)');
    expect(source).toContain(".limit(20)");
  });

  it("keeps one centralized inspections realtime owner without full-table refetches", () => {
    const store = read("src/lib/inspectionsStore.ts");
    const realtime = read("src/hooks/useRealtimeSync.ts");

    expect(store).not.toContain(".limit(5000)");
    expect(store).not.toContain(".channel(");
    expect(store).not.toContain('.from("profiles")');
    expect(store).toContain("applyInspectionRealtimeChange");
    expect(store).toContain('.order("inspection_code", { ascending: false })');
    expect(realtime).toContain('scope: "inspections"');
    expect(realtime).toContain("applyInspectionRealtimeChange(payload)");
  });
});
