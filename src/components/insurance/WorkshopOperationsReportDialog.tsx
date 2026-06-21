import { useMemo, useState } from "react";
import * as XLSX from "xlsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Printer, FileDown, FileSpreadsheet } from "lucide-react";
import { toEnglishDigits, formatPlateLatin } from "@/lib/numberUtils";
import { computeDays } from "@/lib/claimDurationStatus";
import { useClaimPayments } from "@/hooks/useClaimPayments";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import type { InsuranceClaim } from "@/hooks/useInsuranceClaims";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";

const STATUS_LABELS: Record<string, string> = {
  pending: "بانتظار الاعتماد",
  approved: "معتمدة",
  rejected: "مرفوضة",
  paid: "مدفوعة",
  cancelled: "ملغاة",
};

type FieldKey =
  | "claim_number" | "order_number" | "company" | "customer" | "vehicle" | "plate"
  | "entry_date" | "estimate_date" | "work_started_at" | "progress" | "status"
  | "expected_delivery" | "delivered_at" | "notes" | "estimated_amount" | "approved_amount"
  | "collection_status";

const ALL_FIELDS: { key: FieldKey; label: string; default: boolean }[] = [
  { key: "claim_number",      label: "رقم المطالبة",        default: true  },
  { key: "order_number",      label: "رقم أمر العمل",       default: true  },
  { key: "company",           label: "شركة التأمين",        default: true  },
  { key: "customer",          label: "العميل",              default: true  },
  { key: "vehicle",           label: "المركبة",             default: true  },
  { key: "plate",             label: "رقم اللوحة",          default: true  },
  { key: "entry_date",        label: "تاريخ الدخول",        default: true  },
  { key: "estimate_date",     label: "تاريخ التقدير",       default: false },
  { key: "work_started_at",   label: "تاريخ بدء العمل",     default: false },
  { key: "progress",          label: "نسبة الإنجاز",        default: true  },
  { key: "status",            label: "الحالة الحالية",      default: true  },
  { key: "expected_delivery", label: "التسليم المتوقع",     default: false },
  { key: "delivered_at",      label: "التسليم الفعلي",      default: true  },
  { key: "estimated_amount",  label: "المبلغ المقدر",       default: false },
  { key: "approved_amount",   label: "المبلغ المعتمد",      default: false },
  { key: "collection_status", label: "حالة التحصيل",        default: true  },
  { key: "notes",             label: "الملاحظات",           default: false },
];

function fmtDate(d?: string | null): string {
  if (!d) return "—";
  try { return toEnglishDigits(new Date(d).toLocaleDateString("en-GB")); } catch { return "—"; }
}
function progressOf(c: InsuranceClaim): number {
  const woStatus = (c as any).job_order?.status as string | undefined;
  if ((c as any).delivered_at) return 100;
  if (woStatus === "delivered") return 100;
  if (woStatus === "completed") return 90;
  if (woStatus === "in_progress") return 60;
  if (woStatus === "waiting_parts") return 40;
  if (woStatus === "inspection") return 20;
  if (woStatus === "received") return 10;
  if (c.status === "approved") return 15;
  if (c.status === "paid") return 100;
  return 0;
}
function statusLabel(c: InsuranceClaim): string {
  if ((c as any).delivered_at) return "تم التسليم";
  return STATUS_LABELS[c.status] || c.status;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  claims: InsuranceClaim[];
  filterLabel: string;
}

export default function WorkshopOperationsReportDialog({ open, onOpenChange, claims, filterLabel }: Props) {
  const [previewHtml, setPreviewHtml] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selected, setSelected] = useState<Record<FieldKey, boolean>>(
    () => Object.fromEntries(ALL_FIELDS.map((f) => [f.key, f.default])) as Record<FieldKey, boolean>,
  );

  const { data: payments } = useClaimPayments();
  const { data: companies } = useInsuranceCompanies();

  const activeFields = useMemo(() => ALL_FIELDS.filter((f) => selected[f.key]), [selected]);

  function collectionStatus(c: InsuranceClaim): string {
    const anyC = c as any;
    const approved = Number(c.approved_amount) || Number(c.estimated_amount) || 0;
    const paid = (payments ?? [])
      .filter((p) => p.claim_id === c.id && p.status !== "bounced")
      .reduce((s, p) => s + Number(p.amount), 0);
    const remaining = approved - paid;
    if (approved > 0 && remaining <= 0.01) return "مدفوعة بالكامل";
    const delivered = anyC.delivered_at;
    if (!delivered) return "—";
    const company = companies?.find((co) => co.id === anyC.insurance_company_id);
    const terms = company?.payment_terms_days ?? 90;
    const daysSince = computeDays(delivered) ?? 0;
    const remainingDays = terms - daysSince;
    if (remainingDays < 0) {
      return `متأخر ${toEnglishDigits(String(Math.abs(remainingDays)))} يوم`;
    }
    return `بانتظار التحصيل (${toEnglishDigits(String(remainingDays))} يوم)`;
  }

  function cellValue(c: InsuranceClaim, key: FieldKey): string | number {
    const anyC = c as any;
    switch (key) {
      case "claim_number":      return toEnglishDigits(c.claim_number || "");
      case "order_number":      return toEnglishDigits(anyC.job_order?.order_number || "—");
      case "company":           return c.insurance_company || "—";
      case "customer":          return c.customer?.name || "—";
      case "vehicle":           return `${anyC.vehicle_make ?? c.vehicle?.brand ?? ""} ${anyC.vehicle_model ?? c.vehicle?.model ?? ""}`.trim() || "—";
      case "plate":             return formatPlateLatin(anyC.vehicle_plate ?? c.vehicle?.plate_number ?? "") || "—";
      case "entry_date":        return fmtDate(anyC.workshop_arrival_date || c.created_at);
      case "estimate_date":     return fmtDate(anyC.estimate_date);
      case "work_started_at":   return fmtDate(anyC.work_started_at);
      case "progress":          return `${toEnglishDigits(String(progressOf(c)))}%`;
      case "status":            return statusLabel(c);
      case "expected_delivery": return fmtDate(anyC.expected_delivery_date);
      case "delivered_at":      return fmtDate(anyC.delivered_at);
      case "estimated_amount":  return toEnglishDigits(Number(c.estimated_amount || 0).toLocaleString("en-US"));
      case "approved_amount":   return toEnglishDigits(Number(c.approved_amount || 0).toLocaleString("en-US"));
      case "collection_status": return collectionStatus(c);
      case "notes":             return c.notes || "—";
    }
  }

  function escapeHtml(s: unknown): string {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildHtml(): string {
    const title = "تقرير عمليات الورشة";
    const now = toEnglishDigits(new Date().toLocaleString("en-GB"));
    const head = activeFields.map((f) => `<th>${escapeHtml(f.label)}</th>`).join("");
    const rows = claims.map((c, i) => {
      const tds = activeFields.map((f) => `<td>${escapeHtml(cellValue(c, f.key))}</td>`).join("");
      return `<tr><td class="num">${escapeHtml(toEnglishDigits(String(i + 1)))}</td>${tds}</tr>`;
    }).join("");
    return `<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
  @page { size: A4 landscape; margin: 0; }
  html, body { margin:0; padding:0; background:#fff; }
  body { font-family: "Segoe UI", Tahoma, Arial, sans-serif; color:#111; }
  .page { width:297mm; min-height:210mm; box-sizing:border-box; background:#fff; }
  h1 { font-size: 16pt; margin: 0 0 4px; }
  .meta { font-size: 9pt; color:#555; margin-bottom: 10px; display:flex; justify-content:space-between; }
  table { width: 100%; border-collapse: collapse; font-size: 9pt; }
  th, td { border: 1px solid #999; padding: 4px 6px; text-align: right; vertical-align: middle; }
  th { background: #f1f5f9; font-weight: 700; }
  .num { width: 28px; text-align:center; color:#666; }
  tr:nth-child(even) td { background: #fafafa; }
  tfoot td { background:#f8fafc; font-weight:600; }
</style></head><body><div class="page">
<h1>${escapeHtml(title)}</h1>
<div class="meta"><div>الفلتر: ${escapeHtml(filterLabel)}</div><div>عدد السجلات: ${escapeHtml(toEnglishDigits(String(claims.length)))} · ${escapeHtml(now)}</div></div>
<table><thead><tr><th class="num">#</th>${head}</tr></thead><tbody>${rows}</tbody></table>
</div></body></html>`;
  }

  function openPreview() {
    setPreviewHtml(buildHtml());
    setPreviewOpen(true);
  }


  function exportExcel() {
    const header = ["#", ...activeFields.map((f) => f.label)];
    const data = claims.map((c, i) => [i + 1, ...activeFields.map((f) => cellValue(c, f.key))]);
    const ws = XLSX.utils.aoa_to_sheet([header, ...data]);
    ws["!cols"] = header.map((h) => ({ wch: Math.max(12, String(h).length + 4) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Workshop Ops");
    XLSX.writeFile(wb, `workshop-ops-${new Date().toISOString().slice(0, 10)}.xlsx`);
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl" dir="rtl">
        <DialogHeader>
          <DialogTitle>تقرير عمليات الورشة</DialogTitle>
          <DialogDescription>
            سيُبنى التقرير على نتائج الفلتر الحالي ({filterLabel}) — عدد السجلات:{" "}
            <span className="font-mono" dir="ltr">{toEnglishDigits(String(claims.length))}</span>
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <div className="text-sm font-medium">اختر الحقول التي ستظهر في التقرير</div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2 bg-secondary/30 border border-border rounded-lg p-3 max-h-72 overflow-y-auto">
            {ALL_FIELDS.map((f) => (
              <label key={f.key} className="flex items-center gap-2 text-sm cursor-pointer">
                <Checkbox
                  checked={selected[f.key]}
                  onCheckedChange={(v) => setSelected((s) => ({ ...s, [f.key]: !!v }))}
                />
                <span>{f.label}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2 text-xs">
            <button className="text-primary hover:underline" onClick={() => setSelected(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, true])) as any)}>تحديد الكل</button>
            <span className="text-muted-foreground">·</span>
            <button className="text-primary hover:underline" onClick={() => setSelected(Object.fromEntries(ALL_FIELDS.map((f) => [f.key, false])) as any)}>إلغاء الكل</button>
          </div>
        </div>

        <DialogFooter className="flex-row-reverse gap-2">
          <Button onClick={openPreview} disabled={activeFields.length === 0} className="gap-2">
            <Printer size={16} /> طباعة / PDF
          </Button>
          <Button variant="outline" onClick={exportExcel} disabled={activeFields.length === 0} className="gap-2">
            <FileSpreadsheet size={16} /> Excel
          </Button>
          <Button variant="ghost" onClick={() => onOpenChange(false)} className="gap-2">
            <FileDown size={16} className="opacity-0" /> إغلاق
          </Button>
        </DialogFooter>
        </DialogContent>
      </Dialog>

      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        htmlContent={previewHtml}
        title="تقرير عمليات الورشة"
        fileName={`workshop-operations-${new Date().toISOString().slice(0, 10)}`}
      />
    </>
  );
}
