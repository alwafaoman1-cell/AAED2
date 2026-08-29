import { useRef } from "react";
import * as XLSX from "xlsx";
import { Button } from "@/components/ui/button";
import { FileSpreadsheet, Download } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/queryKeys";
import { importSupplierRows, type CloudSupplier } from "@/lib/purchases/supplierAccountService";

/**
 * استيراد قائمة موردين من ملف Excel / CSV.
 *
 * الأعمدة المدعومة (عربي/إنجليزي — مرنة):
 *  - الاسم / المورد / name / supplier
 *  - الهاتف / phone / mobile
 *  - البريد / email
 *  - العنوان / address
 *  - الرقم الضريبي / tax / tax_number / vat
 *  - الفئة / category / type           (مثال: "وكيل أصلي"، "زيوت")
 *  - الماركات / السيارات / brands / vehicles / vehicle_brands
 *      → افصل الماركات بفاصلة (,) أو فاصلة منقوطة (؛/;) أو شرطة (|).
 *        مثال: "تويوتا, لكزس, هوندا"
 *  - ملاحظات / notes
 */
export default function ImportSuppliersFromExcelButton() {
  const inputRef = useRef<HTMLInputElement>(null);
  const { profile } = useAuth();
  const queryClient = useQueryClient();

  function pick() { inputRef.current?.click(); }

  function downloadTemplate() {
    const headers = ["الاسم", "الهاتف", "البريد", "العنوان", "الرقم الضريبي", "الفئة", "ماركات السيارات", "ملاحظات"];
    const rows = [
      ["الوكيل تويوتا", "92000001", "toyota@dealer.om", "مسقط - السيب", "OM100200300", "وكيل أصلي", "تويوتا, لكزس", "قطع أصلية"],
      ["محلات نيسان للقطع", "92000002", "", "الخوض", "", "تجاري", "نيسان, إنفينيتي", "قطع تجارية"],
      ["هندي اويل", "92000003", "", "روي", "", "زيوت", "جميع الماركات", "زيوت وفلاتر"],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    ws["!cols"] = [{ wch: 22 }, { wch: 14 }, { wch: 22 }, { wch: 22 }, { wch: 16 }, { wch: 14 }, { wch: 28 }, { wch: 24 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Suppliers");
    XLSX.writeFile(wb, "suppliers-template.xlsx");
  }

  function normalizeKey(k: string): string {
    return String(k).trim().toLowerCase().replace(/\s+/g, "").replace(/[%./_-]/g, "");
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
  function splitBrands(raw: any): string[] {
    if (!raw) return [];
    return String(raw)
      .split(/[,،؛;|/]+/)
      .map((s) => s.trim())
      .filter(Boolean);
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
      if (!rows.length) { toast.error("لا توجد بيانات في الملف"); return; }

      const nameKeys = ["الاسم","اسمالمورد","اسم","المورد","name","supplier","suppliername"];
      const phoneKeys = ["الهاتف","جوال","هاتف","phone","mobile","tel"];
      const emailKeys = ["البريد","الايميل","بريد","email","mail"];
      const addrKeys = ["العنوان","عنوان","address","location"];
      const taxKeys = ["الرقمالضريبي","ضريبي","tax","taxnumber","vat","vatnumber"];
      const catKeys = ["الفئة","النوع","التصنيف","category","type","kind"];
      const brandsKeys = ["ماركاتالسيارات","الماركات","السيارات","ماركات","brands","vehicles","vehiclebrands","makes","cars"];
      const notesKeys = ["ملاحظات","ملاحظة","notes","note","remarks"];

      if (!profile?.tenant_id) throw new Error("تعذر تحديد المؤسسة");
      const parsed: Array<Partial<CloudSupplier> & { name: string }> = [];

      for (const r of rows) {
        const name = pickField(r, nameKeys);
        if (!name) continue;
        const patch: Partial<CloudSupplier> & { name: string } = {
          name: String(name).trim(),
          phone: String(pickField(r, phoneKeys) ?? "").trim(),
          email: String(pickField(r, emailKeys) ?? "").trim() || undefined,
          address: String(pickField(r, addrKeys) ?? "").trim() || undefined,
          tax_number: String(pickField(r, taxKeys) ?? "").trim() || undefined,
          category: String(pickField(r, catKeys) ?? "").trim() || undefined,
          vehicle_brands: splitBrands(pickField(r, brandsKeys)),
          notes: String(pickField(r, notesKeys) ?? "").trim() || undefined,
        };
        parsed.push(patch);
      }
      const { added, updated } = await importSupplierRows(profile.tenant_id, parsed);
      if (!added && !updated) {
        toast.error("لم يتم العثور على موردين صالحين (تأكد من وجود عمود الاسم)");
        return;
      }
      await queryClient.invalidateQueries({ queryKey: queryKeys.suppliers.all });
      toast.success(`تم استيراد ${added} مورد جديد${updated ? ` وتحديث ${updated}` : ""}`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "فشل قراءة الملف");
    }
  }

  return (
    <>
      <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} className="hidden" />
      <Button size="sm" variant="outline" onClick={pick} className="gap-2" title="استيراد موردين من Excel/CSV">
        <FileSpreadsheet className="h-3.5 w-3.5" />
        استيراد من Excel
      </Button>
      <Button size="sm" variant="ghost" onClick={downloadTemplate} className="gap-1 px-2" title="تحميل نموذج Excel">
        <Download className="h-3.5 w-3.5" />
        نموذج
      </Button>
    </>
  );
}
