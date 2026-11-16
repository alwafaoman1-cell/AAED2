// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildVehicleEntryHtml } from "@/lib/vehicleEntryService";

const entry = (condition: Record<string, unknown>, mileage = 0) => ({
  entry_number: "ENT-TEST-RUNNING",
  arrival_date: "2026-11-14",
  customer_snapshot: { name: "Test owner" },
  vehicle_snapshot: { make: "Toyota", plate_number: "123", plate_letters: "A", mileage },
  vehicle_condition: condition,
});
function cell(html: string, label: string) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("td")].find(item => item.querySelector("span")?.textContent === label)?.querySelector("strong")?.textContent;
}

describe("recorded running condition in intake print", () => {
  it("keeps the frozen technical findings in the combined intake source without arbitrary financial fields", () => {
    const frozen = { ...entry({ running_status: "running" }), vehicle_technical_declaration: {
      id: "frozen-report", revision: 2, form_data: { engine_other_remarks: "TEST frozen technical finding", engine_warning: false, expenses: "SECRET-FINANCIAL-KEY" },
    } };
    const before = JSON.stringify(frozen);
    const html = buildVehicleEntryHtml(frozen, "en");
    expect(html).toContain("TEST frozen technical finding");
    expect(html).not.toContain("SECRET-FINANCIAL-KEY");
    expect(JSON.stringify(frozen)).toBe(before);
  });
  it("prints explicit status, original condition notes and zero mileage in English", () => {
    const html = buildVehicleEntryHtml(entry({ running_status: "not_running", condition_description: "Engine noise recorded" }), "en");
    expect(cell(html, "Running Condition")).toBe("Vehicle does not run");
    expect(cell(html, "Vehicle condition")).toBe("Engine noise recorded");
    expect(cell(html, "Odometer (km)")).toBe("0");
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
  });

  it("keeps historical unknown separate from original free text", () => {
    const html = buildVehicleEntryHtml(entry({ condition_description: "Vehicle was running on arrival" }), "en");
    expect(cell(html, "Running Condition")).toBe("Not recorded / not checked");
    expect(cell(html, "Vehicle condition")).toBe("Vehicle was running on arrival");
  });

  it("prints explicit new damage and its description on the new review intake", () => {
    const notes = "Complete review findings. ".repeat(80) + "\nLast observation is retained.";
    const html = buildVehicleEntryHtml(entry({ running_status: "running", review_return: {
      source_entry_number: "ENT-PREVIOUS", source_handover_number: "HND-PREVIOUS",
      reason: "Review noise", arrival_condition: "Clean exterior", notes,
      new_damage: true, new_damage_notes: "New bumper scratch",
    } }), "en");
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.body.textContent).toContain("Clear new visible damage: Yes New bumper scratch");
    expect(doc.body.textContent).toContain("Review visit after delivery");
    expect(doc.querySelector(".review-return")?.textContent).toContain(notes);
    expect(doc.querySelectorAll(".review-return .review-wide")).toHaveLength(2);
    expect(html).not.toMatch(/[\u0600-\u06ff]/);
  });
});
