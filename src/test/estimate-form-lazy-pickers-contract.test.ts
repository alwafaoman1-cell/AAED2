import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const source = fs.readFileSync(path.join(process.cwd(), "src/pages/estimates/EstimateForm.tsx"), "utf8");

describe("estimate form lazy linked-record pickers", () => {
  it("does not load 200 records from operational tables on form open", () => {
    expect(source).not.toContain(".limit(200)");
    expect(source).not.toContain("queryKeys.estimates.lookups");
    expect(source).toContain("queryKeys.estimates.linkedRecords");
  });

  it("searches only after two characters with tenant and deletion filters", () => {
    expect(source).toContain("term.length < 2");
    expect(source).toContain('.eq("tenant_id", tenantId)');
    expect(source).toContain('.is("deleted_at", null)');
    expect(source).toContain("}, 300)");
  });

  it("loads only selected linked records and defers parent estimates", () => {
    expect(source).toContain('.eq("id", form.customer_id).maybeSingle()');
    expect(source).toContain('.eq("id", form.vehicle_id).maybeSingle()');
    expect(source).toContain('.eq("id", form.claim_id).is("deleted_at", null).maybeSingle()');
    expect(source).toContain('form.estimate_type === "supplementary"');
    expect(source).toContain(".limit(50)");
  });
});
