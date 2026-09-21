import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInsuranceCollectionRows,
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

  it("counts only cleared payments as collected and keeps pending cheques outstanding", () => {
    const claim = {
      id: "claim-1",
      tenant_id: "tenant-1",
      claim_number: "C-1",
      insurance_company: "Insurer",
      insurance_company_id: "company-1",
      status: "approved",
      approved_amount: 100,
      estimated_amount: 100,
      created_at: "2026-08-01T00:00:00Z",
    } as any;
    const invoice = {
      id: "invoice-1",
      claim_id: "claim-1",
      insurance_company_id: "company-1",
      invoice_number: "INV-1",
      subtotal: 100,
      vat: 5,
      total: 105,
      paid_amount: 105,
      status: "issued",
      invoice_date: "2026-08-02",
      issued_at: "2026-08-02T00:00:00Z",
      created_at: "2026-08-02T00:00:00Z",
    } as any;
    const payment = (status: "pending" | "cleared") => ({
      claim_id: "claim-1",
      amount: 105,
      status,
    }) as any;

    const pendingRows = buildInsuranceCollectionRows({
      claims: [claim], invoices: [invoice], payments: [payment("pending")],
      companyId: "company-1", pendingCollectionOnly: false,
    });
    expect(pendingRows[0].paidAmount).toBe(0);
    expect(pendingRows[0].remainingAmount).toBe(105);
    expect(filterInsuranceCollectionRows(pendingRows, "pending_collection")).toHaveLength(1);

    const clearedRows = buildInsuranceCollectionRows({
      claims: [claim], invoices: [invoice], payments: [payment("cleared")],
      companyId: "company-1", pendingCollectionOnly: false,
    });
    expect(clearedRows[0].paidAmount).toBe(105);
    expect(clearedRows[0].remainingAmount).toBe(0);
    expect(filterInsuranceCollectionRows(clearedRows, "pending_collection")).toHaveLength(0);
  });

  it("does not create receivables from pending or rejected estimates", () => {
    const claim = (id: string, status: string, approvedAmount: number) => ({
      id,
      tenant_id: "tenant-1",
      claim_number: id,
      insurance_company: "Insurer",
      insurance_company_id: "company-1",
      status,
      approved_amount: approvedAmount,
      estimated_amount: approvedAmount,
      created_at: "2026-08-01T00:00:00Z",
    }) as any;

    const rows = buildInsuranceCollectionRows({
      claims: [
        claim("pending", "pending", 500),
        claim("rejected", "rejected", 700),
        claim("approved", "approved", 100),
        claim("cancelled", "cancelled", 900),
      ],
      invoices: [],
      payments: [],
      companyId: "company-1",
      pendingCollectionOnly: false,
    });

    expect(rows.map((item) => item.claimId)).toEqual(["approved", "pending", "rejected"]);
    expect(rows.find((item) => item.claimId === "pending")?.totalIncludingVat).toBe(0);
    expect(rows.find((item) => item.claimId === "rejected")?.totalIncludingVat).toBe(0);
    expect(rows.find((item) => item.claimId === "approved")?.totalIncludingVat).toBe(105);
    expect(filterInsuranceCollectionRows(rows, "pending_collection")).toHaveLength(0);
  });

  it("uses one financial eligibility rule throughout the company page", () => {
    const page = readFileSync("src/pages/insurance/InsuranceCompanyDetail.tsx", "utf8");
    expect(page).toContain("isInsuranceClaimReceivableEligible");
    expect(page).toContain("getInsuranceClaimOperationalStatus");
    expect(page).toContain("payments={financialPayments}");
    expect(page).toContain("const statementClaims = useMemo");
    expect(page).toContain("collectionRowByClaimId.get(c.id)?.approvedBeforeVat ?? 0");
    expect(page).not.toContain('p.status !== "bounced"');
  });

  it("labels the filter by its actual invoice-based rule", () => {
    const page = readFileSync("src/pages/insurance/InsuranceCompanyDetail.tsx", "utf8");
    expect(page).toContain("فواتير صادرة وبانتظار التحصيل");
    expect(page).toContain("isCollectedInsurancePayment");
    expect(page).not.toContain('<SelectItem value="pending_collection">مكتملة وبانتظار التحصيل</SelectItem>');
  });

  it("does not classify a real collection number allocated to several claims as a duplicate", () => {
    const page = readFileSync("src/pages/insurance/InsuranceCompanyDetail.tsx", "utf8");
    expect(page).toContain("const sharedPaymentNumbers");
    expect(page).toContain("claimIds.size > 1");
    expect(page).toContain("const issues = dupInvoicesByClaim.length + dupPaymentSignature.length");
    expect(page).not.toContain("dupInvoicesByClaim.length + dupPaymentNumbers.length");
    expect(page).toContain("(p.payment_number || \"\").trim()");
  });
});
