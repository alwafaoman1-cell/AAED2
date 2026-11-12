// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,TESTQR") } }));
vi.mock("@/lib/vehicleEntryService", () => ({ buildVehicleEntryHtml: (entry: any, language: string) => `<html lang="${language}"><head></head><body><main class="page">${entry.entry_number}</main></body></html>` }));
import { buildIntakeReceiptHtml, intakeReceiptReference, intakeReceiptVerifyUrl, type IntakeReceiptDocument } from "@/lib/vehicleIntakeReceipt";
const document = {
  revision: 2, receipt: { id: "receipt", receipt_number: "VIR-ENT-2026-1-R2", verification_token: "opaque-token", issued_at: "2026-11-12T09:00:00Z", issued_by: "staff", status: "issued", signer_name: "Actual signer" },
  entry: { id: "visit", entry_number: "ENT-2026-1", arrival_date: "2026-11-11", arrival_time: "08:00", received_by_name: "Receiving staff", vehicle_snapshot: { make: "Test car", vin: "VIN-ONLY-IN-STAFF-DOCUMENT", plate_number: "123", plate_letters: "AB", plate_country: "OM" }, delivered_by: { full_name: "Other person", phone: "PRIVATE-PHONE", id_number: "PRIVATE-ID" }, vehicle_entry_signatures: [{ signature_role: "delivered_by", signer_name: "Actual signer", signature_data_url: "data:image/png;base64,ORIGINALSIGNATURE", signed_at: "2026-11-12T09:01:02Z" }], custody_print_settings: { companyName: "اسم الشركة", companyNameEn: "Test company" } },
} as unknown as IntakeReceiptDocument;
describe("vehicle intake receipt evidence and verification", () => {
  it("encodes only an opaque credential and visit reference in the QR", () => {
    const url = intakeReceiptVerifyUrl("visit", "opaque-token", "https://workshop.example");
    expect(intakeReceiptReference(url, "visit")).toBe("opaque-token");
    expect(url).not.toMatch(/PRIVATE|VIN|signer/);
    expect(() => intakeReceiptReference(url, "other-visit")).toThrow();
    expect(() => intakeReceiptReference("https://workshop.example/p/token", "visit")).toThrow();
    expect(intakeReceiptReference(" VIR-ENT-1-R2 ")).toBe("VIR-ENT-1-R2");
  });
  it("keeps the actual signer and same signature, not another person's contact details", async () => {
    const html = await buildIntakeReceiptHtml(document, "en");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.body.textContent).toContain("Actual signer");
    expect(html).toContain("ORIGINALSIGNATURE");
    expect(parsed.querySelectorAll(".page")).toHaveLength(1);
    expect(parsed.querySelector(".vir-receipt")?.closest(".page")).toBeTruthy();
    expect(parsed.body.textContent).toContain("12/11/2026, 13:01:02");
    expect(html).not.toMatch(/PRIVATE-PHONE|PRIVATE-ID|اسم الشركة/);
    expect(parsed.body.textContent).not.toMatch(/[\u0600-\u06ff]/);
  });
  it("escapes user data and preserves the frozen entry in combined exports", async () => {
    const changed = structuredClone(document); changed.entry.received_by_name = '<script>bad()</script>';
    const html = await buildIntakeReceiptHtml(changed, "en", true);
    expect(html).toContain('class="vir-combined"');
    expect(html).toContain("ENT-2026-1");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("ORIGINALSIGNATURE");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    expect(parsed.querySelectorAll(".page")).toHaveLength(2);
    expect(parsed.querySelector(".vir-receipt")?.closest(".page")).toBeTruthy();
  });
  it("renders Arabic direction and company details independently of English", async () => {
    const html = await buildIntakeReceiptHtml(document, "ar");
    expect(html).toContain('dir="rtl"'); expect(html).toContain("وصل استلام مركبة"); expect(html).toContain("اسم الشركة");
  });
});
