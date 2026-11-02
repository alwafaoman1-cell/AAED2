// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildVehicleEntryStickerHtml } from "@/lib/vehicleEntrySticker";

const entry = {
  id: "entry-id",
  entry_number: "ENT-2026-0001",
  arrival_date: "2026-10-20",
  arrival_time: "08:15",
  vehicle_condition: { visit_purpose: "workshop" },
  vehicle: { plate_letters: "RW", plate_number: "1620" },
  customer: { name: "PRIVATE PERSON", phone: "99999999" },
  work_order: { order_number: "WO-I-26-0113" },
};

describe("internal vehicle-entry label", () => {
  it("prints a small visit label with staff-only identity and no customer details", () => {
    const html = buildVehicleEntryStickerHtml(entry, "data:image/png;base64,QUJD", "ar");
    expect(html).toContain("@page{size:60mm 40mm;margin:0}");
    expect(html).toContain("ENT-2026-0001");
    expect(html).toContain("RW 1620");
    expect(html).toContain("WO-I-26-0113");
    expect(html).not.toContain("PRIVATE PERSON");
    expect(html).not.toContain("99999999");
    const source = readFileSync(join(process.cwd(), "src/lib/vehicleEntrySticker.ts"), "utf8");
    expect(source).toContain("/vehicle-entry/${encodeURIComponent(entry.id)}");
    expect(source).not.toContain("/p/");
    expect(source).not.toContain("/track/");
  });

  it("localizes to English and escapes untrusted vehicle data", () => {
    const html = buildVehicleEntryStickerHtml({ ...entry, vehicle: { plate_letters: "<script>", plate_number: "1620" } }, "data:image/png;base64,QUJD", "en");
    expect(html).toContain('lang="en" dir="ltr"');
    expect(html).toContain("Internal vehicle label");
    expect(html).toContain("&lt;script&gt; 1620");
    expect(html).not.toContain("<script>");
  });
});
