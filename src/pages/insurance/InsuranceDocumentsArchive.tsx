// أرشيف موحّد لكل مستندات التأمين المرفوعة (من جميع المطالبات)
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, FileText, Eye, Download, ExternalLink, Archive } from "lucide-react";
import { claimDocLabel, type ClaimDocCategory } from "@/lib/uploadHtmlAsPdf";
import ArchivedPdfPreviewDialog from "@/components/ArchivedPdfPreviewDialog";
import { refreshSignedUrls } from "@/lib/refreshSignedUrls";
import { queryKeys } from "@/lib/queryKeys";

interface ArchiveDoc {
  id: string;
  claim_id: string;
  category: ClaimDocCategory;
  file_path: string;
  url: string;
  file_name: string;
  created_at: string;
  claim_number?: string;
}

export default function InsuranceDocumentsArchive() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [cat, setCat] = useState<string>("all");
  const [preview, setPreview] = useState<ArchiveDoc | null>(null);

  const { data: docs = [], isLoading } = useQuery<ArchiveDoc[]>({
    queryKey: queryKeys.insuranceDocumentsArchive,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_audit_logs")
        .select("id, claim_id, category, file_path, details, created_at")
        .eq("action", "document_generated")
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      const rows = data || [];
      const fresh = await refreshSignedUrls(
        "insurance-docs",
        rows.map((r: any) => r.file_path).filter(Boolean),
      );
      const list: ArchiveDoc[] = rows.map((r: any) => ({
        id: r.id,
        claim_id: r.claim_id,
        category: (r.category || "claim_summary") as ClaimDocCategory,
        file_path: r.file_path || "",
        url: fresh.get(r.file_path) || r.details?.url || "",
        file_name: r.details?.file_name || r.file_path?.split("/").pop() || "document.pdf",
        created_at: r.created_at,
      }));
      // جلب أرقام المطالبات
      const claimIds = Array.from(new Set(list.map((d) => d.claim_id)));
      if (claimIds.length) {
        const { data: claims } = await supabase
          .from("insurance_claims")
          .select("id, claim_number")
          .in("id", claimIds);
        const map = new Map((claims || []).map((c: any) => [c.id, c.claim_number]));
        list.forEach((d) => (d.claim_number = map.get(d.claim_id)));
      }
      return list;
    },
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return docs.filter((d) => {
      if (cat !== "all" && d.category !== cat) return false;
      if (!q) return true;
      return (
        d.file_name.toLowerCase().includes(q) ||
        (d.claim_number || "").toLowerCase().includes(q)
      );
    });
  }, [docs, search, cat]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <Archive size={22} className="text-primary" /> أرشيف مستندات التأمين
        </h1>
        <p className="text-sm text-muted-foreground">جميع المستندات المرفوعة من مطالبات التأمين (تقديرات، فواتير، محاضر تسليم، تقارير فحص).</p>
      </div>

      <div className="bg-card border border-border rounded-xl p-4 shadow-card grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="relative md:col-span-2">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث باسم الملف أو رقم المطالبة..." className="pr-9" />
        </div>
        <Select value={cat} onValueChange={setCat}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">كل الفئات</SelectItem>
            <SelectItem value="claim_estimate">تقدير المطالبة</SelectItem>
            <SelectItem value="tax_invoice">فاتورة ضريبية</SelectItem>
            <SelectItem value="delivery_proof">محضر تسليم</SelectItem>
            <SelectItem value="inspection">تقرير فحص</SelectItem>
            <SelectItem value="claim_summary">ملخص المطالبة</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="bg-card border border-border rounded-xl shadow-card overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground text-sm">جاري التحميل...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center text-muted-foreground text-sm">
            <FileText size={40} className="mx-auto mb-2 opacity-30" />
            لا توجد مستندات في الأرشيف
          </div>
        ) : (
          <div className="divide-y divide-border">
            {filtered.map((d) => (
              <div key={d.id} className="flex items-center gap-3 p-3 hover:bg-secondary/20">
                <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <FileText size={16} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-sm text-foreground truncate">{d.file_name}</p>
                    <Badge variant="outline" className="text-[10px]">{claimDocLabel(d.category)}</Badge>
                  </div>
                  <p className="text-[11px] text-muted-foreground font-mono" dir="ltr">
                    {new Date(d.created_at).toLocaleString("en-US")} · {d.claim_number || d.claim_id.slice(0, 8)}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" onClick={() => setPreview(d)} title="معاينة" className="h-8 w-8 p-0">
                    <Eye size={14} />
                  </Button>
                  {d.url && (
                    <Button size="sm" variant="ghost" asChild title="تنزيل" className="h-8 w-8 p-0">
                      <a href={d.url} download={d.file_name} target="_blank" rel="noopener noreferrer"><Download size={14} /></a>
                    </Button>
                  )}
                  <Button size="sm" variant="outline" onClick={() => navigate(`/insurance/${encodeURIComponent(d.claim_id)}`)} className="gap-1 h-8 text-[11px]">
                    <ExternalLink size={12} /> المطالبة
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <ArchivedPdfPreviewDialog
        open={!!preview}
        onOpenChange={(o) => !o && setPreview(null)}
        url={preview?.url || ""}
        fileName={preview?.file_name || "document.pdf"}
        title={preview?.file_name || "مستند"}
      />
    </div>
  );
}
