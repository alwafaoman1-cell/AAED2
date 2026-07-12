import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Archive, ArrowRight, Edit3, ExternalLink, FileDown, Printer, Send, ShieldAlert, Workflow } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  convertUnifiedEstimate,
  getUnifiedEstimate,
  issueUnifiedEstimate,
  type EstimateConversionTarget,
} from "@/lib/unifiedEstimates";

export default function EstimateDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [previewOpen, setPreviewOpen] = useState(false);
  const [conversionTarget, setConversionTarget] = useState<EstimateConversionTarget | null>(null);

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

  const conversionMut = useMutation({
    mutationFn: (target: EstimateConversionTarget) => convertUnifiedEstimate(id!, target),
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["unified-estimate", id] });
      qc.invalidateQueries({ queryKey: ["unified-estimates"] });
      qc.invalidateQueries({ queryKey: ["insurance_claims"] });
      qc.invalidateQueries({ queryKey: ["work-orders"] });
      setConversionTarget(null);
      toast.success(result.message);
      if (result.target_entity_type === "work_order" && result.target_number) {
        navigate(`/work-orders/${encodeURIComponent(result.target_number)}`);
      } else if (result.target_entity_type === "insurance_claim" && result.target_entity_id) {
        navigate(`/insurance/${result.target_entity_id}`);
      }
    },
    onError: (e: any) => toast.error(e?.message || "فشل تحويل التقدير"),
  });

  if (isLoading) return <Card className="p-8 text-center text-muted-foreground">جاري التحميل...</Card>;
  if (error || !estimate) return <Card className="p-8 text-center text-destructive">{(error as Error)?.message || "التقدير غير موجود"}</Card>;

  const html = buildEstimatePdfHtml(estimate);
  const customerLabel = `${estimate.customer?.customer_code || ""} ${estimate.customer?.name || "—"}`.trim();
  const vehicleLabel = [estimate.vehicle?.brand || estimate.vehicle?.make, estimate.vehicle?.model, estimate.vehicle?.year, estimate.vehicle?.plate_number].filter(Boolean).join(" • ") || "—";
  const selectedTargetLabel =
    conversionTarget === "work_order" ? "أمر عمل" :
    conversionTarget === "insurance_claim" ? "مطالبة تأمين" :
    conversionTarget === "insurance_work_order" ? "أمر عمل تأميني" :
    conversionTarget === "supplementary_link" ? "ربط التقدير الإضافي" : "—";

  function printEstimate() {
    const win = openAndPrintWindow(html);
    if (!win) toast.error("المتصفح منع نافذة الطباعة. استخدم تحميل PDF.");
  }

  async function downloadEstimate() {
    await generatePdfFromHtml({ htmlContent: html, fileName: `Estimate-${estimate.estimate_number}` });
  }

  function openLinkedWorkOrder() {
    if (estimate.work_order?.order_number) navigate(`/work-orders/${encodeURIComponent(estimate.work_order.order_number)}`);
    else if (estimate.work_order_id) navigate(`/work-orders/${estimate.work_order_id}`);
  }

  function openLinkedClaim() {
    if (estimate.claim_id) navigate(`/insurance/${estimate.claim_id}`);
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
          <p className="text-sm text-muted-foreground">تقدير موحد — السعر قبل الضريبة وVAT يضاف فوقه.</p>
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
            <Info label="العميل" value={customerLabel} />
            <Info label="الهاتف" value={estimate.customer?.phone || "—"} />
            <Info label="المركبة" value={[estimate.vehicle?.brand || estimate.vehicle?.make, estimate.vehicle?.model, estimate.vehicle?.year].filter(Boolean).join(" ") || "—"} />
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

          <Card className="p-4 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold flex items-center gap-2"><Workflow size={16} /> التحويلات</h2>
                <p className="text-xs text-muted-foreground">كل تحويل يفحص السجلات الموجودة أولًا ويمنع إنشاء duplicates.</p>
              </div>
              {estimate.status === "converted" && <Badge variant="secondary">Converted</Badge>}
            </div>

            {(estimate.claim_id || estimate.work_order_id) && (
              <Alert>
                <ShieldAlert size={16} />
                <AlertTitle>يوجد سجل مرتبط مسبقًا</AlertTitle>
                <AlertDescription className="flex flex-wrap gap-2 pt-2">
                  {estimate.claim_id && (
                    <Button size="sm" variant="outline" onClick={openLinkedClaim} className="gap-1">
                      <ExternalLink size={14} /> فتح المطالبة
                    </Button>
                  )}
                  {estimate.work_order_id && (
                    <Button size="sm" variant="outline" onClick={openLinkedWorkOrder} className="gap-1">
                      <ExternalLink size={14} /> فتح أمر العمل
                    </Button>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <div className="flex flex-wrap gap-2">
              {estimate.estimate_type === "independent" && (
                <Button variant="outline" onClick={() => setConversionTarget("work_order")} className="gap-2">
                  تحويل إلى أمر عمل
                </Button>
              )}
              {estimate.estimate_type === "insurance" && (
                <>
                  <Button variant="outline" onClick={() => setConversionTarget("insurance_claim")} className="gap-2">
                    تحويل/ربط مطالبة
                  </Button>
                  <Button variant="outline" onClick={() => setConversionTarget("insurance_work_order")} className="gap-2">
                    تحويل/ربط أمر عمل تأميني
                  </Button>
                </>
              )}
              {estimate.estimate_type === "supplementary" && (
                <Button variant="outline" onClick={() => setConversionTarget("supplementary_link")} className="gap-2">
                  ربط بالتقدير الأصلي
                </Button>
              )}
            </div>
          </Card>
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

      <Dialog open={Boolean(conversionTarget)} onOpenChange={(open) => !open && setConversionTarget(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>تأكيد التحويل</DialogTitle>
            <DialogDescription>
              سيتم فحص السجلات المرتبطة قبل الإنشاء. إذا وجد سجل سابق سيتم استخدامه بدل إنشاء duplicate.
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <Info label="Estimate Number" value={estimate.estimate_number} />
            <Info label="Type" value={ESTIMATE_TYPE_LABEL[estimate.estimate_type].ar} />
            <Info label="Customer" value={customerLabel} />
            <Info label="Vehicle" value={vehicleLabel} />
            <Info label="Claim" value={estimate.claim?.claim_number || "—"} />
            <Info label="Total" value={formatOMR(estimate.total)} />
            <Info label="Target" value={selectedTargetLabel} />
            <Info
              label="Existing linked record"
              value={[
                estimate.claim?.claim_number ? `Claim ${estimate.claim.claim_number}` : null,
                estimate.work_order?.order_number ? `WO ${estimate.work_order.order_number}` : null,
              ].filter(Boolean).join(" / ") || "لا يوجد ظاهرًا — سيتم الفحص عند التأكيد"}
            />
          </div>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button variant="outline" onClick={() => setConversionTarget(null)}>Cancel</Button>
            {estimate.claim_id && (
              <Button variant="secondary" onClick={openLinkedClaim} className="gap-1">
                <ExternalLink size={14} /> Open Existing Claim
              </Button>
            )}
            {estimate.work_order_id && (
              <Button variant="secondary" onClick={openLinkedWorkOrder} className="gap-1">
                <ExternalLink size={14} /> Open Existing WO
              </Button>
            )}
            <Button
              onClick={() => conversionTarget && conversionMut.mutate(conversionTarget)}
              disabled={!conversionTarget || conversionMut.isPending}
            >
              Confirm Conversion
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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
