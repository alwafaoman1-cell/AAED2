// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { resolveVehicleIntakePresentation } from "@/lib/vehicleIntakePresentation";
import { buildVehicleEntryHtml } from "@/lib/vehicleEntryService";
import { buildIntakeReceiptHtml, type IntakeReceiptDocument } from "@/lib/vehicleIntakeReceipt";

vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => "data:image/png;base64,TESTQR") } }));

function record(location?: string, mileage?: unknown): IntakeReceiptDocument {
  return {
    revision: 2,
    receipt: { id: "receipt", revision: 2, receipt_number: "VIR-ENT-1-R2", verification_token: "opaque-token", issued_at: "2026-11-16T08:00:00Z", issued_by: "staff", status: "issued", signer_name: "Frozen deliverer" },
    entry: {
      id: "visit", entry_number: "ENT-1", intake_revision: 2,
      arrival_date: "2026-11-16", arrival_time: "12:00:00",
      vehicle_location: location, vehicle_location_bay: "Bay 2",
      vehicle_snapshot: { make: "Saved vehicle", plate_number: "123", mileage },
      // An attached current vehicle must not fill or override frozen evidence.
      vehicle: { mileage: "99999999" },
      vehicle_condition: {}, vehicle_contents: {},
      delivered_by: { full_name: "Frozen deliverer", id_number: "FROZEN-ID" },
      vehicle_entry_signatures: [{ id: "signature", signature_role: "delivered_by", intake_revision: 2, signer_name: "Frozen deliverer", signature_data_url: "data:image/png;base64,FROZENINK", signed_at: "2026-11-16T08:00:00Z" }],
      custody_print_settings: { companyName: "شركة اختبار", companyNameEn: "Test workshop" },
    },
  };
}

function fields(html: string, label: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return Array.from(doc.querySelectorAll(".thin-table td, .vir-field"))
    .filter((node) => node.querySelector("span")?.textContent === label)
    .map((node) => node.querySelector("strong")?.textContent);
}

describe("saved intake presentation", () => {
  it.each([0, "0"])("preserves recorded zero %j ahead of review and current-vehicle values", (mileage) => {
    const saved = record("داخل الورشة", mileage).entry;
    saved.vehicle_condition.review_return = { mileage: 5400 };
    expect(resolveVehicleIntakePresentation(saved, "en")).toEqual({ odometer: "0", locationAtIntake: "In workshop / Bay 2" });
  });

  it.each([undefined, null, "", "   "])("uses only the same-record review reading when snapshot mileage is %j", (mileage) => {
    const saved = record("مع العميل", mileage).entry;
    saved.vehicle_condition.review_return = { mileage: 7250 };
    expect(resolveVehicleIntakePresentation(saved, "en")).toEqual({ odometer: "7250", locationAtIntake: "With customer" });
  });

  it("does not reconstruct an old missing reading or custody location from a current vehicle, bay or delivery stage", () => {
    const saved = record().entry;
    saved.work_order = { vehicle_presence_status: "in_workshop", delivered_at: "2026-11-17T08:00:00Z" };
    expect(resolveVehicleIntakePresentation(saved, "en")).toEqual({ odometer: "Not recorded", locationAtIntake: "Not recorded" });
    expect(resolveVehicleIntakePresentation(saved, "ar")).toEqual({ odometer: "غير موثّق", locationAtIntake: "غير موثّق" });
  });

  it("displays saved digits without parsing away zeros or changing the original record", () => {
    const saved = record("in_workshop", "٠٠۰٥٤").entry;
    const before = JSON.stringify(saved);
    expect(resolveVehicleIntakePresentation(saved, "ar")).toEqual({ odometer: "00054", locationAtIntake: "داخل الورشة / Bay 2" });
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("does not assign an unknown recorded place to either custody category", () => {
    const saved = record("Recorded inspection yard", 12).entry;
    expect(resolveVehicleIntakePresentation(saved, "en").locationAtIntake).toBe("Recorded inspection yard");
  });
});

describe("intake paper and custody receipt agreement", () => {
  it.each([
    ["en", "داخل الورشة", "In workshop / Bay 2"],
    ["en", "مع العميل", "With customer"],
    ["ar", "داخل الورشة", "داخل الورشة / Bay 2"],
    ["ar", "مع العميل", "مع العميل"],
  ] as const)("prints the same zero reading and frozen location in %s for %s", async (language, location, expectedLocation) => {
    const saved = record(location, 0);
    const before = JSON.stringify(saved);
    const odometerLabel = language === "en" ? "Odometer (km)" : "قراءة العداد (كم)";
    const locationLabel = language === "en" ? "Vehicle location at intake" : "موقع المركبة عند الدخول";
    const paper = buildVehicleEntryHtml(saved.entry, language);
    const receipt = await buildIntakeReceiptHtml(saved, language);
    const combined = await buildIntakeReceiptHtml(saved, language, true);
    for (const html of [paper, receipt]) {
      expect(fields(html, odometerLabel)).toEqual(["0"]);
      expect(fields(html, locationLabel)).toEqual([expectedLocation]);
      expect(html).toContain("FROZENINK");
      expect(html).not.toContain("99999999");
    }
    expect(fields(combined, odometerLabel)).toEqual(["0", "0"]);
    expect(fields(combined, locationLabel)).toEqual([expectedLocation, expectedLocation]);
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("leaves missing historical odometer/location explicit on both documents without altering the saved signature", async () => {
    const saved = record();
    const before = JSON.stringify(saved);
    const paper = buildVehicleEntryHtml(saved.entry, "en");
    const receipt = await buildIntakeReceiptHtml(saved, "en");
    for (const html of [paper, receipt]) {
      expect(fields(html, "Odometer (km)")).toEqual(["Not recorded"]);
      expect(fields(html, "Vehicle location at intake")).toEqual(["Not recorded"]);
      expect(html).not.toMatch(/99999999|In workshop|With customer|Bay 2/);
      expect(html).toContain("FROZENINK");
    }
    expect(JSON.stringify(saved)).toBe(before);
  });

  it("uses a frozen review odometer on both forms and escapes a recorded workshop bay", async () => {
    const saved = record("داخل الورشة", "");
    saved.entry.vehicle_condition.review_return = { mileage: 6300 };
    saved.entry.vehicle_location_bay = '<script>saved bay</script>';
    for (const html of [buildVehicleEntryHtml(saved.entry, "en"), await buildIntakeReceiptHtml(saved, "en")]) {
      expect(fields(html, "Odometer (km)")).toEqual(["6300"]);
      expect(fields(html, "Vehicle location at intake")).toEqual(['In workshop / <script>saved bay</script>']);
      expect(new DOMParser().parseFromString(html, "text/html").querySelector("script")).toBeNull();
    }
  });
});
