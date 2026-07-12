import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Archive, Edit3, FileDown, Printer, Send, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { generatePdfFromHtml } from "@/lib/htmlToPdf";
import { openAndPrintWindow } from "@/lib/safePdfWindow";
import { buildEstimatePdfHtml } from "@/lib/estimatePdf";
import { formatOMR } from "@/lib/money";
import {
  ESTIMATE_CATEGORY_LABEL,
  ESTIMATE_STATUS_LABEL,
  ESTIMATE_TYPE_LABEL,
  archiveUnifiedEstimate,
  getUnifiedEstimate,
  issueUnifiedEstimate,
} from "@/lib/unifiedEstimates";

export default function EstimateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const { data: estimate, isLoading, error } = useQuery({
    queryKey: ["unified-estimate", id],
    queryFn: () => getUnifiedEstimate(id!),
    enabled: Boolean(id),
  });

  const issueMut = useMutation({
    mutationFn: () => issueUnifiedEstimate(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["unified-estimate", id] });
      qc.invalidateQueries({ queryKey: ["unified-estimates"] });
      toast.success("تم إصدار التقدير");
    },
    onError: (e: any) => toast.error(e?.message || "فشل إصدار التقدير"),
  });

  const archiveMut = useMutation({
    mutationFn: () => archiveUnifiedEstimate(id!),
    onSuccess: () => {
      toast.success("تمت أرشفة التقدير");
      navigate("/estimates");
    },
    onError: (e: any) => toast.error(e?.message || "فشل الأرشفة"),
  });

  if (isLoading) return <Card className="p-8 text-center text-muted-foreground">جاري التحميل...</Card>;
  if (error || !estimate) return <Card className="p-8 text-center text-destructive">{(error as Error)?.message || "التقدير غير موجود"}</Card>;

  const html = buildEstimatePdfHtml(estimate);

  function printEstimate() {
    const win = openAndPrintWindow(html);
    if (!win) toast.error("المتصفح منع نافذة الطباعة. استخدم تحميل PDF.");
  }

  async function downloadEstimate() {
    await generatePdfFromHtml({ htmlContent: html, fileName: `Estimate-${estimate.estimate_number}` });
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold" dir="ltr">{estimate.estimate_number}</h1>
            <Badge>{ESTIMATE_TYPE_LABEL[estimate.estimate_type].ar}</Badge>
            <Badge variant="secondary">{ESTIMATE_STATUS_LABEL[estimate.status].ar}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">تقدير موحد — السعر قبل الضريبة والـ VAT يضاف فوقه.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/estimates")} className="gap-2"><ArrowRight size={16} /> رجوع</Button>
          <Button variant="outline" onClick={() => navigate(`/estimates/${estimate.id}/edit`)} className="gap-2"><Edit3 size={16} /> تعديل</Button>
          <Button variant="outline" onClick={() => setPreviewOpen(true)} className="gap-2"><Printer size={16} /> معاينة</Button>
          <Button variant="outline" onClick={printEstimate} className="gap-2"><Printer size={16} /> طباعة</Button>
          <Button variant="outline" onClick={downloadEstimate} className="gap-2"><FileDown size={16} /> PDF</Button>
          {estimate.status === "draft" && (
            <Button onClick={() => issueMut.mutate()} disabled={issueMut.isPending} className="gap-2"><Send size={16} /> إصدار</Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          <Card className="p-4 grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Info label="العميل" value={`${estimate.customer?.customer_code || ""} ${estimate.customer?.name || "—"}`} />
            <Info label="الهاتف" value={estimate.customer?.phone || "—"} />
            <Info label="المركبة" value={[estimate.vehicle?.make, estimate.vehicle?.model, estimate.vehicle?.year].filter(Boolean).join(" ") || "—"} />
            <Info label="اللوحة" value={estimate.vehicle?.plate_number || "—"} />
            <Info label="المطالبة" value={estimate.claim?.claim_number || "—"} />
            <Info label="أمر العمل" value={estimate.work_order?.order_number || "—"} />
            <Info label="تاريخ التقدير" value={estimate.estimate_date || "—"} />
            <Info label="صالح حتى" value={estimate.valid_until || "—"} />
          </Card>

          <Card className="p-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-right p-2">#</th>
                  <th className="text-right p-2">الفئة</th>
                  <th className="text-right p-2">الوصف</th>
                  <th className="text-right p-2">الكمية</th>
                  <th className="text-right p-2">السعر</th>
                  <th className="text-right p-2">VAT</th>
                  <th className="text-right p-2">الإجمالي</th>
                </tr>
              </thead>
              <tbody>
                {(estimate.items || []).map((item, index) => (
                  <tr key={item.id} className="border-b">
                    <td className="p-2">{index + 1}</td>
                    <td className="p-2">{ESTIMATE_CATEGORY_LABEL[item.category]?.ar || item.category}</td>
                    <td className="p-2">{item.description_ar || item.description_en || "—"}</td>
                    <td className="p-2" dir="ltr">{Number(item.quantity).toFixed(3)}</td>
                    <td className="p-2">{formatOMR(item.unit_price)}</td>
                    <td className="p-2">{formatOMR(item.vat_amount)}</td>
                    <td className="p-2 font-semibold">{formatOMR(item.line_total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>

          <Alert>
            <ShieldAlert size={16} />
            <AlertTitle>التحويلات</AlertTitle>
            <AlertDescription>
              التحويل إلى أمر عمل أو مطالبة سيُفعل عبر نفس المحرك لاحقًا بعد ربط منع التكرار بالكامل. لم يتم تنفيذ تحويل ناقص حتى لا ينشئ duplicate.
            </AlertDescription>
          </Alert>
        </div>

        <div className="space-y-4">
          <Card className="p-4 space-y-2">
            <div className="flex justify-between"><span>Subtotal before VAT</span><strong>{formatOMR(estimate.subtotal)}</strong></div>
            <div className="flex justify-between"><span>VAT {Number(estimate.vat_rate).toFixed(2)}%</span><strong>{formatOMR(estimate.vat_amount)}</strong></div>
            <div className="flex justify-between border-t pt-2 text-lg"><span>Total</span><strong>{formatOMR(estimate.total)}</strong></div>
          </Card>
          <Card className="p-4 space-y-2">
            <h2 className="font-semibold">ملاحظات وشروط</h2>
            <p className="text-sm whitespace-pre-wrap text-muted-foreground">{estimate.terms || estimate.notes || "—"}</p>
          </Card>
          <Button variant="destructive" onClick={() => archiveMut.mutate()} disabled={archiveMut.isPending} className="w-full gap-2">
            <Archive size={16} /> أرشفة
          </Button>
        </div>
      </div>

      <PdfPreviewDialog
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        htmlContent={html}
        title={`Estimate ${estimate.estimate_number}`}
        fileName={`Estimate-${estimate.estimate_number}`}
      />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="font-semibold">{value}</div>
    </div>
  );
}

