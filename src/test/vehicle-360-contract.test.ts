import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildVehicleTimeline, calculateVehicleFinancials } from "@/lib/vehicle360";

const read = (path: string) => readFileSync(path, "utf8");

describe("vehicle 360 cloud record", () => {
  it("uses a single vehicle-scoped query key and does not poll or clear global caches", () => {
    const page = read("src/pages/VehicleDetail.tsx");
    expect(page).toContain("queryKeys.vehicle360.detail");
    expect(page).toContain("fetchVehicle360Snapshot");
    expect(page).toContain("refetchOnWindowFocus: false");
    expect(page).not.toContain("setInterval(");
    expect(page).not.toContain("qc.clear()");
    expect(page).not.toContain("caches.delete");
  });

  it("loads every operational and financial source by tenant and vehicle links", () => {
    const service = read("src/lib/vehicle360.ts");
    for (const table of [
      "job_orders", "insurance_claims", "vehicle_entries", "vehicle_handover_records",
      "expenses", "job_order_parts", "sales_documents", "insurance_invoices",
      "sales_payments", "claim_payments", "vehicle_media", "claim_audit_logs",
    ]) expect(service).toContain(`from("${table}`);
    expect(service).toContain('.eq("tenant_id", tenantId)');
    expect(service).toContain('.eq("vehicle_id", vehicleId)');
  });

  it("keeps the vehicle route on one tenant-filtered realtime channel", () => {
    const realtime = read("src/hooks/useRealtimeSync.ts");
    expect(realtime).toContain('scope: "vehicle_detail"');
    expect(realtime).toContain('filter: `tenant_id=eq.${profile.tenant_id}`');
    expect(realtime).toContain('"vehicle_360"');
  });

  it("calculates collections only from actual payment rows and separates cash from insurance", () => {
    const financial = calculateVehicleFinancials({
      cashInvoices: [{ id: "cash", total: 100, status: "issued" }],
      insuranceInvoices: [{ id: "insurance", total: 200, status: "issued" }],
      cashPayments: [{ id: "cp", amount: 40 }],
      insurancePayments: [{ id: "ip1", amount: 80, status: "cleared" }, { id: "ip2", amount: 60, status: "pending" }],
      expenses: [{ id: "e1", total: 50, category_name: "Spare Parts", status: "paid" }, { id: "e2", total: 10, category_name: "Other", status: "paid" }],
    } as any);
    expect(financial.cashBilled).toBe(100);
    expect(financial.insuranceBilled).toBe(200);
    expect(financial.cashCollected).toBe(40);
    expect(financial.insuranceCollected).toBe(80);
    expect(financial.expenses).toBe(60);
    expect(financial.partsExpenses).toBe(50);
    expect(financial.invoiceMargin).toBe(240);
    expect(financial.cashflowMargin).toBe(60);
  });

  it("builds a dated timeline across entry, work, claim, finance, media and delivery", () => {
    const timeline = buildVehicleTimeline({
      vehicleId: "v1",
      entries: [{ id: "entry", entry_number: "ENT-1", arrival_date: "2026-01-01", arrival_time: "09:00" }],
      workOrders: [{ id: "wo", order_number: "WO-1", created_at: "2026-01-02", entry_date: "2026-01-02", status: "in_progress" }],
      claims: [{ id: "claim", claim_number: "C-1", created_at: "2026-01-03", status: "approved" }],
      handovers: [{ id: "handover", status: "finalized", finalized_at: "2026-01-08" }],
      expenses: [{ id: "expense", voucher_number: "PV-1", date: "2026-01-04", total: 20 }],
      parts: [{ id: "part", created_at: "2026-01-05", quantity: 1, unit_price: 10 }],
      cashInvoices: [{ id: "invoice", doc_number: "INV-1", issued_at: "2026-01-06", total: 100 }],
      insuranceInvoices: [], cashPayments: [{ id: "payment", sales_document_id: "invoice", date: "2026-01-07", amount: 100 }], insurancePayments: [],
      media: [{ id: "media", uploaded_at: "2026-01-05", media_type: "image", category: "entry" }],
      auditLogs: [], tracking: { count: 0, lastOpenedAt: null },
    } as any);
    expect(new Set(timeline.map((row) => row.category))).toEqual(new Set(["entry", "work_order", "claim", "delivery", "expense", "parts", "invoice", "payment", "media"]));
    expect(timeline[0].category).toBe("delivery");
  });
});
