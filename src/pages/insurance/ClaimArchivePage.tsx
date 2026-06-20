// أرشيف مطالبة (Read-Only) — يجمع كل الملفات المرتبطة بالمطالبة
// لا يربط بأي شاشة تشغيلية: لا تعديل، لا فتح فاتورة/تقدير/أمر عمل.
// كل الملفات Snapshots — لا يُعاد توليد أي PDF عند فتح الأرشيف.
import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  ArrowRight, FileText, Image as ImageIcon, Eye, Download, Printer, Mail,
  Camera, ShieldCheck, ClipboardCheck, Wrench, Receipt, Calculator,
  IdCard, FolderArchive, Search, Loader2, Lock,
} from "lucide-react";
import ArchivedPdfPreviewDialog from "@/components/ArchivedPdfPreviewDialog";
import PhotoLightbox from "@/components/vehicles/PhotoLightbox";
import { claimDocLabel, type ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import { getTemplateSettings } from "@/lib/pdfGenerator";
import { generateClaimArchivePdf, type ArchiveSectionFile } from "@/lib/claimArchivePdf";
import { refreshSignedUrls } from "@/lib/refreshSignedUrls";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

// أقسام تُعتبر "صور المركبة" (قابلة للاستثناء من PDF الموحّد)
const VEHICLE_PHOTO_SECTIONS = new Set<SectionKey>(["reception", "damage", "workorder", "delivery"]);

// ── Types ──
type ArchiveFileKind = "image" | "pdf";
interface ArchiveFile {
  id: string;
  url: string;
  name: string;
  kind: ArchiveFileKind;
  section: SectionKey;
  createdAt?: string;
  meta?: string;
}
type SectionKey =
  | "reception"
  | "damage"
  | "workorder"
  | "documents"
  | "id"
  | "estimates"
  | "quotations"
  | "invoices"
  | "delivery"
  | "other";

const SECTION_DEFS: { key: SectionKey; label: string; icon: JSX.Element; color: string }[] = [
  { key: "reception",  label: "Reception (الاستلام)",        icon: <Camera size={16} />,        color: "from-sky-500/20 to-sky-500/5 border-sky-500/30" },
  { key: "damage",     label: "Damage Photos (صور الأضرار)", icon: <ImageIcon size={16} />,     color: "from-red-500/20 to-red-500/5 border-red-500/30" },
  { key: "workorder",  label: "Work Order Photos (أمر العمل)", icon: <Wrench size={16} />,      color: "from-amber-500/20 to-amber-500/5 border-amber-500/30" },
  { key: "documents",  label: "Documents (مستندات التأمين)", icon: <ShieldCheck size={16} />,   color: "from-violet-500/20 to-violet-500/5 border-violet-500/30" },
  { key: "id",         label: "ID (هوية المستلم)",           icon: <IdCard size={16} />,        color: "from-fuchsia-500/20 to-fuchsia-500/5 border-fuchsia-500/30" },
  { key: "estimates",  label: "Estimates (التقدير PDF)",      icon: <Calculator size={16} />,    color: "from-blue-500/20 to-blue-500/5 border-blue-500/30" },
  { key: "quotations", label: "Quotations (عروض الأسعار)",   icon: <FileText size={16} />,      color: "from-cyan-500/20 to-cyan-500/5 border-cyan-500/30" },
  { key: "invoices",   label: "Invoices (الفواتير)",          icon: <Receipt size={16} />,       color: "from-emerald-500/20 to-emerald-500/5 border-emerald-500/30" },
  { key: "delivery",   label: "Delivery (محاضر التسليم)",    icon: <ClipboardCheck size={16} />, color: "from-teal-500/20 to-teal-500/5 border-teal-500/30" },
  { key: "other",      label: "Other (أخرى)",                icon: <FolderArchive size={16} />, color: "from-slate-500/20 to-slate-500/5 border-slate-500/30" },
];

// خريطة فئة المستندات المولّدة → قسم العرض
const DOC_CATEGORY_TO_SECTION: Record<ClaimDocCategory, SectionKey> = {
  claim_estimate: "estimates",
  tax_invoice: "invoices",
  delivery_proof: "delivery",
  inspection: "documents",
  claim_summary: "documents",
};

const isImageUrl = (u: string) => /\.(jpg|jpeg|png|webp|gif|heic|bmp)(\?|$)/i.test(u);
const isPdfUrl = (u: string) => /\.pdf(\?|$)/i.test(u);
const fileNameFromUrl = (u: string, fallback = "file") => {
  try { return decodeURIComponent(u.split("/").pop()?.split("?")[0] || fallback); }
  catch { return fallback; }
};

export default function ClaimArchivePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState<SectionKey | "all">("all");
  const [previewPdf, setPreviewPdf] = useState<ArchiveFile | null>(null);
  const [lightboxImages, setLightboxImages] = useState<{ id: string; dataUrl: string; caption?: string }[] | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [includeVehiclePhotos, setIncludeVehiclePhotos] = useState(true);
  const [includeDocuments, setIncludeDocuments] = useState(true);

  const settings = getTemplateSettings();
  const logo = settings.logoUrl;

  // ── جلب المطالبة + كل المصادر بالتوازي (READ ONLY) ──
  const { data, isLoading } = useQuery({
    queryKey: ["claim_archive", id],
    enabled: !!id,
    queryFn: async () => {
      // 1) المطالبة نفسها
      const { data: claim, error: claimErr } = await supabase
        .from("insurance_claims" as any)
        .select(`*, customer:customers(name, phone), vehicle:vehicles(brand, model, plate_number, year)`)
        .eq("id", id!)
        .maybeSingle();
      if (claimErr) throw claimErr;
      if (!claim) return null;

      const c: any = claim;

      // 2) سجلات المستندات المولّدة
      const { data: genDocs } = await supabase
        .from("claim_audit_logs")
        .select("id, category, file_path, details, created_at")
        .eq("claim_id", id!)
        .eq("action", "document_generated")
        .order("created_at", { ascending: false });
      const generatedRows = genDocs || [];
      const fresh = await refreshSignedUrls(
        "insurance-docs",
        generatedRows.map((d: any) => d.file_path).filter(Boolean),
      );
      const generatedDocs = generatedRows.map((d: any) => ({
        ...d,
        fresh_url: fresh.get(d.file_path) || d.details?.url || "",
      }));

      // 3) الفواتير الضريبية
      const { data: invoices } = await supabase
        .from("insurance_invoices" as any)
        .select("id, invoice_number, pdf_url, total, issued_at, status")
        .eq("claim_id", id!)
        .order("issued_at", { ascending: false });

      // 4) أمر العمل (إن وُجد) + صوره
      let workOrder: any = null;
      let workOrderInspections: any[] = [];
      const woId = c.auto_job_order_id || c.job_order_id;
      if (woId) {
        const { data: wo } = await supabase
          .from("job_orders")
          .select("id, order_number, status, description, diagnosis, created_at")
          .eq("id", woId)
          .maybeSingle();
        workOrder = wo;
        if (wo?.id) {
          const { data: insp } = await supabase
            .from("inspections")
            .select("id, photos, notes, damage_type, created_at")
            .eq("job_order_id", wo.id)
            .order("created_at", { ascending: false });
          workOrderInspections = insp || [];
        }
      }

      // 5) دفعات المطالبة
      const { data: payments } = await supabase
        .from("claim_payments" as any)
        .select("payment_number, amount, payment_method, payment_date, status, reference_number")
        .eq("claim_id", id!)
        .order("payment_date", { ascending: false });

      return { claim: c, genDocs: generatedDocs, invoices: invoices || [], workOrder, workOrderInspections, payments: (payments || []) as any[] };
    },
  });

  // ── تجميع كل الملفات في ArchiveFile[] ──
  const allFiles: ArchiveFile[] = useMemo(() => {
    if (!data) return [];
    const c = data.claim;
    const list: ArchiveFile[] = [];

    // Reception (لا حقل مخصص — نعتبر damage_photos الأقدم لاستلام)؟ نتركها فارغة افتراضياً.
    // لكن نعرض delivery_photos كاستلام/تسليم
    (c.satisfaction_photos || []).forEach((u: string, i: number) => list.push({
      id: `sat-${i}`, url: u, name: fileNameFromUrl(u, `satisfaction-${i + 1}.jpg`),
      kind: "image", section: "reception", meta: "صورة رضا/استلام",
    }));

    // Damage Photos
    (c.damage_photos || []).forEach((u: string, i: number) => list.push({
      id: `dmg-${i}`, url: u, name: fileNameFromUrl(u, `damage-${i + 1}.jpg`),
      kind: "image", section: "damage",
    }));

    // Documents (مرفقات التأمين العامة)
    (c.documents || []).forEach((d: any, i: number) => list.push({
      id: `doc-${i}`, url: d.url, name: d.name || fileNameFromUrl(d.url, `doc-${i + 1}`),
      kind: isPdfUrl(d.url) ? "pdf" : isImageUrl(d.url) ? "image" : "pdf",
      section: "documents", meta: d.type,
    }));

    // ID — هوية المستلم
    if (c.receiver_id_photo) list.push({
      id: "rid", url: c.receiver_id_photo, name: fileNameFromUrl(c.receiver_id_photo, "receiver-id.jpg"),
      kind: isImageUrl(c.receiver_id_photo) ? "image" : "pdf", section: "id",
      meta: c.receiver_name ? `هوية: ${c.receiver_name}` : "هوية المستلم",
    });

    // Delivery photos
    (c.delivery_photos || []).forEach((u: string, i: number) => list.push({
      id: `del-${i}`, url: u, name: fileNameFromUrl(u, `delivery-${i + 1}.jpg`),
      kind: "image", section: "delivery", meta: "صورة تسليم",
    }));

    // Work Order Photos (من inspections.photos)
    data.workOrderInspections.forEach((insp: any) => {
      (insp.photos || []).forEach((u: string, i: number) => list.push({
        id: `wo-${insp.id}-${i}`, url: u,
        name: fileNameFromUrl(u, `wo-photo-${i + 1}.jpg`),
        kind: "image", section: "workorder",
        meta: insp.damage_type ? `فحص: ${insp.damage_type}` : "صورة من أمر العمل",
        createdAt: insp.created_at,
      }));
    });

    // Generated PDFs (estimates/invoices/delivery/inspection/summary)
    data.genDocs.forEach((d: any) => {
      const url = d.fresh_url || d.details?.url;
      if (!url) return;
      const cat = (d.category || "claim_summary") as ClaimDocCategory;
      const section = DOC_CATEGORY_TO_SECTION[cat] || "documents";
      list.push({
        id: d.id,
        url,
        name: d.details?.file_name || d.file_path?.split("/").pop() || fileNameFromUrl(url),
        kind: (d.details?.mime_type || d.file_path || url).includes("pdf") ? "pdf" : isImageUrl(url) ? "image" : "pdf",
        section,
        createdAt: d.created_at,
        meta: claimDocLabel(cat, "ar"),
      });
    });

    // Insurance Invoices (PDF link directly on the row)
    data.invoices.forEach((inv: any) => {
      if (!inv.pdf_url) return;
      list.push({
        id: `inv-${inv.id}`,
        url: inv.pdf_url,
        name: `${inv.invoice_number}.pdf`,
        kind: "pdf",
        section: "invoices",
        createdAt: inv.issued_at,
        meta: `فاتورة • ${inv.status}`,
      });
    });

    return list;
  }, [data]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allFiles.filter((f) => {
      if (activeSection !== "all" && f.section !== activeSection) return false;
      if (!q) return true;
      return f.name.toLowerCase().includes(q) || (f.meta || "").toLowerCase().includes(q);
    });
  }, [allFiles, search, activeSection]);

  const counts = useMemo(() => {
    const m: Record<string, number> = { all: allFiles.length };
    SECTION_DEFS.forEach((s) => (m[s.key] = allFiles.filter((f) => f.section === s.key).length));
    return m;
  }, [allFiles]);

  // ── أوامر الملفات (Read-only، تستخدم الملف المخزن كما هو) ──
  const handlePreview = (f: ArchiveFile) => {
    if (f.kind === "image") {
      const imgs = filtered.filter((x) => x.kind === "image");
      const idx = imgs.findIndex((x) => x.url === f.url);
      setLightboxImages(imgs.map((x) => ({ id: x.id, dataUrl: x.url, caption: x.name })));
      setLightboxIndex(Math.max(0, idx));
    } else {
      setPreviewPdf(f);
    }
  };
  const handleDownload = async (f: ArchiveFile) => {
    try {
      const res = await fetch(f.url, { cache: "no-cache" });
      const blob = await res.blob();
      const u = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = u; a.download = f.name; a.rel = "noopener";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(u), 1500);
    } catch {
      window.open(f.url, "_blank");
    }
  };
  const handlePrint = (f: ArchiveFile) => {
    const w = window.open(f.url, "_blank");
    if (!w) { toast.error("الرجاء السماح بالنوافذ المنبثقة"); return; }
    if (f.kind === "pdf") {
      // المتصفح يفتح الـ PDF مع شريط طباعة جاهز
      setTimeout(() => { try { w.focus(); w.print(); } catch {} }, 800);
    }
  };
  const handleEmail = (f: ArchiveFile) => {
    const claim = data?.claim;
    const subject = `Claim Archive — ${claim?.claim_number || ""} — ${f.name}`;
    const body = [
      `مرفق ملف من أرشيف المطالبة: ${claim?.claim_number || ""}`,
      `العميل: ${claim?.customer?.name || claim?.vehicle_owner_name || ""}`,
      `المركبة: ${claim?.vehicle?.plate_number || claim?.vehicle_plate || ""}`,
      ``,
      `رابط الملف: ${f.url}`,
    ].join("\n");
    const mail = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mail;
  };

  // ── تصدير PDF موحّد لكل الأرشيف ──
  const handleExportUnifiedPdf = async () => {
    if (!data) return;
    setExporting(true);
    try {
      const sectionsForPdf = SECTION_DEFS
        .filter((s) => {
          if (!includeVehiclePhotos && VEHICLE_PHOTO_SECTIONS.has(s.key)) return false;
          if (!includeDocuments && (s.key === "documents" || s.key === "id" || s.key === "other")) return false;
          return true;
        })
        .map((s) => {
          const labelParts = s.label.split(" (");
          return {
            title: (labelParts[1] || s.label).replace(")", ""),
            titleEn: labelParts[0] || s.label,
            files: allFiles
              .filter((f) => f.section === s.key)
              .map<ArchiveSectionFile>((f) => ({
                url: f.url,
                name: f.name,
                kind: f.kind,
                meta: f.meta,
                createdAt: f.createdAt,
              })),
          };
        });
      await generateClaimArchivePdf({
        claim: data.claim as any,
        workOrder: data.workOrder as any,
        invoices: (data.invoices as any[]).map((i) => ({
          invoice_number: i.invoice_number,
          total: Number(i.total) || 0,
          status: i.status,
          issued_at: i.issued_at,
          pdf_url: i.pdf_url,
        })),
        payments: (data.payments as any[]).map((p) => ({
          payment_number: p.payment_number,
          amount: Number(p.amount) || 0,
          payment_method: p.payment_method,
          payment_date: p.payment_date,
          status: p.status,
          reference_number: p.reference_number,
        })),
        sections: sectionsForPdf,
      });
      toast.success("تم إنشاء ملف الأرشيف الموحّد");
      setExportDialogOpen(false);
    } catch (e: any) {
      console.error(e);
      toast.error(e.message || "فشل إنشاء الملف");
    } finally {
      setExporting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24 text-muted-foreground gap-2">
        <Loader2 size={18} className="animate-spin" /> جارٍ تحميل الأرشيف…
      </div>
    );
  }
  if (!data) {
    return (
      <div className="text-center py-20 text-muted-foreground">
        <FolderArchive size={40} className="mx-auto mb-2 opacity-30" />
        المطالبة غير موجودة
      </div>
    );
  }

  const c = data.claim;

  return (
    <div className="space-y-6">
      {/* رأس الصفحة + لوجو التطبيق */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          {logo ? (
            <img src={logo} alt="logo" className="w-12 h-12 rounded-lg object-contain bg-card border border-border p-1" />
          ) : (
            <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <FolderArchive size={22} />
            </div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              أرشيف المطالبة
              <Badge variant="outline" className="gap-1 text-[10px] border-emerald-500/40 text-emerald-400 bg-emerald-500/10">
                <Lock size={10} /> Read-Only
              </Badge>
            </h1>
            <p className="text-xs text-muted-foreground font-mono" dir="ltr">
              #{c.claim_number} · {c.customer?.name || c.vehicle_owner_name || "—"} · {c.vehicle?.plate_number || c.vehicle_plate || "—"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            onClick={() => setExportDialogOpen(true)}
            disabled={exporting || allFiles.length === 0}
            className="gap-1 bg-gradient-to-l from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white shadow"
          >
            {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            تصدير PDF موحّد
          </Button>
          <Button variant="outline" size="sm" onClick={() => navigate(-1)} className="gap-1">
            <ArrowRight size={14} /> رجوع
          </Button>
        </div>
      </div>

      {/* تنبيه: للعرض فقط */}
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[12px] text-amber-200 flex items-center gap-2">
        <Lock size={14} />
        هذه الصفحة <strong>للعرض فقط</strong> — لا تعديل ولا فتح للشاشات التشغيلية. كل الملفات هي <strong>نُسَخ ثابتة (Snapshots)</strong>.
      </div>

      {/* بطاقات تصنيف */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
        <button
          onClick={() => setActiveSection("all")}
          className={`text-right border rounded-lg p-3 transition ${
            activeSection === "all" ? "border-primary bg-primary/10" : "border-border bg-card hover:border-primary/40"
          }`}
        >
          <div className="flex items-center justify-between">
            <FolderArchive size={16} className="text-primary" />
            <span className="text-lg font-bold">{counts.all}</span>
          </div>
          <div className="text-[11px] text-muted-foreground mt-1">كل الملفات</div>
        </button>
        {SECTION_DEFS.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`text-right border rounded-lg p-3 transition bg-gradient-to-br ${s.color} ${
              activeSection === s.key ? "ring-2 ring-primary" : "hover:brightness-110"
            }`}
          >
            <div className="flex items-center justify-between">
              {s.icon}
              <span className="text-lg font-bold">{counts[s.key] || 0}</span>
            </div>
            <div className="text-[11px] text-foreground/80 mt-1 line-clamp-1">{s.label}</div>
          </button>
        ))}
      </div>

      {/* بحث */}
      <div className="relative max-w-md">
        <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث في الملفات…" className="pr-9" />
      </div>

      {/* قائمة الملفات */}
      {filtered.length === 0 ? (
        <Card className="bg-card border-border p-10 text-center text-muted-foreground text-sm">
          <FolderArchive size={36} className="mx-auto mb-2 opacity-30" />
          لا توجد ملفات في هذا التصنيف
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((f) => {
            const sec = SECTION_DEFS.find((s) => s.key === f.section);
            return (
              <Card key={f.id} className="bg-card border-border p-3 hover:border-primary/40 transition group">
                <div className="flex items-start gap-3">
                  {f.kind === "image" ? (
                    <button
                      onClick={() => handlePreview(f)}
                      className="w-16 h-16 rounded-lg overflow-hidden bg-muted border border-border shrink-0"
                    >
                      <img src={f.url} alt={f.name} loading="lazy" className="w-full h-full object-cover group-hover:scale-105 transition" />
                    </button>
                  ) : (
                    <div className="w-16 h-16 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                      <FileText size={26} />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 mb-0.5 flex-wrap">
                      <Badge variant="outline" className="text-[9px] gap-1">
                        {sec?.icon} {sec?.label.split(" (")[0]}
                      </Badge>
                      <Badge variant="secondary" className="text-[9px] uppercase">{f.kind}</Badge>
                    </div>
                    <p className="text-xs text-foreground truncate font-mono" dir="ltr" title={f.name}>{f.name}</p>
                    {f.meta && <p className="text-[10px] text-muted-foreground truncate">{f.meta}</p>}
                    {f.createdAt && (
                      <p className="text-[10px] text-muted-foreground font-mono mt-0.5" dir="ltr">
                        {new Date(f.createdAt).toLocaleString("en-GB")}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 mt-2 pt-2 border-t border-border">
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={() => handlePreview(f)}>
                    <Eye size={12} className="ml-1" /> عرض
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={() => handleDownload(f)}>
                    <Download size={12} className="ml-1" /> تحميل
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={() => handlePrint(f)}>
                    <Printer size={12} className="ml-1" /> طباعة
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 px-2 text-[11px] flex-1" onClick={() => handleEmail(f)}>
                    <Mail size={12} className="ml-1" /> بريد
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* معاينة PDF */}
      {previewPdf && (
        <ArchivedPdfPreviewDialog
          open={!!previewPdf}
          onOpenChange={(o) => !o && setPreviewPdf(null)}
          url={previewPdf.url}
          fileName={previewPdf.name}
          title={previewPdf.meta || previewPdf.name}
        />
      )}

      {/* معاينة الصور */}
      {lightboxImages && (
        <PhotoLightbox
          open={!!lightboxImages}
          onOpenChange={(o) => !o && setLightboxImages(null)}
          photos={lightboxImages}
          startIndex={lightboxIndex}
        />
      )}

      {/* خيارات تصدير PDF الموحّد */}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FolderArchive size={18} className="text-primary" />
              تصدير PDF موحّد للأرشيف
            </DialogTitle>
            <DialogDescription>
              اختر ما تريد تضمينه في الملف الموحّد. سيتم تجميع كل البيانات والمستندات والصور في ملف PDF واحد.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <Camera size={16} className="text-sky-500" />
                <div>
                  <Label htmlFor="inc-vehicle" className="text-sm font-medium cursor-pointer">صور المركبة</Label>
                  <p className="text-[11px] text-muted-foreground">صور الاستلام، الأضرار، أمر العمل، التسليم</p>
                </div>
              </div>
              <Switch id="inc-vehicle" checked={includeVehiclePhotos} onCheckedChange={setIncludeVehiclePhotos} />
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border bg-card p-3">
              <div className="flex items-center gap-2">
                <ShieldCheck size={16} className="text-violet-500" />
                <div>
                  <Label htmlFor="inc-docs" className="text-sm font-medium cursor-pointer">مستندات التأمين والهوية</Label>
                  <p className="text-[11px] text-muted-foreground">المستندات المرفقة + هوية المستلم</p>
                </div>
              </div>
              <Switch id="inc-docs" checked={includeDocuments} onCheckedChange={setIncludeDocuments} />
            </div>

            <div className="rounded-lg bg-muted/40 border border-border p-3 text-[11px] text-muted-foreground">
              ✓ يتم دائماً تضمين: بيانات المطالبة، أمر العمل، الفواتير، الدفعات، والتقديرات/الفواتير PDF.
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" size="sm" onClick={() => setExportDialogOpen(false)} disabled={exporting}>
              إلغاء
            </Button>
            <Button
              size="sm"
              onClick={handleExportUnifiedPdf}
              disabled={exporting}
              className="gap-1 bg-gradient-to-l from-blue-600 to-blue-500 hover:from-blue-700 hover:to-blue-600 text-white"
            >
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting ? "جارٍ التوليد…" : "تصدير الآن"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
