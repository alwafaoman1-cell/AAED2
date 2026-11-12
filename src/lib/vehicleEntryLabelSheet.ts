import { escapeHtml, safePdfImageSrc, sanitizePdfHtml } from "@/lib/safeHtml";
import { vehicleEntryArrivalTime } from "@/lib/vehicleEntryArrival";
import { isVehicleVisitAwaitingArrival } from "@/lib/vehicleVisitIntake";
import { hasConfirmedVehicleEntryWorkOrderLink } from "@/lib/vehicleEntryWorkOrderLink";

export const VEHICLE_LABELS_PER_SHEET = 6;
export type VehicleLabel = { entry: any; qrDataUrl: string };

/** Do not turn a historical candidate/conflicting order into a printed fact. */
export function vehicleEntryLabelOrderNumber(entry: any): string {
  const order = entry.work_order || entry.converted_work_order;
  if (!order || entry.__inferredOrderLink) return "";
  if (!entry._claimOnly) return hasConfirmedVehicleEntryWorkOrderLink(entry, order) ? order.order_number || "" : "";
  const claim = entry.claim || entry.converted_claim;
  return claim?.id && claim.vehicle_id && claim.vehicle_id === entry.vehicle_id && order.vehicle_id === entry.vehicle_id
    && claim.tenant_id === entry.tenant_id && order.tenant_id === entry.tenant_id
    && order.claim_id === claim.id && order.work_order_type === "insurance" && !order.deleted_at
    && [claim.job_order_id, claim.auto_job_order_id].includes(order.id) ? order.order_number || "" : "";
}

/** Authenticated staff routes only. A legacy claim is not a fabricated intake. */
export function vehicleEntryLabelPath(entry: any): string {
  if (entry?._claimOnly && entry.claim?.id) return `/insurance/${encodeURIComponent(entry.claim.id)}`;
  if (!entry?.id || entry._claimOnly || String(entry.id).startsWith("claim:")) throw new Error("VEHICLE_LABEL_UNSAVED");
  return `/vehicle-entry/${encodeURIComponent(entry.id)}`;
}

export function buildVehicleEntryLabelSheetHtml(labels: VehicleLabel[], language: "ar" | "en", test = false): string {
  if (!labels.length) throw new Error("VEHICLE_LABEL_EMPTY");
  const ar = language === "ar";
  const title = ar ? "كرت المركبة الداخلي" : "Internal vehicle card";
  const t = (arabic: string, english: string) => ar ? arabic : english;
  const paths = new Set<string>();
  const cards = labels.map(({ entry, qrDataUrl }) => {
    const path = vehicleEntryLabelPath(entry);
    if (paths.has(path)) throw new Error("VEHICLE_LABEL_DUPLICATE");
    paths.add(path);
    // Retain the established staff-only card boundary. Never include contacts,
    // customer names, amounts, public QR tokens or original vehicle photos.
    const vehicle = entry.vehicle || entry.vehicle_snapshot || {};
    const identity = entry.entry_number || entry.claim?.claim_number || "—";
    const vehicleText = [vehicle.brand || vehicle.make, vehicle.model, vehicle.year].filter(Boolean).join(" ") || "—";
    const plate = [vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ") || "—";
    const src = safePdfImageSrc(qrDataUrl);
    if (!src) throw new Error("VEHICLE_LABEL_INVALID_QR");
    const qr = `<div class="qr"><img src="${src}" alt="QR"></div>`;
    const confirmedOrder = vehicleEntryLabelOrderNumber(entry);
    const order = confirmedOrder || "—";
    const needsReview = (entry._reviewReason && entry._reviewReason !== "claim_without_entry")
      || ((entry.work_order || entry.converted_work_order) && !confirmedOrder);
    const claim = entry.claim?.claim_number || entry.converted_claim?.claim_number || entry.insurance_snapshot?.claim_number || "—";
    const date = [entry.arrival_date, vehicleEntryArrivalTime(entry, language)].filter(Boolean).join(" ") || "—";
    const dateLabel = entry._claimOnly ? t("تاريخ التسجيل", "Registered") : isVehicleVisitAwaitingArrival(entry) ? t("تاريخ النموذج", "Form date") : t("الدخول", "Arrival");
    return `<article class="vehicle-label"><h2>${escapeHtml(title)}</h2><div class="identity" dir="ltr">${escapeHtml(identity)}</div>
      ${entry._claimOnly ? `<p class="legacy">${t("مطالبة بلا كرت دخول", "Claim without intake receipt")}</p>` : ""}
      ${needsReview ? `<p class="legacy">${t("الربط يحتاج مراجعة", "Link requires review")}</p>` : ""}
      <div class="plate" dir="ltr">${escapeHtml(plate)}</div><div class="vehicle" dir="auto">${escapeHtml(vehicleText)}</div>
      <dl><div><dt>${t("أمر العمل", "Work order")}</dt><dd dir="ltr">${escapeHtml(order)}</dd></div>
      <div><dt>${t("المطالبة", "Claim")}</dt><dd dir="ltr">${escapeHtml(claim)}</dd></div>
      <div><dt>${dateLabel}</dt><dd>${escapeHtml(date)}</dd></div></dl>
      <footer>${qr}<span>${t("للاستخدام الداخلي فقط", "For internal use only")}</span></footer>
      ${test ? `<div class="test-mark">${t("تجربة", "TEST")}</div>` : ""}</article>`;
  });
  const sheets: string[] = [];
  for (let i = 0; i < cards.length; i += VEHICLE_LABELS_PER_SHEET) {
    sheets.push(`<section class="label-sheet">${cards.slice(i, i + VEHICLE_LABELS_PER_SHEET).join("")}</section>`);
  }
  return sanitizePdfHtml(`<!doctype html><html lang="${language}" dir="${ar ? "rtl" : "ltr"}"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <style>@page{size:A4 portrait;margin:0}*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#111;font-family:Arial,Tahoma,sans-serif}
    .label-sheet{width:210mm;height:297mm;padding:10mm;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));grid-template-rows:repeat(3,minmax(0,1fr));gap:4mm;break-after:page;page-break-after:always}
    .label-sheet:last-child{break-after:auto;page-break-after:auto}.vehicle-label{min-width:0;position:relative;padding:4mm;border:.3mm dashed #666;break-inside:avoid;display:flex;flex-direction:column;overflow:hidden}
    h2{margin:0 0 2mm;font-size:12pt;border-bottom:.3mm solid #111;padding-bottom:2mm}.identity{font-size:13pt;font-weight:bold;overflow-wrap:anywhere;text-align:start}
    .plate{font-size:25pt;font-weight:900;text-align:center;margin:2mm 0;line-height:1.1;overflow-wrap:anywhere}.vehicle{font-size:13pt;font-weight:bold;text-align:center;overflow-wrap:anywhere}
    dl{font-size:10pt;margin:3mm 0 1mm}dl div{display:flex;align-items:baseline;gap:2mm;margin-bottom:1mm}dt{flex:none}dd{margin:0;min-width:0;overflow-wrap:anywhere;font-weight:bold}
    footer{margin-top:auto;display:flex;align-items:end;justify-content:space-between;gap:3mm;font-size:9pt}.qr,.qr img{width:20mm;height:20mm;object-fit:contain}.legacy{font-size:9pt;margin:1mm 0}
    .test-mark{position:absolute;inset:40% 0 auto;transform:rotate(-20deg);font-size:40pt;opacity:.12;text-align:center;pointer-events:none}
    @media screen{body{background:#eee}.label-sheet{margin:8mm auto;background:#fff;box-shadow:0 2px 8px #aaa}}
    @media print{.label-sheet{margin:0;box-shadow:none}}</style></head><body>${sheets.join("")}</body></html>`);
}

/** Open within the click, before any async cloud read; never print a partial batch. */
export async function printVehicleEntryLabelSheets(read: () => Promise<any[]>, language: "ar" | "en", loading: string, signal?: AbortSignal): Promise<void> {
  const popup = window.open("", "_blank", "width=900,height=850");
  if (!popup) throw new Error("VEHICLE_LABEL_POPUP_BLOCKED");
  popup.opener = null;
  const cancel = () => popup.close();
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    popup.document.body.textContent = loading;
    const entries = await read();
    if (signal?.aborted || popup.closed) return;
    if (!entries.length) throw new Error("VEHICLE_LABEL_EMPTY");
    const ids = new Set<string>();
    const { default: QRCode } = await import("qrcode");
    const labels: VehicleLabel[] = [];
    for (const entry of entries) {
      if (signal?.aborted || popup.closed) return;
      const path = vehicleEntryLabelPath(entry);
      if (ids.has(path)) throw new Error("VEHICLE_LABEL_DUPLICATE");
      ids.add(path);
      labels.push({ entry, qrDataUrl: await QRCode.toDataURL(new URL(path, window.location.origin).toString(), { width: 300, margin: 1, errorCorrectionLevel: "M" }) });
      if (labels.length % 6 === 0) await new Promise((resolve) => setTimeout(resolve, 0));
    }
    if (popup.closed) return;
    const html = buildVehicleEntryLabelSheetHtml(labels, language, window.location.hostname !== "aaed-2.vercel.app");
    popup.document.open();popup.document.write(html);popup.document.close();
    await Promise.all(Array.from(popup.document.images).map((image) => image.decode()));
    await popup.document.fonts.ready;
    if (!popup.closed) { popup.focus();popup.print(); }
  } catch (error) { popup.close();if (!signal?.aborted) throw error; }
  finally { signal?.removeEventListener("abort", cancel); }
}
