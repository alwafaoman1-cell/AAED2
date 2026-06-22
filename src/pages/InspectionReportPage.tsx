import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowRight, Printer, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inspectionsStore } from "@/lib/inspectionsStore";
import { insuranceInspectionStore } from "@/lib/insuranceInspectionStore";
import { getInspectionHtml } from "@/lib/pdfGenerator";
import { buildInsuranceInspectionHtml, generateInsuranceInspectionPdfBlob } from "@/lib/insuranceInspectionPdf";
import { generatePdfFromHtml, DEFAULT_MARGINS } from "@/lib/htmlToPdf";
import { toast } from "sonner";
import { printPdfBlob } from "@/lib/safePdfWindow";

/**
 * صفحة كاملة لتقرير الفحص — الافتراضي بدلاً من النوافذ المنبثقة.
 * - تختار قالب الفحص العام (ثنائي اللغة) أو قالب فحص التأمين (Al Madina) تلقائياً.
 * - تتزامن مع آخر بيانات محفوظة (subscribe على المتجرين + sync بين التبويبات).
 * - زر رجوع ذكي: يستخدم history إن وُجد، وإلا يعود لقائمة الفحص.
 */
export default function InspectionReportPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  // Re-render when either store changes (live sync with last saved data)
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const u1 = inspectionsStore.subscribe(() => setTick(t => t + 1));
    const u2 = insuranceInspectionStore.subscribe(() => setTick(t => t + 1));
    return () => { u1?.(); u2?.(); };
  }, []);

  const ins = useMemo(
    () => inspectionsStore.getAll().find(i => i.id === id),
    [id, tick]
  );
  const isInsurance = ins?.kind === "insurance";
  const insurancePayload = useMemo(
    () => (ins && isInsurance ? insuranceInspectionStore.get(ins.id) : undefined),
    [ins, isInsurance, tick]
  );

  const html = useMemo(() => {
    if (!ins) return "";
    if (isInsurance) {
      if (insurancePayload) return buildInsuranceInspectionHtml(insurancePayload);
      // Fallback minimal payload when older records lack the detailed data
      return buildInsuranceInspectionHtml({
        reportNo: ins.id,
        date: ins.date,
        claimNo: "",
        regNo: "",
        gatePass: "",
        garageName: "Alwafa Integrated Services",
        makeModel: ins.vehicle,
        modelYear: "",
        area: "",
        type: "",
        workshopGrade: "A",
        insuranceCompany: ins.damageType.replace(/^Insurance Inspection — /, ""),
        remarks: "",
        surveyorName: "",
        sections: [],
        annotatedImages: [],
      });
    }
    return getInspectionHtml({
      inspectionId: ins.id,
      workOrderId: ins.workOrder,
      date: ins.date,
      customerName: ins.customer,
      vehicleInfo: ins.vehicle,
      damageType: ins.damageType,
      photoCount: ins.photos,
      status: ins.status,
    });
  }, [ins, isInsurance, insurancePayload]);

  const createPdf = async (download: boolean) => {
    if (!ins) throw new Error("التقرير غير موجود");
    return insurancePayload
      ? generateInsuranceInspectionPdfBlob(insurancePayload, `Inspection_${ins.id}`, download)
      : generatePdfFromHtml({
          htmlContent: html,
          fileName: `Inspection_${ins.id}`,
          download,
          margins: DEFAULT_MARGINS,
        });
  };

  const handlePrint = async () => {
    setBusy(true);
    try {
      await printPdfBlob(await createPdf(false));
    } catch (error: any) {
      toast.error(error?.message || "تعذرت طباعة PDF");
    } finally {
      setBusy(false);
    }
  };

  const handleDownload = async () => {
    if (!ins) return;
    setBusy(true);
    try {
      const blob = await createPdf(true);
      if (blob.size === 0) throw new Error("ملف PDF فارغ");
      toast.success("تم تنزيل ملف PDF");
    } catch (e) {
      console.error("Inspection PDF download failed:", e);
      toast.error("تعذّر تنزيل التقرير: " + ((e as Error)?.message || "خطأ غير معروف"));
    } finally {
      setBusy(false);
    }
  };

  // Smart back: prefer browser history when we got here from inside the app
  const handleBack = () => {
    if (window.history.length > 1) navigate(-1);
    else navigate("/inspection");
  };

  const handleRefresh = () => {
    setTick(t => t + 1);
    toast.success("تم تحديث البيانات");
  };

  // Format last-saved time (only available for insurance inspections we tracked)
  const lastSavedLabel = useMemo(() => {
    const iso = insurancePayload?._savedAt;
    if (!iso) return null;
    try {
      const d = new Date(iso);
      return d.toLocaleString("en-GB", { hour12: false });
    } catch { return null; }
  }, [insurancePayload]);

  if (!ins) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={handleBack} className="gap-1">
          <ArrowRight size={14} /> رجوع
        </Button>
        <div className="text-center py-16 text-muted-foreground">
          لم يتم العثور على تقرير الفحص <span className="font-mono">{id}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Sticky toolbar — keeps Back/Print/Download visible while scrolling */}
      <div className="sticky top-0 z-20 -mx-4 md:mx-0 px-4 md:px-0 py-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 border-b border-border md:border-0 md:bg-transparent md:backdrop-blur-0 md:py-0">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleBack}
              className="gap-1 shrink-0 border-border"
              title="رجوع"
            >
              <ArrowRight size={16} /> رجوع
            </Button>
            <div className="min-w-0">
              <h1 className="text-base md:text-xl font-bold text-foreground truncate flex items-center gap-2">
                تقرير فحص <span className="font-mono text-primary">{ins.id}</span>
                {isInsurance && (
                  <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-info/15 text-info border border-info/30">
                    Insurance
                  </span>
                )}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {ins.customer} — {ins.vehicle} • {ins.date}
                {lastSavedLabel && (
                  <span className="ml-2 text-success/80">
                    • آخر حفظ: <span className="font-mono">{lastSavedLabel}</span>
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button variant="ghost" size="sm" onClick={handleRefresh} className="gap-1" title="تحديث من آخر بيانات محفوظة">
              <RefreshCw size={14} /> تحديث
            </Button>
            <Button variant="outline" size="sm" onClick={handlePrint} className="gap-1">
              <Printer size={14} /> طباعة
            </Button>
            <Button size="sm" onClick={handleDownload} disabled={busy} className="gradient-gold text-primary-foreground gap-1">
              <Download size={14} /> {busy ? "جارٍ التحضير..." : "تنزيل PDF"}
            </Button>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-border bg-neutral-200 dark:bg-neutral-900 overflow-hidden">
        <iframe
          id="ins-report-frame"
          title={`Inspection ${ins.id}`}
          srcDoc={html}
          className="w-full bg-white"
          style={{ height: "calc(100vh - 220px)", minHeight: 600, border: 0 }}
        />
      </div>
    </div>
  );
}
