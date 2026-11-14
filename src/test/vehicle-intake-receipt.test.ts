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
  it("prints frozen odometer, running state, full new damage details and an arrival clock without fractions", async () => {
    const changed = structuredClone(document);
    const notes = "Review note without shortening. ".repeat(100) + "\nFinal review note.";
    const damage = "New rear scratch\nCustomer requests a full inspection.";
    changed.entry.vehicle_snapshot.mileage = 0;
    changed.entry.arrival_time = "18:37:42.872092";
    changed.entry.vehicle_condition = { running_status: "not_running", review_return: { source_entry_number: "ENT-OLD", source_handover_number: "VH-OLD", reason: "Noise", arrival_condition: "Not running", notes, new_damage: true, new_damage_notes: damage } };
    const frozen = JSON.stringify(changed.entry);
    const html = await buildIntakeReceiptHtml(changed, "en");
    const parsed = new DOMParser().parseFromString(html, "text/html");
    const value = (label: string) => [...parsed.querySelectorAll(".vir-field")].find(item => item.querySelector("span")?.textContent === label)?.querySelector("strong")?.textContent;
    expect(value("Odometer (km)")).toBe("0");
    expect(value("Running condition")).toBe("Vehicle does not run");
    expect(value("Clear new visible damage")).toBe("Yes");
    expect(value("New visible damage details")).toBe(damage);
    expect(value("Review notes")).toBe(notes);
    expect(value("Arrival date and time")).toBe("2026-11-11 18:37:42");
    expect(html).toContain("ORIGINALSIGNATURE");
    expect(JSON.stringify(changed.entry)).toBe(frozen);
  });
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

it("keeps delivery confirmation separate and hides it until the receipt is used", async () => {
 const changed = structuredClone(document);
 changed.delivery_confirmation = { handover_id: "h", handover_number: "VH-1", recipient_name: "New recipient", delivered_at: "2026-11-14T10:00:00Z", confirmed_at: "2026-11-14T10:01:00Z", delivered_by_name: "Staff", signature_data_url: "data:image/png;base64,DELIVERYSIGNATURE" };
 expect(await buildIntakeReceiptHtml(changed, "en")).not.toContain("DELIVERYSIGNATURE");
 changed.receipt.status = "used";
 changed.entry.vehicle_condition = { review_return: { source_entry_number: "ENT-OLD", source_handover_number: "VH-OLD", reason: "<script>reason</script>", arrival_condition: "Scratch", notes: "Inspect brakes" } };
 const html = await buildIntakeReceiptHtml(changed, "en");
 expect(html).toContain("ORIGINALSIGNATURE"); expect(html).toContain("DELIVERYSIGNATURE");
 expect(html).toContain("ENT-OLD / VH-OLD"); expect(html).toContain("Inspect brakes");
 expect(html).not.toContain("<script>"); expect(html).toContain("&lt;script&gt;");
 expect(new DOMParser().parseFromString(html,"text/html").body.textContent).not.toMatch(/[\u0600-\u06ff]/);
});

it("prints historical review references and new findings without changing the frozen intake", async () => {
 const changed = structuredClone(document);
 changed.entry.vehicle_condition = { review_return: { source_entry_number: "ENT-OLD", source_handover_number: "VH-OLD", reason: "Brake review", arrival_condition: "Running", notes: "Inspect brakes" } };
 changed.review_context = { source_entry_id: "old", source_entry_number: "ENT-OLD", source_handover_id: "h", source_handover_number: "VH-OLD", source_claim_id: "c", source_claim_number: "CLAIM-OLD", source_work_order_id: "o", source_work_order_number: "WO-OLD" };
 changed.receipt.status = "used";
 changed.delivery_confirmation = { handover_id: "new-h", handover_number: "VH-NEW", recipient_name: "New recipient", delivered_at: "2026-11-14T10:00:00Z", confirmed_at: "2026-11-14T10:01:00Z", delivered_by_name: "Staff", signature_data_url: "data:image/png;base64,NEWSIGNATURE", review_notes: "<script>Review findings</script>" };
 const frozen = JSON.stringify(changed.entry);
 const html = await buildIntakeReceiptHtml(changed, "en");
 expect(html).toContain("CLAIM-OLD"); expect(html).toContain("WO-OLD"); expect(html).toContain("Previous work order");
 expect(html).toContain("ORIGINALSIGNATURE"); expect(html).toContain("NEWSIGNATURE");
 expect(html).toContain("&lt;script&gt;Review findings&lt;/script&gt;"); expect(html).not.toContain("<script>");
 expect(JSON.stringify(changed.entry)).toBe(frozen);
});
