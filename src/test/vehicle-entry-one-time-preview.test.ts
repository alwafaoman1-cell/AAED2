import { describe, expect, it, vi } from "vitest";

const printBuilder = vi.hoisted(() => vi.fn((entry: unknown) => {
  void entry;
  return "<!doctype html><html><head></head><body>Vehicle entry print template</body></html>";
}));

vi.mock("@/lib/vehicleEntryService", () => ({ buildVehicleEntryHtml: printBuilder }));

import {
  buildOneTimeEntryPreviewHtml,
  canShowOneTimeEntryPreview,
} from "@/lib/vehicleEntryOneTimePreview";

describe("one-time vehicle entry signature preview", () => {
  it("only opens for the first successful signature carrying a server-issued snapshot", () => {
    const preview_entry = { entry_number: "ENT-2026-0001" };
    expect(canShowOneTimeEntryPreview({ ok: true, signed_at: "2026-10-21T06:00:00Z", preview_entry })).toBe(true);
    expect(canShowOneTimeEntryPreview({ ok: true, already_signed: true, signed_at: "2026-10-21T06:00:00Z", preview_entry })).toBe(false);
    expect(canShowOneTimeEntryPreview({ ok: true, already_signed: true })).toBe(false);
    expect(canShowOneTimeEntryPreview({ ok: true, signed_at: "2026-10-21T06:00:00Z" })).toBe(false);
    expect(canShowOneTimeEntryPreview({ ok: false, signed_at: "2026-10-21T06:00:00Z", preview_entry })).toBe(false);
  });

  it("uses the existing print template with the just-saved signature and the same entry photos", () => {
    const html = buildOneTimeEntryPreviewHtml(
      { entry_number: "ENT-2026-0001", receiver_signature_data_url: "data:image/png;base64,receiver" },
      [{ id: "photo-1", url: "https://example.com/signed-photo", category: "front_view" }],
      "data:image/png;base64,customer",
    );
    const entry = printBuilder.mock.lastCall?.[0] as {
      vehicle_entry_signatures: Array<{ signature_role: string; signature_data_url: string }>;
      vehicle_media: Array<{ media_type: string; category: string; url: string }>;
    };
    expect(entry.vehicle_entry_signatures).toEqual([
      { signature_role: "delivered_by", signature_data_url: "data:image/png;base64,customer" },
      { signature_role: "receiver", signature_data_url: "data:image/png;base64,receiver" },
    ]);
    expect(entry.vehicle_media).toMatchObject([{ media_type: "image", category: "front_view", url: "https://example.com/signed-photo" }]);
    expect(html).toContain("Vehicle entry print template");
    expect(html).toContain("@media print{html,body{display:none!important}}");
  });
});
