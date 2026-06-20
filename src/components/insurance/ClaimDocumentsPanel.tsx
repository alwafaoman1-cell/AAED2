// لوحة موحدة لكل المستندات المولّدة لمطالبة معينة
// تعرضها صفحة المطالبة في تبويب "ملخّص" أو "المستندات"
import { useState } from "react";
import { useClaimDocuments, type ClaimGeneratedDoc } from "@/hooks/useClaimDocuments";
import { claimDocLabel, type ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, Eye, Download, Receipt, ClipboardCheck, Truck, Calculator, FileBarChart2, Archive, Loader2, MessageCircle } from "lucide-react";
import ArchivedPdfPreviewDialog from "@/components/ArchivedPdfPreviewDialog";
import JSZip from "jszip";
import { toast } from "sonner";
import { openWhatsAppShareLink } from "@/lib/whatsappShare";

const ICON_MAP: Record<ClaimDocCategory, JSX.Element> = {
  claim_estimate: <Calculator size={16} />,
  tax_invoice: <Receipt size={16} />,
  delivery_proof: <Truck size={16} />,
  inspection: <ClipboardCheck size={16} />,
  claim_summary: <FileBarChart2 size={16} />,
};
const COLOR_MAP: Record<ClaimDocCategory, string> = {
  claim_estimate: "bg-blue-500/15 text-blue-400 border-blue-500/30",
  tax_invoice: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  delivery_proof: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  inspection: "bg-violet-500/15 text-violet-400 border-violet-500/30",
  claim_summary: "bg-slate-500/15 text-slate-400 border-slate-500/30",
};

export default function ClaimDocumentsPanel({ claimId }: { claimId: string }) {
  const { data: docs = [], isLoading } = useClaimDocuments(claimId);
  const [previewDoc, setPreviewDoc] = useState<ClaimGeneratedDoc | null>(null);
  const [zipping, setZipping] = useState(false);

  const downloadAllAsZip = async () => {
    if (docs.length === 0) {
      toast.error("لا توجد مستندات لتصديرها");
      return;
    }
    setZipping(true);
    try {
      const zip = new JSZip();
      let added = 0;
      for (const d of docs) {
        if (!d.url) continue;
        try {
          const res = await fetch(d.url);
          if (!res.ok) continue;
          const blob = await res.blob();
          // ترتيب داخل ZIP حسب الفئة
          const folder = zip.folder(d.category) || zip;
          folder.file(d.file_name || `doc-${added + 1}.pdf`, blob);
          added++;
        } catch (e) {
          console.warn("download doc failed", d.file_name, e);
        }
      }
      if (added === 0) {
        toast.error("تعذر تحميل أي ملف");
        return;
      }
      const out = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(out);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Claim-Documents-${claimId.slice(0, 8)}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      toast.success(`تم تصدير ${added} ملف في ZIP`);
    } catch (e: any) {
      toast.error("فشل إنشاء ZIP: " + (e?.message || "خطأ"));
    } finally {
      setZipping(false);
    }
  };

  // مجموعة بحسب التصنيف لإظهار الأحدث في كل فئة
  const grouped = docs.reduce<Record<ClaimDocCategory, ClaimGeneratedDoc[]>>((acc, d) => {
    (acc[d.category] = acc[d.category] || []).push(d);
    return acc;
  }, {} as any);

  const allCategories: ClaimDocCategory[] = ["claim_estimate", "tax_invoice", "delivery_proof", "inspection", "claim_summary"];

  if (isLoading) {
    return <div className="text-center py-8 text-muted-foreground text-sm">جارٍ تحميل المستندات…</div>;
  }

  return (
    <Card className="bg-card border-border p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
          <FileText size={18} className="text-primary" />
          أرشيف مستندات المطالبة
          <span className="text-xs text-muted-foreground font-normal">({docs.length} ملف)</span>
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={downloadAllAsZip}
          disabled={zipping || docs.length === 0}
          className="gap-1.5"
          title="تنزيل جميع المستندات كملف مضغوط"
        >
          {zipping ? <Loader2 size={14} className="animate-spin" /> : <Archive size={14} />}
          تصدير الكل (ZIP)
        </Button>
      </div>

      {docs.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-border rounded-lg text-muted-foreground text-sm">
          لا توجد مستندات محفوظة بعد. سيتم حفظ كل مستند تقوم بمعاينته هنا تلقائياً.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {allCategories
            .filter((c) => grouped[c]?.length)
            .map((cat) => {
              const list = grouped[cat];
              const latest = list[0];
              return (
                <div key={cat} className={`border rounded-lg p-3 ${COLOR_MAP[cat]}`}>
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2 text-xs font-semibold">
                      {ICON_MAP[cat]}
                      {claimDocLabel(cat, "ar")}
                    </div>
                    <Badge variant="outline" className="text-[10px] bg-background/40 border-current">
                      {list.length}
                    </Badge>
                  </div>
                  <div className="text-[11px] text-foreground/80 truncate font-mono mb-1">{latest.file_name}</div>
                  <div className="text-[10px] text-muted-foreground mb-3">
                    {new Date(latest.created_at).toLocaleString("en-GB", {
                      year: "numeric", month: "2-digit", day: "2-digit",
                      hour: "2-digit", minute: "2-digit",
                    })}
                  </div>
                  <div className="flex gap-1.5">
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] flex-1 bg-background/60 hover:bg-background"
                      onClick={() => setPreviewDoc(latest)}
                    >
                      <Eye size={12} className="ml-1" />
                      معاينة
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] flex-1 bg-background/60 hover:bg-background"
                      onClick={() => {
                        const a = document.createElement("a");
                        a.href = latest.url;
                        a.download = latest.file_name;
                        a.target = "_blank";
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                      }}
                    >
                      <Download size={12} className="ml-1" />
                      تنزيل
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      className="h-7 px-2 text-[11px] bg-emerald-500/15 text-emerald-500 hover:bg-emerald-500/25"
                      onClick={() => openWhatsAppShareLink({ pdfUrl: latest.url, caption: latest.file_name })}
                      title="مشاركة عبر واتساب"
                    >
                      <MessageCircle size={12} />
                    </Button>
                  </div>
                  {list.length > 1 && (
                    <details className="mt-2">
                      <summary className="text-[10px] text-muted-foreground cursor-pointer hover:text-foreground">
                        الإصدارات السابقة ({list.length - 1})
                      </summary>
                      <div className="mt-1 space-y-1">
                        {list.slice(1).map((d) => (
                          <button
                            key={d.id}
                            type="button"
                            onClick={() => setPreviewDoc(d)}
                            className="block text-[10px] text-muted-foreground hover:text-foreground truncate text-right w-full"
                          >
                            • {new Date(d.created_at).toLocaleString("en-GB")}
                          </button>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              );
            })}
        </div>
      )}

      {previewDoc && (
        <ArchivedPdfPreviewDialog
          open={!!previewDoc}
          onOpenChange={(o) => !o && setPreviewDoc(null)}
          url={previewDoc.url}
          fileName={previewDoc.file_name}
          title={`${claimDocLabel(previewDoc.category, "ar")} — ${previewDoc.file_name}`}
        />
      )}
    </Card>
  );
}
