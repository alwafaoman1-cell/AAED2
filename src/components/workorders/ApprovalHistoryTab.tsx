// تبويب سجل الموافقات داخل أمر العمل
import { useEffect, useState } from "react";
import { History, Eye, ExternalLink, CheckCircle2, Clock, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";

interface Request {
  id: string;
  token: string;
  status: "pending" | "signed" | "expired" | "cancelled";
  expires_at: string;
  signed_at: string | null;
  signer_ip: string | null;
  signer_user_agent: string | null;
  customer_name_snapshot: string | null;
  total_approved: number | null;
  signature_data_url: string | null;
  decisions: any;
  created_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function ApprovalHistoryTab({ jobOrderId }: { jobOrderId: string }) {
  const [requests, setRequests] = useState<Request[]>([]);
  const [viewing, setViewing] = useState<Request | null>(null);

  useEffect(() => {
    if (!UUID_RE.test(jobOrderId)) return;
    supabase.from("supplement_approval_requests")
      .select("*").eq("job_order_id", jobOrderId).order("created_at", { ascending: false })
      .then(({ data }) => setRequests((data as any) || []));
  }, [jobOrderId]);

  if (!UUID_RE.test(jobOrderId)) return null;
  if (requests.length === 0) return null;

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <h2 className="text-sm font-semibold flex items-center gap-2">
        <History size={16} className="text-primary"/> سجل موافقات العميل ({requests.length})
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs">
            <tr>
              <th className="text-right p-2">تاريخ الطلب</th>
              <th className="text-right p-2">الحالة</th>
              <th className="text-right p-2">تاريخ الموافقة</th>
              <th className="text-right p-2">الموقّع</th>
              <th className="text-right p-2">القيمة المعتمدة</th>
              <th className="text-right p-2">عرض</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((r) => {
              const isExpired = r.status === "pending" && new Date(r.expires_at) < new Date();
              const status = isExpired ? "expired" : r.status;
              return (
                <tr key={r.id} className="border-t border-border hover:bg-muted/20">
                  <td className="p-2 text-xs">{new Date(r.created_at).toLocaleString("en-GB")}</td>
                  <td className="p-2">
                    {status === "signed" && <Badge className="bg-success/15 text-success gap-1"><CheckCircle2 size={11}/> موقّع</Badge>}
                    {status === "pending" && <Badge className="bg-warning/15 text-warning gap-1"><Clock size={11}/> بانتظار</Badge>}
                    {status === "expired" && <Badge className="bg-muted text-muted-foreground gap-1"><XCircle size={11}/> منتهٍ</Badge>}
                    {status === "cancelled" && <Badge className="bg-destructive/15 text-destructive">ملغى</Badge>}
                  </td>
                  <td className="p-2 text-xs">{r.signed_at ? new Date(r.signed_at).toLocaleString("en-GB") : "—"}</td>
                  <td className="p-2 text-xs">{r.customer_name_snapshot || "—"}</td>
                  <td className="p-2 font-semibold">{r.total_approved ? Number(r.total_approved).toFixed(3) + " ر.ع" : "—"}</td>
                  <td className="p-2"><Button size="sm" variant="ghost" onClick={() => setViewing(r)}><Eye size={13}/></Button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-2xl" dir="rtl">
          <DialogHeader><DialogTitle>تفاصيل الموافقة</DialogTitle></DialogHeader>
          {viewing && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div><span className="text-muted-foreground">تاريخ الطلب:</span> {new Date(viewing.created_at).toLocaleString("en-GB")}</div>
                <div><span className="text-muted-foreground">تاريخ الموافقة:</span> {viewing.signed_at ? new Date(viewing.signed_at).toLocaleString("en-GB") : "—"}</div>
                <div><span className="text-muted-foreground">الموقّع:</span> {viewing.customer_name_snapshot || "—"}</div>
                <div><span className="text-muted-foreground">القيمة المعتمدة:</span> {viewing.total_approved ? Number(viewing.total_approved).toFixed(3) : "—"} ر.ع</div>
                <div><span className="text-muted-foreground">عنوان IP:</span> <span className="font-mono">{viewing.signer_ip || "—"}</span></div>
                <div className="col-span-2"><span className="text-muted-foreground">الجهاز:</span> <span className="font-mono text-[10px]">{viewing.signer_user_agent || "—"}</span></div>
              </div>
              {viewing.signature_data_url && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1">التوقيع الرقمي:</div>
                  <div className="border rounded bg-white p-2 inline-block">
                    <img src={viewing.signature_data_url} alt="signature" className="max-h-32"/>
                  </div>
                </div>
              )}
              <div>
                <div className="text-xs text-muted-foreground mb-1">القرارات:</div>
                <pre className="bg-muted/30 p-2 rounded text-[10px] overflow-x-auto">{JSON.stringify(viewing.decisions, null, 2)}</pre>
              </div>
              <Button size="sm" variant="outline" className="gap-1" onClick={() => window.open(`/c/approve/${viewing.token}`, "_blank")}>
                <ExternalLink size={13}/> فتح صفحة الموافقة
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
