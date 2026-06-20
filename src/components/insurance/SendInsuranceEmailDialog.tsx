import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Mail, Paperclip, Image as ImageIcon, FileText, Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

type SavedDoc = { id: string; file_path: string; category: string; created_at: string };

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultEmail?: string;
  defaultCc?: string;
  claimNumber: string;
  insuranceCompany: string;
  vehiclePlate?: string;
  vehicleInfo?: string;
  damagePhotos: string[];
  /** ملفات أمر العمل المرتبط (قبل/بعد) إن وجدت */
  workOrderPhotos?: string[];
  /** قائمة PDF المحفوظة في أرشيف المطالبة (تقدير/ملخص/فاتورة/قبل-بعد) */
  savedDocs: SavedDoc[];
  /** يبني PDF التقدير الحالي ويحفظه ويعيد الرابط العام */
  buildAndSaveEstimatePdf?: () => Promise<string | null>;
  /** يبني PDF الملخص الشامل ويحفظه ويعيد الرابط العام */
  buildAndSaveSummaryPdf?: () => Promise<string | null>;
}

const PUBLIC_BUCKET = "insurance-docs";

const publicUrl = async (path: string) => {
  const { data } = await supabase.storage.from(PUBLIC_BUCKET).createSignedUrl(path, 60 * 60 * 24 * 7);
  return data?.signedUrl ?? "";
};

const categoryLabel = (c: string) =>
  ({
    claim_estimate: "تقدير المطالبة",
    claim_summary: "ملخص المطالبة",
    insurance_invoice: "فاتورة تأمين",
    before_after: "تقرير قبل/بعد",
    inspection_report: "تقرير الفحص",
  } as Record<string, string>)[c] ?? c;

export default function SendInsuranceEmailDialog({
  open, onOpenChange,
  defaultEmail = "", defaultCc = "",
  claimNumber, insuranceCompany, vehiclePlate, vehicleInfo,
  damagePhotos, workOrderPhotos = [],
  savedDocs,
  buildAndSaveEstimatePdf, buildAndSaveSummaryPdf,
}: Props) {
  const [to, setTo] = useState(defaultEmail);
  const [cc, setCc] = useState(defaultCc);
  const [subject, setSubject] = useState(
    `تقرير المطالبة رقم ${claimNumber} — ${insuranceCompany}`
  );
  const [includeDamage, setIncludeDamage] = useState(true);
  const [includeWorkOrder, setIncludeWorkOrder] = useState(workOrderPhotos.length > 0);
  const [includeFreshEstimate, setIncludeFreshEstimate] = useState(true);
  const [includeFreshSummary, setIncludeFreshSummary] = useState(false);
  const [selectedDocs, setSelectedDocs] = useState<Record<string, boolean>>(
    () => Object.fromEntries(savedDocs.slice(0, 3).map((d) => [d.id, true]))
  );
  const [extraNote, setExtraNote] = useState("");
  const [busy, setBusy] = useState(false);

  const damageLinks = useMemo(
    () => (includeDamage ? damagePhotos.filter(Boolean) : []),
    [includeDamage, damagePhotos]
  );
  const workOrderLinks = useMemo(
    () => (includeWorkOrder ? workOrderPhotos.filter(Boolean) : []),
    [includeWorkOrder, workOrderPhotos]
  );
  const [docLinks, setDocLinks] = useState<{ url: string; label: string }[]>([]);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = savedDocs.filter((d) => selectedDocs[d.id]);
      const resolved = await Promise.all(
        items.map(async (d) => ({ url: await publicUrl(d.file_path), label: categoryLabel(d.category) }))
      );
      if (!cancelled) setDocLinks(resolved);
    })();
    return () => { cancelled = true; };
  }, [savedDocs, selectedDocs]);

  const buildBody = (
    extraDocs: { url: string; label: string }[] = []
  ) => {
    const lines: string[] = [];
    lines.push(`السلام عليكم،`);
    lines.push(``);
    lines.push(`نرفق لكم تقرير المطالبة رقم ${claimNumber} الخاصة بشركة ${insuranceCompany}.`);
    if (vehicleInfo || vehiclePlate) {
      lines.push(`المركبة: ${[vehicleInfo, vehiclePlate].filter(Boolean).join(" — ")}`);
    }
    lines.push(``);
    const allDocs = [...docLinks, ...extraDocs];
    if (allDocs.length) {
      lines.push(`📎 المستندات المرفقة:`);
      allDocs.forEach((d, i) => lines.push(`  ${i + 1}. ${d.label}: ${d.url}`));
      lines.push(``);
    }
    if (damageLinks.length) {
      lines.push(`📷 صور الفحص/الأضرار (${damageLinks.length}):`);
      damageLinks.forEach((u, i) => lines.push(`  ${i + 1}. ${u}`));
      lines.push(``);
    }
    if (workOrderLinks.length) {
      lines.push(`🛠️ صور أمر العمل (قبل/بعد) (${workOrderLinks.length}):`);
      workOrderLinks.forEach((u, i) => lines.push(`  ${i + 1}. ${u}`));
      lines.push(``);
    }
    if (extraNote.trim()) {
      lines.push(`📝 ملاحظات:`);
      lines.push(extraNote.trim());
      lines.push(``);
    }
    lines.push(`للاستفسار يرجى الرد على هذا البريد.`);
    lines.push(`مع التحية،`);
    return lines.join("\n");
  };

  const handleSend = async () => {
    if (!to.trim()) {
      toast.error("الرجاء إدخال بريد شركة التأمين");
      return;
    }
    setBusy(true);
    try {
      const freshDocs: { url: string; label: string }[] = [];
      if (includeFreshEstimate && buildAndSaveEstimatePdf) {
        const url = await buildAndSaveEstimatePdf();
        if (url) freshDocs.push({ url, label: "تقدير المطالبة (أحدث نسخة)" });
      }
      if (includeFreshSummary && buildAndSaveSummaryPdf) {
        const url = await buildAndSaveSummaryPdf();
        if (url) freshDocs.push({ url, label: "ملخص المطالبة (أحدث نسخة)" });
      }
      const body = buildBody(freshDocs);
      const params = new URLSearchParams();
      params.set("subject", subject);
      params.set("body", body);
      if (cc.trim()) params.set("cc", cc.trim());
      const mailto = `mailto:${encodeURIComponent(to.trim())}?${params.toString().replace(/\+/g, "%20")}`;
      window.location.href = mailto;
      toast.success("تم فتح تطبيق البريد لإرسال التقرير");
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "تعذر تجهيز البريد");
    } finally {
      setBusy(false);
    }
  };

  const handleCopyAll = async () => {
    const body = buildBody();
    const text = `إلى: ${to}\nنسخة: ${cc}\nالموضوع: ${subject}\n\n${body}`;
    try {
      await navigator.clipboard.writeText(text);
      toast.success("تم نسخ النص إلى الحافظة");
    } catch {
      toast.error("تعذر النسخ");
    }
  };

  const totalAttached =
    docLinks.length +
    damageLinks.length +
    workOrderLinks.length +
    (includeFreshEstimate ? 1 : 0) +
    (includeFreshSummary ? 1 : 0);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-lg">
            <Mail className="text-primary" size={20} />
            إرسال تقرير التأمين بالبريد
            <Badge variant="secondary" className="ms-2">
              {totalAttached} مرفق
            </Badge>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">إلى (بريد شركة التأمين) *</Label>
              <Input value={to} onChange={(e) => setTo(e.target.value)} placeholder="claims@insurance.com" dir="ltr" />
            </div>
            <div>
              <Label className="text-xs">نسخة (CC)</Label>
              <Input value={cc} onChange={(e) => setCc(e.target.value)} placeholder="optional@example.com" dir="ltr" />
            </div>
          </div>

          <div>
            <Label className="text-xs">الموضوع</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          {/* Fresh PDFs */}
          <div className="rounded-lg border p-3 space-y-2 bg-muted/30">
            <div className="flex items-center gap-2 text-sm font-bold">
              <FileText size={14} className="text-primary" /> توليد PDF حديث الآن وإرفاقه كرابط
            </div>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={includeFreshEstimate} onCheckedChange={(v) => setIncludeFreshEstimate(!!v)} />
              تقدير الإصلاح (أحدث نسخة — يُنشأ ويُحفظ لحظياً)
            </label>
            <label className="flex items-center gap-2 text-sm cursor-pointer">
              <Checkbox checked={includeFreshSummary} onCheckedChange={(v) => setIncludeFreshSummary(!!v)} />
              ملخص المطالبة الشامل (أحدث نسخة)
            </label>
          </div>

          {/* Saved docs */}
          {savedDocs.length > 0 && (
            <div className="rounded-lg border p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm font-bold">
                <Paperclip size={14} className="text-primary" /> مستندات محفوظة في أرشيف المطالبة
              </div>
              <div className="grid sm:grid-cols-2 gap-1.5 max-h-40 overflow-y-auto">
                {savedDocs.map((d) => (
                  <label key={d.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-muted/50 rounded px-1.5 py-1">
                    <Checkbox
                      checked={!!selectedDocs[d.id]}
                      onCheckedChange={(v) => setSelectedDocs((s) => ({ ...s, [d.id]: !!v }))}
                    />
                    <span className="font-medium">{categoryLabel(d.category)}</span>
                    <span className="text-muted-foreground">• {new Date(d.created_at).toLocaleDateString("ar-OM")}</span>
                    <button
                      type="button"
                      onClick={async () => {
                        const u = await publicUrl(d.file_path);
                        if (u) window.open(u, "_blank", "noreferrer");
                      }}
                      className="ms-auto text-primary hover:underline"
                    >
                      <ExternalLink size={12} />
                    </button>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* Photos */}
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2 text-sm font-bold">
              <ImageIcon size={14} className="text-primary" /> الصور
            </div>
            <label className="flex items-center justify-between text-sm cursor-pointer">
              <span className="flex items-center gap-2">
                <Checkbox checked={includeDamage} onCheckedChange={(v) => setIncludeDamage(!!v)} />
                صور الفحص/الأضرار
              </span>
              <Badge variant="outline">{damagePhotos.length}</Badge>
            </label>
            {workOrderPhotos.length > 0 && (
              <label className="flex items-center justify-between text-sm cursor-pointer">
                <span className="flex items-center gap-2">
                  <Checkbox checked={includeWorkOrder} onCheckedChange={(v) => setIncludeWorkOrder(!!v)} />
                  صور أمر العمل (قبل/بعد)
                </span>
                <Badge variant="outline">{workOrderPhotos.length}</Badge>
              </label>
            )}
          </div>

          <div>
            <Label className="text-xs">ملاحظات إضافية للبريد (اختياري)</Label>
            <Textarea value={extraNote} onChange={(e) => setExtraNote(e.target.value)} rows={3} placeholder="أي ملاحظات تريد إرسالها مع التقرير…" />
          </div>

          <p className="text-[11px] text-muted-foreground bg-info/5 border border-info/20 rounded p-2">
            ℹ️ سيتم فتح تطبيق البريد لديك مع تجهيز كل الروابط (PDF + صور). الروابط مباشرة وقابلة للتنزيل من قِبل شركة التأمين.
          </p>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={handleCopyAll} className="gap-1.5">
            <Copy size={14} /> نسخ النص
          </Button>
          <Button onClick={handleSend} disabled={busy || !to.trim()} className="gap-1.5">
            <Mail size={14} /> فتح البريد وإرسال
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
