import { getVehicleEntryVisitPurpose } from "@/lib/vehicleEntryService";

function escapeHtml(value: unknown): string {
  return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Internal workshop label. Never include the public customer QR or private contact details. */
export function buildVehicleEntryStickerHtml(entry: any, qrDataUrl: string, language: "ar" | "en"): string {
  const isAr = language === "ar";
  const vehicle = entry.vehicle || entry.vehicle_snapshot || {};
  const plate = [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—";
  const order = entry.work_order?.order_number || entry.converted_work_order?.order_number || "";
  const purpose = getVehicleEntryVisitPurpose(entry);
  const purposeText = purpose === "inspection"
    ? isAr ? "فحص ومعاينة" : "Inspection"
    : isAr ? "داخل الورشة" : "In workshop";
  const title = isAr ? "كرت المركبة الداخلي" : "Internal vehicle label";
  const workOrderLabel = isAr ? "أمر العمل" : "Work order";
  const entryLabel = isAr ? "رقم الدخول" : "Entry number";
  const testMark = typeof window !== "undefined" && window.location.hostname !== "aaed-2.vercel.app"
    ? `<div class="test-mark">TEST / تجربة</div>` : "";

  return `<!doctype html><html lang="${language}" dir="${isAr ? "rtl" : "ltr"}"><head><meta charset="utf-8"/>
    <title>${escapeHtml(entry.entry_number || title)}</title><style>
    @page{size:60mm 40mm;margin:0}
    *{box-sizing:border-box}html,body{margin:0;padding:0;color:#111;background:#fff;font-family:Arial,Tahoma,sans-serif}
    .label{position:relative;width:60mm;height:40mm;border:1px solid #111;padding:2.1mm;display:grid;grid-template-columns:1fr 16mm;gap:1.5mm;overflow:hidden}
    .heading{font-size:7.5pt;font-weight:700;border-bottom:1px solid #333;padding-bottom:1mm}
    .entry{font-family:Arial,sans-serif;font-weight:900;font-size:12pt;direction:ltr;text-align:start;white-space:nowrap;margin:1.2mm 0}
    .plate{font-size:12pt;font-weight:900;white-space:nowrap;direction:ltr;text-align:start}
    .meta{font-size:7pt;margin-top:1mm;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .qr{width:16mm;height:16mm;align-self:start}.qr img{width:100%;height:100%;object-fit:contain}
    .foot{grid-column:1/-1;display:flex;justify-content:space-between;gap:1mm;border-top:1px solid #777;padding-top:.8mm;font-size:6.6pt;white-space:nowrap}
    .test-mark{position:absolute;inset:12mm 2mm auto;transform:rotate(-18deg);font-size:19pt;font-weight:900;opacity:.23;text-align:center;pointer-events:none}
    @media screen{body{padding:8mm;background:#eee}.label{background:#fff;box-shadow:0 2px 8px #bbb}}
    @media print{.label{border:1px solid #111}}
    </style></head><body><main class="label">
      <div><div class="heading">${escapeHtml(title)}</div><div class="entry">${escapeHtml(entry.entry_number || "—")}</div>
      <div class="plate">${escapeHtml(plate)}</div><div class="meta">${escapeHtml(purposeText)}</div></div>
      <div class="qr"><img src="${escapeHtml(qrDataUrl)}" alt="${escapeHtml(entryLabel)} QR"/></div>
      <div class="foot"><span>${escapeHtml([entry.arrival_date, String(entry.arrival_time || "").slice(0, 5)].filter(Boolean).join(" "))}</span><span>${escapeHtml(order ? `${workOrderLabel}: ${order}` : entryLabel)}</span></div>
      ${testMark}
    </main></body></html>`;
}

export async function printVehicleEntrySticker(entry: any, language: "ar" | "en"): Promise<void> {
  if (!entry?.id) throw new Error("Vehicle entry is not saved");
  // Open during the user gesture; browsers block windows opened after the async QR render.
  const popup = window.open("", "_blank", "width=480,height=380");
  if (!popup) throw new Error("The browser blocked the label preview window");
  try {
    popup.opener = null;
    const { default: QRCode } = await import("qrcode");
    const url = new URL(`/vehicle-entry/${encodeURIComponent(entry.id)}`, window.location.origin).toString();
    const qr = await QRCode.toDataURL(url, { width: 300, margin: 1, errorCorrectionLevel: "M" });
    popup.document.open();
    popup.document.write(buildVehicleEntryStickerHtml(entry, qr, language));
    popup.document.close();
    await Promise.all(Array.from(popup.document.images).map((image) => image.complete ? Promise.resolve() : new Promise<void>((resolve) => {
      image.onload = () => resolve();
      image.onerror = () => resolve();
    })));
    await popup.document.fonts?.ready;
    popup.focus();
    popup.print();
  } catch (error) {
    popup.close();
    throw error;
  }
}
