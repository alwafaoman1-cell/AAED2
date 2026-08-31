import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildInsuranceInvoiceReportRows,
  filterAndSortInsuranceInvoiceRows,
  INSURANCE_INVOICE_REPORT_COLUMNS,
} from "@/lib/insuranceInvoiceReport";

const invoice = (patch: Record<string, unknown> = {}) => ({
  id: "invoice-1",
  tenant_id: "tenant-1",
  claim_id: "claim-1",
  invoice_number: "INV-2026-001",
  insurance_company_id: "company-1",
  insurance_company_name: "Dhofar Insurance",
  vehicle_make: "BYD",
  vehicle_model: "Song Plus",
  vehicle_plate: "47782",
  subtotal: 100,
  vat: 5,
  total: 105,
  paid_amount: 0,
  status: "issued",
  pdf_url: null,
  invoice_date: "2026-08-10",
  issued_at: "2026-08-10T10:00:00Z",
  last_payment_date: null,
  due_date: "2026-08-30",
  notes: "Repair invoice",
  lpo_number: "LPO-77",
  items: [{ description: "Labour", quantity: 1, unit_price: 100 }],
  created_at: "2026-08-10T10:00:00Z",
  updated_at: "2026-08-10T10:00:00Z",
  ...patch,
}) as any;

const claim = (patch: Record<string, unknown> = {}) => ({
  id: "claim-1",
  claim_number: "CLM-77",
  policy_number: "POL-9",
  vehicle_owner_name: "Customer One",
  customer: { name: "Customer One" },
  vehicle: {
    plate_number: "47782",
    plate_letters: "B",
    plate_country: "OM",
    brand: "BYD",
    model: "Song Plus",
    year: 2026,
    vin_number: "VIN-77",
  },
  ...patch,
}) as any;

const baseFilters = {
  search: "",
  company: "all",
  collectionStatus: "all",
  invoiceStatus: "all",
  dateFrom: "",
  dateTo: "",
  dueState: "all",
  lpoState: "all",
  amountMin: "",
  amountMax: "",
};

describe("insurance accounting invoice Excel and filters", () => {
  it("builds claim, vehicle, LPO, VAT and collection fields from invoice SSOT", () => {
    const [row] = buildInsuranceInvoiceReportRows([invoice()], [claim()]);
    expect(row).toMatchObject({
      invoiceNumber: "INV-2026-001",
      claimNumber: "CLM-77",
      lpoNumber: "LPO-77",
      plateNumber: "B 47782 OM",
      subtotal: 100,
      vat: 5,
      total: 105,
      remainingAmount: 105,
      collectionStatus: "unpaid",
    });
  });

  it("derives unpaid, partial and paid from actual amounts", () => {
    const rows = buildInsuranceInvoiceReportRows([
      invoice(),
      invoice({ id: "invoice-2", paid_amount: 50 }),
      invoice({ id: "invoice-3", paid_amount: 105 }),
    ], [claim()]);
    expect(rows.map((row) => row.collectionStatus)).toEqual(["unpaid", "partial", "paid"]);
  });

  it("applies company, collection, LPO, range and full-text filters before sorting", () => {
    const rows = buildInsuranceInvoiceReportRows([
      invoice(),
      invoice({ id: "invoice-2", invoice_number: "INV-2", insurance_company_name: "Other", lpo_number: null, total: 200, paid_amount: 50 }),
    ], [claim()]);
    const result = filterAndSortInsuranceInvoiceRows(rows, {
      ...baseFilters,
      company: "Dhofar Insurance",
      collectionStatus: "unpaid",
      lpoState: "with",
      amountMin: "100",
      amountMax: "110",
      search: "CLM-77",
    }, "invoiceDate", "desc", "2026-08-31");
    expect(result.map((row) => row.invoiceId)).toEqual(["invoice-1"]);
  });

  it("keeps all business columns selectable and exports the filtered set, not the page", () => {
    const page = readFileSync("src/pages/insurance/InsuranceAccounting.tsx", "utf8");
    const keys = INSURANCE_INVOICE_REPORT_COLUMNS.map((column) => column.key);
    expect(keys).toEqual(expect.arrayContaining([
      "claimNumber", "plateNumber", "invoiceDate", "lpoNumber", "subtotal", "vat", "total",
      "invoiceNumber", "insuranceCompany", "paidAmount", "remainingAmount", "collectionStatusLabel",
    ]));
    expect(page).toContain("exportInsuranceInvoiceRowsToXlsx(\n        filteredRows,");
    expect(page).not.toContain("exportInsuranceInvoiceRowsToXlsx(\n        paginatedRows,");
    expect(page).toContain("أعمدة الجدول وExcel");
  });
});
