import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import * as XLSX from "xlsx";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileSpreadsheet, Download, Upload, ArrowRight, CheckCircle2, Info, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { inventoryStore, type Part } from "@/lib/inventoryStore";

interface CatalogRow {
  nameAr: string;
  nameEn?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  partNumber?: string;
  sellPrice?: number;
  buyPrice?: number;
  stock?: number;
  brand?: string;
  category?: string;
}

const HEADERS_AR = ["الاسم بالعربي", "الاسم بالإنجليزي", "ماركة السيارة", "موديل السيارة", "رقم القطعة", "السعر (اختياري)", "سعر الشراء", "الكمية", "العلامة التجارية", "الفئة"];
const HEADERS_EN = ["Name (Arabic)", "Name (English)", "Vehicle Make", "Vehicle Model", "Part Number", "Price (optional)", "Buy Price", "Stock", "Brand", "Category"];

function normKey(k: string) {
  return String(k).trim().toLowerCase().replace(/\s+/g, "").replace(/[%./_\-()]/g, "");
}
function pick(row: Record<string, any>, candidates: string[]) {
  const keys = Object.keys(row);
  for (const c of candidates) {
    const cn = normKey(c);
    const hit = keys.find((k) => normKey(k) === cn);
    if (hit !== undefined && row[hit] !== undefined && row[hit] !== "") return row[hit];
  }
  return undefined;
}

export default function PartsCatalogImport() {
  const { i18n } = useTranslation();
  const isAr = i18n.language === "ar";
  const inputRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<CatalogRow[]>([]);
  const [fileName, setFileName] = useState("");

  function downloadTemplate() {
    const headers = isAr ? HEADERS_AR : HEADERS_EN;
    const sample = [
      ["فلتر زيت", "Oil Filter", "Toyota", "Camry 2020", "TOY-OF-CAM20", 4.5, 2.5, 10, "Toyota", "فلاتر"],
      ["تيل فرامل أمامي", "Front Brake Pads", "Honda", "Accord 2019", "HON-BP-ACC19", "", 35, 5, "Brembo", "فرامل"],
      ["بطارية 70A", "Battery 70A", "", "", "BAT-70A", 42, 28, 8, "ACDelco", "كهرباء"],
    ];
    const ws = XLSX.utils.aoa_to_sheet([headers, ...sample]);
    ws["!cols"] = headers.map(() => ({ wch: 20 }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Parts");
    XLSX.writeFile(wb, "parts-catalog-template.xlsx");
  }

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array" });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error(isAr ? "ملف فارغ" : "Empty file");
      const raw = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });

      const out: CatalogRow[] = [];
      for (const r of raw) {
        const nameAr = pick(r, ["الاسم بالعربي", "الاسم", "اسم", "name_ar", "namear", "arabic", "عربي"]);
        const nameEn = pick(r, ["الاسم بالإنجليزي", "اسم انجليزي", "name_en", "nameen", "english", "name", "إنجليزي"]);
        if (!nameAr && !nameEn) continue;
        out.push({
          nameAr: String(nameAr || nameEn || "").trim(),
          nameEn: nameEn ? String(nameEn).trim() : undefined,
          vehicleMake: String(pick(r, ["ماركة السيارة", "ماركة", "vehicle_make", "make", "brand_vehicle"]) || "").trim() || undefined,
          vehicleModel: String(pick(r, ["موديل السيارة", "موديل", "vehicle_model", "model"]) || "").trim() || undefined,
          partNumber: String(pick(r, ["رقم القطعة", "رقم", "part_number", "partnumber", "sku", "code"]) || "").trim() || undefined,
          sellPrice: (() => { const v = pick(r, ["السعر", "السعر اختياري", "price", "sell_price", "sellprice", "unit_price"]); return v === "" || v === undefined ? undefined : Number(v) || undefined; })(),
          buyPrice: (() => { const v = pick(r, ["سعر الشراء", "تكلفة", "buy_price", "cost", "buyprice"]); return v === "" || v === undefined ? undefined : Number(v) || undefined; })(),
          stock: (() => { const v = pick(r, ["الكمية", "كمية", "stock", "qty", "quantity"]); return v === "" || v === undefined ? undefined : Number(v) || 0; })(),
          brand: String(pick(r, ["العلامة التجارية", "براند", "brand"]) || "").trim() || undefined,
          category: String(pick(r, ["الفئة", "تصنيف", "category"]) || "").trim() || undefined,
        });
      }

      if (!out.length) {
        toast.error(isAr ? "لم يتم العثور على بيانات صالحة" : "No valid data found");
        return;
      }
      setRows(out);
      setFileName(file.name);
      toast.success(isAr ? `تم تحميل ${out.length} صنف` : `Loaded ${out.length} items`);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || (isAr ? "فشل قراءة الملف" : "Failed to read file"));
    }
  }

  function commitToInventory() {
    if (!rows.length) return;
    let added = 0;
    let updated = 0;
    const existing = inventoryStore.getAll();
    for (const r of rows) {
      const displayName = r.nameAr || r.nameEn || "";
      const match = r.partNumber
        ? existing.find((p) => p.partNumber.toLowerCase() === r.partNumber!.toLowerCase())
        : existing.find((p) => p.name === displayName && (p.vehicleMake || "") === (r.vehicleMake || "") && (p.vehicleModel || "") === (r.vehicleModel || ""));
      if (match) {
        inventoryStore.update(match.id, {
          name: displayName || match.name,
          nameEn: r.nameEn ?? match.nameEn,
          vehicleMake: r.vehicleMake ?? match.vehicleMake,
          vehicleModel: r.vehicleModel ?? match.vehicleModel,
          sellPrice: r.sellPrice !== undefined ? r.sellPrice : match.sellPrice,
          buyPrice: r.buyPrice !== undefined ? r.buyPrice : match.buyPrice,
          stock: r.stock !== undefined ? r.stock : match.stock,
          brand: r.brand ?? match.brand,
          category: r.category ?? match.category,
        });
        updated++;
      } else {
        const part: Part = {
          id: `PRT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: displayName,
          nameEn: r.nameEn,
          partNumber: r.partNumber || `AUTO-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          supplier: "",
          buyPrice: r.buyPrice ?? 0,
          sellPrice: r.sellPrice ?? 0,
          stock: r.stock ?? 0,
          minStock: 0,
          sold: 0,
          brand: r.brand,
          category: r.category,
          vehicleMake: r.vehicleMake,
          vehicleModel: r.vehicleModel,
          status: "active",
        };
        inventoryStore.add(part);
        added++;
      }
    }
    toast.success(isAr ? `تمت إضافة ${added} وتحديث ${updated}` : `Added ${added}, updated ${updated}`);
    setRows([]);
    setFileName("");
  }

  return (
    <div className="container mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileSpreadsheet className="h-6 w-6 text-primary" />
            {isAr ? "استيراد كتالوج قطع الغيار" : "Import Parts Catalog"}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            {isAr
              ? "حمّل قائمة قطع الغيار بالعربي والإنجليزي مع نوع السيارة، والسعر اختياري."
              : "Upload spare parts list in Arabic/English with vehicle type; price is optional."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="gap-2">
          <Link to="/inventory">
            <ArrowRight className="h-4 w-4" />
            {isAr ? "رجوع للمخزون" : "Back to Inventory"}
          </Link>
        </Button>
      </div>

      <Alert>
        <Info className="h-4 w-4" />
        <AlertDescription className="text-xs leading-relaxed">
          {isAr
            ? "الأعمدة المدعومة: الاسم بالعربي، الاسم بالإنجليزي، ماركة السيارة، موديل السيارة، رقم القطعة، السعر (اختياري)، سعر الشراء، الكمية، العلامة التجارية، الفئة. اتركها فارغة إذا غير معروفة."
            : "Supported columns: Name (Arabic), Name (English), Vehicle Make, Vehicle Model, Part Number, Price (optional), Buy Price, Stock, Brand, Category. Leave blank if unknown."}
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isAr ? "الخطوة 1: نموذج الملف" : "Step 1: Download Template"}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-3">
          <Button onClick={downloadTemplate} variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            {isAr ? "تحميل نموذج Excel" : "Download Excel Template"}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            className="hidden"
          />
          <Button onClick={() => inputRef.current?.click()} className="gap-2">
            <Upload className="h-4 w-4" />
            {isAr ? "رفع ملف Excel/CSV" : "Upload Excel/CSV"}
          </Button>
          {fileName && (
            <Badge variant="secondary" className="self-center">
              {fileName} — {rows.length} {isAr ? "صف" : "rows"}
            </Badge>
          )}
        </CardContent>
      </Card>

      {rows.length > 0 && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base">
              {isAr ? `الخطوة 2: معاينة (${rows.length} صنف)` : `Step 2: Preview (${rows.length} items)`}
            </CardTitle>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setRows([]); setFileName(""); }} className="gap-2">
                <Trash2 className="h-4 w-4" />
                {isAr ? "إلغاء" : "Clear"}
              </Button>
              <Button size="sm" onClick={commitToInventory} className="gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {isAr ? "حفظ في المخزون" : "Save to Inventory"}
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[500px] overflow-auto">
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{isAr ? "عربي" : "Arabic"}</TableHead>
                    <TableHead>{isAr ? "إنجليزي" : "English"}</TableHead>
                    <TableHead>{isAr ? "ماركة" : "Make"}</TableHead>
                    <TableHead>{isAr ? "موديل" : "Model"}</TableHead>
                    <TableHead>{isAr ? "رقم القطعة" : "Part #"}</TableHead>
                    <TableHead className="text-right">{isAr ? "السعر" : "Price"}</TableHead>
                    <TableHead className="text-right">{isAr ? "الكمية" : "Stock"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => (
                    <TableRow key={i}>
                      <TableCell className="text-muted-foreground text-xs">{i + 1}</TableCell>
                      <TableCell className="font-medium">{r.nameAr || "—"}</TableCell>
                      <TableCell>{r.nameEn || "—"}</TableCell>
                      <TableCell>{r.vehicleMake || "—"}</TableCell>
                      <TableCell>{r.vehicleModel || "—"}</TableCell>
                      <TableCell className="font-mono text-xs">{r.partNumber || "—"}</TableCell>
                      <TableCell className="text-right">
                        {r.sellPrice !== undefined ? r.sellPrice.toFixed(2) : <span className="text-muted-foreground text-xs">—</span>}
                      </TableCell>
                      <TableCell className="text-right">{r.stock ?? 0}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
