import { useRef } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Download } from "lucide-react";
import { toast } from "sonner";
import { cryptoRandom, type SalesLineItem } from "@/lib/salesStore";

interface Props {
  isAr: boolean;
  defaultTax?: number;
  onImport: (items: SalesLineItem[]) => void;
}

/**
 * زر استيراد بنود من Excel/CSV.
 * يدعم أعمدة (عربي/إنجليزي):
 *  - الصنف / item / name / sku / part_number
 *  - الوصف / description
 *  - الكمية / qty / quantity
 *  - السعر / price / unit_price / unitPrice
 *  - خصم  / discount
 *  - ضريبة / tax
 */
export default function ImportItemsFromExcelButton({ isAr, defaultTax = 0, onImport }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);

  function pick() {
    inputRef.current?.click();
  }

  function downloadTemplate() {
    const headers = isAr
      ? ["الصنف", "الوصف", "الكمية", "السعر", "خصم %", "ضريبة %"]
      : ["Item", "Description", "Quantity", "Price", "Discount %", "Tax %"];
    const sample = isAr
      ? ["زيت محرك 5W30", "تغيير زيت محرك كامل", 1, 12.5, 0, defaultTax]
      : ["Engine oil 5W30", "Full oil change", 1, 12.5, 0, defaultTax];
    const ws = XLSX.utils.aoa_to_sheet([headers, sample]);
    ws["!cols"] = [{ wch: 22 }, { wch: 32 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, "items-template.xlsx");
  }

  function normalizeKey(k: string): string {
    return k
      .toString()
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/[%./_-]/g, "");
  }

  function pickField(row: Record<string, any>, candidates: string[]): any {
    const keys = Object.keys(row);
    for (const c of candidates) {
      const cn = normalizeKey(c);
      const hit = keys.find((k) => normalizeKey(k) === cn);
      if (hit !== undefined && row[hit] !== undefined && row[hit] !== "") return row[hit];
    }
    return undefined;
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error("ملف فارغ");
      const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
      if (!rows.length) {
        toast.error(isAr ? "لا توجد بيانات في الملف" : "No data found");
        return;
      }

      const itemKeys = ["الصنف", "صنف", "البند", "بند", "اسم", "name", "item", "sku", "partnumber", "part_number", "code"];
      const descKeys = ["الوصف", "وصف", "تفاصيل", "description", "details", "desc"];
      const qtyKeys = ["الكمية", "كمية", "qty", "quantity", "count"];
      const priceKeys = ["السعر", "سعر", "سعرالوحدة", "price", "unitprice", "unit_price", "rate"];
      const discKeys = ["خصم", "خصم%", "discount", "disc"];
      const taxKeys = ["ضريبة", "ضريبة%", "ض%", "tax", "vat"];

      const items: SalesLineItem[] = [];
      for (const r of rows) {
        const itemName = pickField(r, itemKeys);
        const description = pickField(r, descKeys);
        const qty = Number(pickField(r, qtyKeys)) || 0;
        const price = Number(pickField(r, priceKeys)) || 0;
        const discount = Number(pickField(r, discKeys)) || 0;
        const tax = pickField(r, taxKeys);
        if (!itemName && !description) continue;
        if (qty <= 0 && price <= 0) continue;
        items.push({
          id: cryptoRandom(),
          itemName: itemName ? String(itemName).trim() : undefined,
          description: description ? String(description).trim() : String(itemName || "").trim(),
          quantity: qty || 1,
          unitPrice: price,
          discount: discount,
          tax: tax !== undefined && tax !== "" ? Number(tax) : defaultTax,
        });
      }

      if (!items.length) {
        toast.error(isAr ? "لم يتم العثور على بنود صالحة" : "No valid items found");
        return;
      }
      onImport(items);
      toast.success(
        isAr
          ? `تم استيراد ${items.length} بند بنجاح`
          : `Imported ${items.length} items`,
      );
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || (isAr ? "فشل قراءة الملف" : "Failed to read file"));
    }
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept=".xlsx,.xls,.csv"
        onChange={handleFile}
        className="hidden"
      />
      <Button size="sm" variant="outline" onClick={pick} className="gap-2" title={isAr ? "استيراد من Excel/CSV" : "Import from Excel/CSV"}>
        <FileSpreadsheet className="h-3.5 w-3.5" />
        {isAr ? "استيراد من Excel" : "Import Excel"}
      </Button>
      <Button size="sm" variant="ghost" onClick={downloadTemplate} className="gap-1 px-2" title={isAr ? "تحميل نموذج" : "Download template"}>
        <Download className="h-3.5 w-3.5" />
        {isAr ? "نموذج" : "Template"}
      </Button>
    </>
  );
}
