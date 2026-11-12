import { useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowRight, Printer, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { inspectionsStore, type InspectionRecord } from "@/lib/inspectionsStore";
import { useTranslation } from "react-i18next";
import { insuranceInspectionStore } from "@/lib/insuranceInspectionStore";
import { getInspectionHtml } from "@/lib/pdfGenerator";
import { buildInsuranceInspectionHtml, generateInsuranceInspectionPdfBlob } from "@/lib/insuranceInspectionPdf";
import { generatePdfFromHtml, DEFAULT_MARGINS } from "@/lib/htmlToPdf";
import { toast } from "sonner";
import { printPdfBlob } from "@/lib/safePdfWindow";
import { PDF_HTML_SANDBOX, sanitizePdfHtml } from "@/lib/safeHtml";

/**
 * صفحة كاملة لتقرير الفحص — الافتراضي بدلاً من النوافذ المنبثقة.
 * - تختار قالب الفحص العام (ثنائي اللغة) أو قالب فحص التأمين (Al Madina) تلقائياً.
 * - تتزامن مع آخر بيانات محفوظة (subscribe على المتجرين + sync بين التبويبات).
 * - زر رجوع ذكي: يستخدم history إن وُجد، وإلا يعود لقائمة الفحص.
 */
export default function InspectionReportPage() {
  const { i18n } = useTranslation();
  const isArabic = i18n.language?.startsWith("ar") ?? true;
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [reload, setReload] = useState(0);
  const [reportState, setReportState] = useState<{ id?: string; record?: InspectionRecord; loading: boolean; error: string | null }>({ loading: true, error: null });

  // Direct links load exactly one full record, never the entire inspection list.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    let cancelled = false;
    let loading = false;
    let invalidated = false;
    const load = async () => {
      if (loading) return;
      loading = true;
      invalidated = false;
      setReportState({ id, loading: true, error: null });
      try {
        const record = id ? await inspectionsStore.loadById(id) : undefined;
        if (record?.kind === "insurance" && !record.details?.insuranceInspectionReport) {
          // Legacy reports may still live in the cloud settings archive. Await
          // that explicit detail read before displaying a minimal fallback.
          await insuranceInspectionStore.load(record.id);
        }
        if (!cancelled && !invalidated) setReportState({ id, record, loading: false, error: null });
      } catch (error: any) {
        if (!cancelled && !invalidated) setReportState({ id, loading: false, error: error?.message || "Could not load report" });
      } finally {
        loading = false;
        if (!cancelled && invalidated) void load();
      }
    };
    const u1 = inspectionsStore.subscribe(() => {
      if (cancelled || !id) return;
      const record = inspectionsStore.getById(id);
      if (!record?.details) {
        invalidated = true;
        setReportState({ id, loading: true, error: null });
        void load();
      } else if (!loading) {
        setReportState({ id, record, loading: false, error: null });
      }
    }, { loadSummaries: false });
    const u2 = insuranceInspectionStore.subscribe(() => setTick(t => t + 1));
    void load();
    return () => { cancelled = true; u1(); u2(); };
  }, [id, reload]);

  const ins = reportState.id === id && !reportState.loading && !reportState.error ? reportState.record : undefined;
  const isInsurance = ins?.kind === "insurance";
  const insurancePayload = useMemo(
    () => { void tick; return ins && isInsurance ? insuranceInspectionStore.get(ins.id) : undefined; },
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
  const safeHtml = useMemo(() => html ? sanitizePdfHtml(html) : "", [html]);

  const createPdf = async (download: boolean) => {
    if (!ins) throw new Error("التقرير غير موجود");
    return insurancePayload
      ? generateInsuranceInspectionPdfBlob(insurancePayload, `Inspection_${ins.id}`, download)
      : generatePdfFromHtml({
          htmlContent: safeHtml,
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
    setReload(value => value + 1);
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
        <div role={reportState.error ? "alert" : "status"} className="text-center py-16 text-muted-foreground">
          {reportState.id !== id || reportState.loading
            ? (isArabic ? "جارٍ تحميل تقرير الفحص..." : "Loading inspection report...")
            : reportState.error
              ? `${isArabic ? "تعذر تحميل التقرير" : "Could not load report"}: ${reportState.error}`
              : <>{isArabic ? "لم يتم العثور على تقرير الفحص" : "Inspection report not found"} <span className="font-mono">{id}</span></>}
          {reportState.error && <Button variant="outline" size="sm" onClick={handleRefresh} className="mx-2">{isArabic ? "إعادة المحاولة" : "Retry"}</Button>}
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
            <Button variant="outline" size="sm" onClick={handlePrint} disabled={busy} className="gap-1">
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
          srcDoc={safeHtml}
          sandbox={PDF_HTML_SANDBOX}
          className="w-full bg-white"
          style={{ height: "calc(100vh - 220px)", minHeight: 600, border: 0 }}
        />
      </div>
    </div>
  );
}
