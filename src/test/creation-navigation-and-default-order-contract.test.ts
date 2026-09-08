import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

describe("creation navigation and newest-first ordering contract", () => {
  it("opens the newly-created work order only after a successful save", () => {
    const form = read("src/components/workorders/WorkOrderForm.tsx");
    const page = read("src/pages/WorkOrderNew.tsx");

    expect(form).toContain("if (onSaved) onSaved(saved)");
    expect(page).toContain("onSaved={(saved) => navigate(`/work-orders/${encodeURIComponent(saved.id)}`");
  });

  it("keeps work orders newest-first by their visible sequence", () => {
    const store = read("src/lib/workOrdersStore.ts");

    expect(store).toContain("if (aNumber !== bNumber) return bNumber - aNumber");
    expect(store).not.toContain('const da = (a.entryDate || "").localeCompare(b.entryDate || "")');
  });

  it("defaults invoice lists to descending document number", () => {
    const salesList = read("src/components/sales/SalesDocList.tsx");
    const insuranceAccounting = read("src/pages/insurance/InsuranceAccounting.tsx");

    expect(salesList).toContain('b.number.localeCompare(a.number, undefined, { numeric: true');
    expect(insuranceAccounting).toContain('useState<InsuranceInvoiceSortKey>("invoiceNumber")');
    expect(insuranceAccounting).toContain('useState<"asc" | "desc">("desc")');
    expect(insuranceAccounting).toContain('searchParams.get("invoice")');
    expect(insuranceAccounting).toContain("void handlePreview(invoice)");
  });
});
