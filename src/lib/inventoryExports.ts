// أدوات تصدير سجل الحركات المخزنية + ملصقات الباركود
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import JsBarcode from "jsbarcode";
import type { StockMovement } from "./stockMovementsStore";
import type { Part } from "./inventoryStore";

const movementTypeLabel: Record<string, string> = {
  IN: "إدخال",
  OUT: "إخراج",
  TRANSFER: "تحويل",
};

/** تصدير سجل الحركات إلى Excel */
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
  const ws1 = XLSX.utils.json_to_sheet(summary);
  const ws2 = XLSX.utils.json_to_sheet(details);
  XLSX.utils.book_append_sheet(wb, ws1, "ملخص الحركات");
  XLSX.utils.book_append_sheet(wb, ws2, "تفاصيل البنود");
  XLSX.writeFile(wb, filename);
}

/** تصدير سجل الحركات إلى PDF */
export function exportMovementsToPdf(
  movements: StockMovement[],
  filters: { type?: string; from?: string; to?: string; reference?: string } = {},
) {
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });

  // عنوان
  doc.setFontSize(16);
  doc.text("Stock Movements Report - سجل الإذن المخزنية", 148, 14, { align: "center" });

  doc.setFontSize(9);
  const filterParts: string[] = [];
  if (filters.type && filters.type !== "all") filterParts.push(`Type: ${filters.type}`);
  if (filters.from) filterParts.push(`From: ${filters.from}`);
  if (filters.to) filterParts.push(`To: ${filters.to}`);
  if (filters.reference) filterParts.push(`Ref: ${filters.reference}`);
  filterParts.push(`Total: ${movements.length}`);
  doc.text(filterParts.join("  |  "), 148, 21, { align: "center" });
  doc.text(`Generated: ${new Date().toLocaleString("en-GB")}`, 148, 27, { align: "center" });

  const rows = movements.map((m) => [
    m.id,
    movementTypeLabel[m.type] || m.type,
    m.date,
    m.reference || "-",
    m.reason,
    m.fromLocation || "-",
    m.toLocation || "-",
    String(m.items.length),
    String(m.items.reduce((s, i) => s + i.qty, 0)),
  ]);

  autoTable(doc, {
    head: [["#", "Type", "Date", "Ref", "Reason", "From", "To", "Items", "Qty"]],
    body: rows,
    startY: 32,
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [212, 175, 55], textColor: 20, fontStyle: "bold" },
    alternateRowStyles: { fillColor: [245, 245, 245] },
    columnStyles: {
      0: { cellWidth: 22, fontStyle: "bold" },
      1: { cellWidth: 18 },
      2: { cellWidth: 22 },
      3: { cellWidth: 25 },
      4: { cellWidth: 60 },
      5: { cellWidth: 35 },
      6: { cellWidth: 35 },
      7: { cellWidth: 15, halign: "center" },
      8: { cellWidth: 18, halign: "center" },
    },
  });

  doc.save(`stock_movements_${new Date().toISOString().slice(0, 10)}.pdf`);
}

/**
 * توليد ملصقات باركود لمنتج — كل ملصق فى صفحته الخاصة بمقاس 50×30 مم
 * يضمن عدم وجود صفحات فارغة عند الطباعة، ويُفتح فى Iframe مخفى للطباعة
 * المباشرة بدون نوافذ منبثقة. كما يمكن تحميله كملف PDF.
 */
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

  // باركود عالى الدقة
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

  // كل ملصق صفحة مستقلة بمقاسه الفعلى — لا صفحات فارغة، وطباعة مضبوطة على الورق
  const labelW = 50; // mm
  const labelH = 30; // mm
  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: [labelW, labelH] });

  for (let i = 0; i < copies; i++) {
    if (i > 0) doc.addPage([labelW, labelH], "landscape");

    // إطار رقيق أنيق
    doc.setDrawColor(210);
    doc.setLineWidth(0.15);
    doc.roundedRect(0.6, 0.6, labelW - 1.2, labelH - 1.2, 1, 1);

    let cursorY = 3.5;

    if (options.showName) {
      doc.setFontSize(7);
      doc.setFont("helvetica", "bold");
      const name = part.name.length > 32 ? part.name.slice(0, 32) + "…" : part.name;
      doc.text(name, labelW / 2, cursorY, { align: "center" });
      cursorY += 2.8;
    }

    // الباركود
    const bcH = 13;
    doc.addImage(dataUrl, "PNG", 3, cursorY, labelW - 6, bcH);
    cursorY += bcH + 1.5;

    if (options.showPartNumber && part.partNumber) {
      doc.setFontSize(6);
      doc.setFont("helvetica", "normal");
      doc.text(part.partNumber, labelW / 2, cursorY, { align: "center" });
      cursorY += 2.2;
    }

    if (options.showPrice) {
      doc.setFontSize(8);
      doc.setFont("helvetica", "bold");
      doc.text(`${part.sellPrice} OMR`, labelW / 2, cursorY + 0.6, { align: "center" });
    }
  }

  const fileName = `barcode_${part.partNumber || part.id}_${copies}x.pdf`;

  if (options.mode === "download") {
    doc.save(fileName);
    return;
  }

  // طباعة عبر iframe مخفى — يمنع الصفحات الفارغة وتعدد التبويبات
  const blob = doc.output("blob");
  const url = URL.createObjectURL(blob);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.src = url;
  iframe.onload = () => {
    setTimeout(() => {
      try {
        iframe.contentWindow?.focus();
        iframe.contentWindow?.print();
      } catch {
        /* noop */
      }
      // إزالة بعد فترة كافية للطباعة
      setTimeout(() => {
        URL.revokeObjectURL(url);
        iframe.remove();
      }, 60_000);
    }, 250);
  };
  document.body.appendChild(iframe);
}
