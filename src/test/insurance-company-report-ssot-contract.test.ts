import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  filterInsuranceCollectionRows,
  type InsuranceCollectionRow,
} from "@/lib/insuranceCollectionReport";

const row = (index: number, patch: Partial<InsuranceCollectionRow> = {}): InsuranceCollectionRow => ({
  claimId: `claim-${index}`,
  invoiceId: `invoice-${index}`,
  sortDate: "2026-08-01",
  claimNumber: `C-${index}`,
  vehicleNumber: `${index}`,
  vehicleMakeModel: "Vehicle",
  customerName: "Customer",
  estimateDate: "01/08/2026",
  workshopArrivalDate: "01/08/2026",
  workStartedAt: "01/08/2026",
  workCompletedAt: "02/08/2026",
  deliveredAt: "03/08/2026",
  invoiceDateNumber: `INV-${index}`,
  workshopDays: 2,
  status: "تم التسليم",
  approvedBeforeVat: 100,
  vatAmount: 5,
  totalIncludingVat: 105,
  paidAmount: 0,
  collectionStatus: "غير مدفوع",
  remainingAmount: 105,
  ...patch,
});

describe("insurance company report SSOT", () => {
  it("keeps every invoiced outstanding row in pending collection regardless of delivery", () => {
    const rows = [
      row(1),
      row(2, { paidAmount: 50, remainingAmount: 55, collectionStatus: "مدفوع جزئيًا" }),
      row(3),
      row(4, { invoiceId: null, invoiceDateNumber: "—", collectionStatus: "غير مفوتر" }),
      row(5, { deliveredAt: "—" }),
      row(6, { paidAmount: 105, remainingAmount: 0, collectionStatus: "مدفوع بالكامل" }),
      ...Array.from({ length: 5 }, (_, offset) => row(7 + offset, {
        invoiceId: null,
        collectionStatus: "غير مفوتر",
      })),
    ];

    const pending = filterInsuranceCollectionRows(rows, "pending_collection");
    expect(rows).toHaveLength(11);
    expect(pending.map((item) => item.claimId)).toEqual(["claim-1", "claim-2", "claim-3", "claim-5"]);
  });

  it("uses the same filtered rows for the button, preview and Excel export", () => {
    const page = readFileSync("src/pages/insurance/InsuranceCompanyDetail.tsx", "utf8");
    expect(page).toContain("filterInsuranceCollectionRows(allCollectionRows, reportFilter)");
    expect(page).toContain("new Set(collectionExportRows.map((row) => row.claimId))");
    expect(page).toContain("exportInsuranceCollectionRowsToXlsx(\n        collectionExportRows,");
    expect(page).toContain("تقرير عمليات الورشة ({collectionExportRows.length})");
  });
});
