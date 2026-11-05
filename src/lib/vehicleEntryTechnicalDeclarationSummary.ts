import { buildTechnicalDeclarationConditionSummary, type VehicleTechnicalDeclarationRecord } from "./vehicleTechnicalDeclaration";

export interface EntryWithTechnicalDeclaration {
  vehicle_technical_declaration?: Pick<VehicleTechnicalDeclarationRecord, "id" | "form_data"> | null;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]!);
}

/** Insert into buildVehicleEntryHtml for every intake output path. This helper
 * never fetches, copies, or writes a declaration; EntryService owns hydration.
 * Historical condition/attachment blocks remain in the existing intake template. */
export function buildVehicleEntryTechnicalDeclarationSummaryHtml(entry: EntryWithTechnicalDeclaration, language: "ar" | "en"): string {
  const record = entry.vehicle_technical_declaration;
  if (!record?.id || !record.form_data || typeof record.form_data !== "object") return "";
  const groups = buildTechnicalDeclarationConditionSummary(record, language);
  const title = language === "ar" ? "ملخص حالة المركبة من الإقرار الفني المحفوظ" : "Vehicle Condition — Saved Technical Declaration";
  const empty = language === "ar" ? "لم تُسجّل إجابات فحص في الإقرار المحفوظ." : "No inspection answers recorded in the saved declaration.";
  const cells = groups.map((group) => `<td style="width:50%;border:1px solid #b8c2cf;padding:1mm;vertical-align:top;text-align:start;overflow-wrap:anywhere">
    <strong>${escapeHtml(group.title)}</strong><div>${group.items.map((item) => `<span style="display:inline;white-space:pre-wrap"><b>${escapeHtml(item.label)}:</b> ${escapeHtml(item.value)}</span>`).join(" · ")}</div></td>`);
  const rows: string[] = [];
  for (let index = 0; index < cells.length; index += 2) {
    rows.push(`<tr>${cells[index]}${cells[index + 1] || '<td style="width:50%;border:1px solid #b8c2cf"></td>'}</tr>`);
  }
  // Use a table, not a clipped fixed-height block. The existing shared PDF
  // paginator can split at row boundaries identically for preview and download.
  return `<table class="technical-condition-summary" dir="${language === "ar" ? "rtl" : "ltr"}" data-technical-declaration-id="${escapeHtml(record.id)}" style="margin-top:1.5mm;width:100%;table-layout:fixed;border-collapse:collapse;font-size:9px;line-height:1.3">
    <thead><tr><th colspan="2" style="background:#082a59;color:#fff;text-align:center;font-size:9px;padding:.8mm">${title}</th></tr></thead>
    <tbody>${rows.join("") || `<tr><td colspan="2" style="border:1px solid #b8c2cf;padding:1mm">${empty}</td></tr>`}</tbody>
  </table>`;
}
