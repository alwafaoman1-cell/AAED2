// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { buildVehicleEntryLabelSheetHtml, printVehicleEntryLabelSheets, vehicleEntryLabelPath, vehicleEntryLabelOrderNumber } from "@/lib/vehicleEntryLabelSheet";

const qr = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
vi.mock("qrcode", () => ({ default: { toDataURL: vi.fn(async () => qr) } }));
const entry = (i = 0) => ({ id: `entry-${i}`, entry_number: `ENT-2026-${i}`, vehicle: { plate_number: "1620", plate_letters: "RW", brand: "Dodge", model: "Ram" },
  customer: { name: "PRIVATE CUSTOMER", phone: "99999999" }, amount: 1234, work_order: { order_number: "WO-I-26-0113" } });

describe("six staff-only vehicle cards per A4 sheet", () => {
  it("prints only confirmed order references and makes unresolved candidates visible", () => {
    const e = { ...entry(), tenant_id: "t", vehicle_id: "v", work_order_id: "o", work_order: { id: "o", tenant_id: "t", vehicle_id: "v", work_order_type: "general_customer", order_number: "WO-C-26-0001" } };
    expect(vehicleEntryLabelOrderNumber(e)).toBe("WO-C-26-0001");
    const conflict = { ...e, work_order: { ...e.work_order, vehicle_id: "another" } };
    const html = buildVehicleEntryLabelSheetHtml([{ entry: conflict, qrDataUrl: qr }], "en");
    expect(html).not.toContain("WO-C-26-0001");expect(html).toContain("Link requires review");
    expect(vehicleEntryLabelOrderNumber({ ...e, __inferredOrderLink: true })).toBe("");
  });
  it("rejects duplicate visit cards even when a renderer is called directly", () => {
    expect(() => buildVehicleEntryLabelSheetHtml([{ entry: entry(), qrDataUrl: qr }, { entry: entry(), qrDataUrl: qr }], "en")).toThrow("DUPLICATE");
  });
  it.each([1, 6, 7, 12, 13])("paginates %s cards without an extra blank sheet", (count) => {
    const html = buildVehicleEntryLabelSheetHtml(Array.from({ length: count }, (_, i) => ({ entry: entry(i), qrDataUrl: qr })), "ar");
    const doc = new DOMParser().parseFromString(html, "text/html");
    const sheets = [...doc.querySelectorAll(".label-sheet")];
    expect(sheets).toHaveLength(Math.ceil(count / 6));
    expect(sheets.every((s) => s.children.length > 0 && s.children.length <= 6)).toBe(true);
    expect(doc.querySelectorAll(".vehicle-label")).toHaveLength(count);
    expect(html).toContain("size:A4 portrait");
    expect(html).not.toContain("PRIVATE CUSTOMER"); expect(html).not.toContain("99999999");
    expect(html).not.toContain("1234");
  });
  it("escapes business data and unsafe QR URLs, and keeps English output English-only", () => {
    const e = { ...entry(), vehicle: { plate_letters: "<script>alert(1)</script>", plate_number: "42" } };
    const html = buildVehicleEntryLabelSheetHtml([{ entry: e, qrDataUrl: qr }], "en", true);
    expect(html).toContain('lang="en" dir="ltr"');expect(html).toContain("&lt;script&gt;");
    expect(html).not.toMatch(/[\u0600-\u06ff]/);expect(html).not.toContain("<script>");
    expect(() => buildVehicleEntryLabelSheetHtml([{ entry: e, qrDataUrl: "javascript:alert(1)" }], "en")).toThrow("INVALID_QR");
  });
  it("does not invent an entry or public tracking URL for a claim-only card", () => {
    expect(vehicleEntryLabelPath({ id: "claim:c", _claimOnly: true, claim: { id: "c" } })).toBe("/insurance/c");
    expect(vehicleEntryLabelPath(entry())).toBe("/vehicle-entry/entry-0");
    expect(() => vehicleEntryLabelPath({ id: "claim:c" })).toThrow("UNSAVED");
    expect(() => buildVehicleEntryLabelSheetHtml([], "en")).toThrow("EMPTY");
  });
  it("opens the preview before cloud reads and never prints an incomplete batch", async () => {
    const print = vi.fn(), close = vi.fn(), write = vi.fn();
    const popup = { opener: window, closed: false, close, print, focus: vi.fn(), document: { body: { textContent: "" }, images: [], fonts: { ready: Promise.resolve() }, open: vi.fn(), write, close: vi.fn() } };
    const open = vi.spyOn(window, "open").mockReturnValue(popup as unknown as Window);
    const read = vi.fn(async () => { expect(open).toHaveBeenCalled();return [entry(), entry(1)]; });
    await printVehicleEntryLabelSheets(read, "en", "Loading");
    expect(print).toHaveBeenCalledTimes(1);expect(write).toHaveBeenCalledTimes(1);expect(popup.opener).toBeNull();
    print.mockClear();write.mockClear();
    await expect(printVehicleEntryLabelSheets(async () => { throw new Error("offline"); }, "en", "Loading")).rejects.toThrow("offline");
    expect(close).toHaveBeenCalled();expect(print).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
    open.mockRestore();
  });
  it("does not start reads if popups are blocked", async () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);const read = vi.fn();
    await expect(printVehicleEntryLabelSheets(read, "en", "Loading")).rejects.toThrow("POPUP_BLOCKED");
    expect(read).not.toHaveBeenCalled();open.mockRestore();
  });
});
