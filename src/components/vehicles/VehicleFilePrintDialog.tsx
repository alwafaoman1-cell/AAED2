import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { VehicleFilePrintOptions, VehicleFileReportType, VehicleFileSection } from "@/lib/vehicle360Print";

type Tx = (ar: string, en: string) => string;
const allSections: Array<{ key: VehicleFileSection; ar: string; en: string }> = [
  { key: "vehicle", ar: "بيانات المركبة", en: "Vehicle details" }, { key: "customer", ar: "بيانات العميل", en: "Customer details" },
  { key: "workOrders", ar: "أوامر العمل", en: "Work orders" }, { key: "claims", ar: "المطالبات وLPO", en: "Claims and LPO" },
  { key: "estimates", ar: "التقديرات والموافقات", en: "Estimates and approvals" }, { key: "invoices", ar: "الفواتير", en: "Invoices" },
  { key: "payments", ar: "سندات القبض", en: "Receipts" }, { key: "expenses", ar: "المصروفات", en: "Expenses" },
  { key: "media", ar: "الصور والمستندات", en: "Photos and documents" }, { key: "signatures", ar: "التوقيعات", en: "Signatures" },
  { key: "communications", ar: "المراسلات", en: "Communications" }, { key: "timeline", ar: "السجل الزمني", en: "Timeline" },
  { key: "delivery", ar: "سجل التسليم", en: "Delivery history" }, { key: "notes", ar: "الملاحظات", en: "Notes" },
];
const defaults: VehicleFileSection[] = allSections.map((item) => item.key);

export default function VehicleFilePrintDialog({ open, onOpenChange, tx, allowFinancial, onGenerate }: { open: boolean; onOpenChange: (open: boolean) => void; tx: Tx; allowFinancial: boolean; onGenerate: (options: VehicleFilePrintOptions) => Promise<void> | void }) {
  const [reportType, setReportType] = useState<VehicleFileReportType>("client");
  const [sections, setSections] = useState<VehicleFileSection[]>(defaults);
  const [showFinancials, setShowFinancials] = useState(allowFinancial);
  const [showInternalExpenses, setShowInternalExpenses] = useState(false);
  const [showProfitability, setShowProfitability] = useState(false);
  const [showInternalNotes, setShowInternalNotes] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (reportType !== "internal") {
      setShowInternalExpenses(false);
      setShowProfitability(false);
      setShowInternalNotes(false);
    }
  }, [open, reportType]);

  const toggle = (key: VehicleFileSection) => setSections((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const generate = async () => {
    if (!sections.length) return;
    setBusy(true);
    try {
      await onGenerate({ reportType, sections, showFinancials: allowFinancial && showFinancials, showInternalExpenses: allowFinancial && reportType === "internal" && showInternalExpenses, showProfitability: allowFinancial && reportType === "internal" && showProfitability, showInternalNotes: reportType === "internal" && showInternalNotes });
      onOpenChange(false);
    } finally { setBusy(false); }
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{tx("طباعة ملف المركبة", "Print vehicle file")}</DialogTitle></DialogHeader>
    <div className="space-y-5"><div><Label>{tx("نوع التقرير", "Report type")}</Label><Select value={reportType} onValueChange={(value) => setReportType(value as VehicleFileReportType)}><SelectTrigger className="mt-2"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="client">{tx("ملف العميل", "Client file")}</SelectItem><SelectItem value="insurance">{tx("ملف التأمين", "Insurance file")}</SelectItem><SelectItem value="internal">{tx("الملف الإداري الكامل", "Internal full file")}</SelectItem></SelectContent></Select></div>
      <div><div className="mb-2 flex items-center justify-between"><Label>{tx("الأقسام", "Sections")}</Label><Button type="button" size="sm" variant="ghost" onClick={() => setSections(sections.length === defaults.length ? [] : defaults)}>{sections.length === defaults.length ? tx("إلغاء الكل", "Clear all") : tx("تحديد الكل", "Select all")}</Button></div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{allSections.map((item) => <label key={item.key} className="flex cursor-pointer items-center gap-2 rounded-lg border p-2 text-sm"><Checkbox checked={sections.includes(item.key)} onCheckedChange={() => toggle(item.key)} />{tx(item.ar, item.en)}</label>)}</div></div>
      {allowFinancial && <div className="grid gap-2 rounded-xl border p-3 sm:grid-cols-2"><Check label={tx("إظهار القيم المالية", "Show financial values")} checked={showFinancials} set={setShowFinancials} /><Check label={tx("إظهار المصروفات الداخلية", "Show internal expenses")} checked={showInternalExpenses} set={setShowInternalExpenses} disabled={reportType !== "internal"} /><Check label={tx("إظهار الربحية", "Show profitability")} checked={showProfitability} set={setShowProfitability} disabled={reportType !== "internal"} /><Check label={tx("إظهار الملاحظات الإدارية", "Show administrative notes")} checked={showInternalNotes} set={setShowInternalNotes} disabled={reportType !== "internal"} /></div>}
    </div><DialogFooter><Button variant="outline" onClick={() => onOpenChange(false)}>{tx("إلغاء", "Cancel")}</Button><Button onClick={generate} disabled={busy || sections.length === 0}>{busy ? tx("جاري التجهيز...", "Preparing...") : tx("فتح المعاينة", "Open preview")}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function Check({ label, checked, set, disabled }: { label: string; checked: boolean; set: (value: boolean) => void; disabled?: boolean }) {
  return <label className={`flex items-center gap-2 text-sm ${disabled ? "opacity-50" : "cursor-pointer"}`}><Checkbox checked={checked} disabled={disabled} onCheckedChange={(value) => set(value === true)} />{label}</label>;
}
