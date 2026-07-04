import * as XLSX from "xlsx";
import JsBarcode from "jsbarcode";
import type { StockMovement } from "./stockMovementsStore";
import type { Part } from "./inventoryStore";
import { downloadPdfV2, escapeHtml, formatOmr, printPdfV2 } from "./pdf-v2";

const movementTypeLabel: Record<string, string> = {
  IN: "إدخال",
  OUT: "إخراج",
  TRANSFER: "تحويل",
};

export function exportMovementsToExcel(
  movements: StockMovement[],
  filename = "stock_movements.xlsx",
) {
  const summary = movements.map((m) => ({
    "الرقم": m.id,
    "النوع": movementTypeLabel[m.type] || m.type,
    "التاريخ": m.date,
    "المرجع": m.reference || "",
    "السبب": m.reason,
    "من موقع": m.fromLocation || "",
    "إلى موقع": m.toLocation || "",
    "عدد الأصناف": m.items.length,
    "إجمالي الكميات": m.items.reduce((s, i) => s + i.qty, 0),
    "ملاحظات": m.notes || "",
  }));

  const details = movements.flatMap((m) =>
    m.items.map((it) => ({
      "رقم الإذن": m.id,
      "النوع": movementTypeLabel[m.type] || m.type,
      "التاريخ": m.date,
      "الصنف": it.partName,
      "رقم القطعة": it.partNumber,
      "الكمية": it.qty,
      "التكلفة": it.unitCost ?? "",
      "المرجع": m.reference || "",
      "السبب": m.reason,
    })),
  );

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "ملخص الحركات");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(details), "تفاصيل البنود");
  XLSX.writeFile(wb, filename);
}

export function exportMovementsToPdf(
  movements: StockMovement[],
  filters: { type?: string; from?: string; to?: string; reference?: string } = {},
) {
  const filterParts: string[] = [];
  if (filters.type && filters.type !== "all") filterParts.push(`Type: ${filters.type}`);
  if (filters.from) filterParts.push(`From: ${filters.from}`);
  if (filters.to) filterParts.push(`To: ${filters.to}`);
  if (filters.reference) filterParts.push(`Ref: ${filters.reference}`);
  filterParts.push(`Total: ${movements.length}`);

  const rows = movements.map((m) => `
    <tr>
      <td>${escapeHtml(m.id)}</td>
      <td>${escapeHtml(movementTypeLabel[m.type] || m.type)}</td>
      <td>${escapeHtml(m.date)}</td>
      <td>${escapeHtml(m.reference || "-")}</td>
      <td>${escapeHtml(m.reason)}</td>
      <td>${escapeHtml(m.fromLocation || "-")}</td>
      <td>${escapeHtml(m.toLocation || "-")}</td>
      <td>${m.items.length}</td>
      <td>${m.items.reduce((s, i) => s + i.qty, 0)}</td>
    </tr>
  `).join("");

  void downloadPdfV2(
    {
      html: `
        <section class="pdf-v2-card">
          <h2>Stock Movements Report</h2>
          <p>${escapeHtml(filterParts.join(" | "))}</p>
          <p>Generated: ${new Date().toLocaleString("en-GB")}</p>
        </section>
        <table>
          <thead><tr><th>#</th><th>Type</th><th>Date</th><th>Ref</th><th>Reason</th><th>From</th><th>To</th><th>Items</th><th>Qty</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="9">No records</td></tr>`}</tbody>
        </table>
      `,
      meta: {
        documentType: "report",
        title: "Stock Movements Report",
        layout: "a4-landscape",
      },
    },
    `stock_movements_${new Date().toISOString().slice(0, 10)}`,
  );
}

export function printBarcodeLabels(
  part: Part,
  copies: number,
  options: {
    showName?: boolean;
    showPrice?: boolean;
    showPartNumber?: boolean;
    mode?: "print" | "download";
  } = { showName: true, showPrice: true, showPartNumber: true, mode: "print" },
) {
  if (!part.barcode) {
    throw new Error("لا يوجد باركود لهذا المنتج");
  }

  const canvas = document.createElement("canvas");
  try {
    JsBarcode(canvas, part.barcode, {
      format: "CODE128",
      width: 2,
      height: 40,
      displayValue: true,
      fontSize: 12,
      margin: 2,
    });
  } catch {
    throw new Error("فشل توليد الباركود — تأكد من صحة القيمة");
  }
  const dataUrl = canvas.toDataURL("image/png");
  const labels = Array.from({ length: Math.max(1, copies) }, (_, i) => `
    <div class="pdf-v2-card" style="width:46mm;min-height:25mm;margin:1mm;display:inline-flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;break-inside:avoid;page-break-inside:avoid">
      ${options.showName ? `<strong>${escapeHtml(part.name)}</strong>` : ""}
      <img src="${dataUrl}" alt="barcode-${i + 1}" style="width:40mm;height:auto;margin:1mm 0" />
      ${options.showPartNumber && part.partNumber ? `<span>${escapeHtml(part.partNumber)}</span>` : ""}
      ${options.showPrice ? `<strong>${formatOmr(Number(part.sellPrice || 0))}</strong>` : ""}
    </div>
  `).join("");

  const input = {
    html: `<section data-pdf-layout="qr-label">${labels}</section>`,
    meta: {
      documentType: "qr-label" as const,
      title: "Barcode Labels",
      layout: "qr-label" as const,
    },
  };
  const fileName = `barcode_${part.partNumber || part.id}_${copies}x`;
  if (options.mode === "download") {
    void downloadPdfV2(input, fileName);
  } else {
    void printPdfV2(input);
  }
}
