import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import VehicleDiagram from "./VehicleDiagram";
import { BrainCircuit, ChevronLeft, ChevronRight, Save, FileText, Link as LinkIcon, Loader2, Upload } from "lucide-react";
import { generateInspectionReportPdf } from "@/lib/inspectionPdfGenerator";
import { getWorkOrders, getWorkOrderById } from "@/lib/workOrdersStore";
import { inspectionsStore, findInspectionByPlate } from "@/lib/inspectionsStore";
import { logActivity } from "@/lib/auditLogStore";
import { toast } from "sonner";
import { extractFromFile } from "@/lib/aiExtract";
import { uploadTenantFile } from "@/lib/saasAdmin";

interface DamageMarker {
  x: number;
  y: number;
  type: string;
  notes?: string;
}

interface CheckItem {
  label: string;
  status: "excellent" | "good" | "fair" | "damaged" | "na";
}

const bodyItems = [
  "الصدام الأمامي", "الصدام الخلفي", "الغطاء الأمامي (البونيت)", "صندوق الخلفي",
  "الباب الأمامي الأيمن", "الباب الأمامي الأيسر", "الباب الخلفي الأيمن", "الباب الخلفي الأيسر",
  "الجناح الأمامي الأيمن", "الجناح الأمامي الأيسر", "الجناح الخلفي الأيمن", "الجناح الخلفي الأيسر",
  "السقف", "الزجاج الأمامي", "الزجاج الخلفي",
];

const mechItems = [
  "المحرك", "ناقل الحركة", "نظام الفرامل", "نظام التعليق",
  "نظام العادم", "نظام التبريد", "التوجيه (الدركسيون)", "المحاور والعجلات",
];

const elecItems = [
  "البطارية", "المولد (الدينمو)", "المارش", "الأنوار الأمامية",
  "الأنوار الخلفية", "المكيف", "النوافذ الكهربائية", "نظام الصوت",
  "لوحة العدادات", "حساسات الركن",
];

const statusLabels: Record<string, string> = {
  excellent: "ممتاز",
  good: "جيد",
  fair: "مقبول",
  damaged: "متضرر",
  na: "غ/م",
};

const statusColors: Record<string, string> = {
  excellent: "bg-success/15 text-success",
  good: "bg-info/15 text-info",
  fair: "bg-warning/15 text-warning",
  damaged: "bg-destructive/15 text-destructive",
  na: "bg-muted text-muted-foreground",
};

function ChecklistSection({
  title,
  items,
  checks,
  onChange,
}: {
  title: string;
  items: string[];
  checks: Record<string, string>;
  onChange: (item: string, status: string) => void;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-foreground mb-3 border-r-2 border-primary pr-2">{title}</h4>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border">
              <th className="text-right py-2 px-2 text-muted-foreground font-medium w-1/3">البند</th>
              {Object.entries(statusLabels).map(([k, v]) => (
                <th key={k} className="py-2 px-1 text-muted-foreground font-medium text-center">{v}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <tr key={item} className="border-b border-border/30 hover:bg-secondary/20">
                <td className="py-2 px-2 text-foreground">{item}</td>
                {Object.keys(statusLabels).map(s => (
                  <td key={s} className="text-center py-2 px-1">
                    <button
                      type="button"
                      onClick={() => onChange(item, s)}
                      className={`w-6 h-6 rounded-full border-2 transition-all ${
                        checks[item] === s
                          ? "border-primary bg-primary scale-110"
                          : "border-border hover:border-primary/50"
                      }`}
                    >
                      {checks[item] === s && (
                        <span className="text-primary-foreground text-[8px]">✓</span>
                      )}
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface InspectionFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  preselectOrderId?: string;
}

export default function InspectionFormDialog({ open, onOpenChange, preselectOrderId }: InspectionFormDialogProps) {
  const [step, setStep] = useState(0);
  const [linkedOrderId, setLinkedOrderId] = useState<string>("");
  const [vehicleInfo, setVehicleInfo] = useState({
    brand: "", model: "", year: "", plate: "", vin: "", color: "", mileage: "",
    customerName: "", customerPhone: "",
  });
  const [bodyChecks, setBodyChecks] = useState<Record<string, string>>({});
  const [mechChecks, setMechChecks] = useState<Record<string, string>>({});
  const [elecChecks, setElecChecks] = useState<Record<string, string>>({});
  const [damageMarkers, setDamageMarkers] = useState<DamageMarker[]>([]);
  const [notes, setNotes] = useState("");
  const [recommendation, setRecommendation] = useState("");
  const [overallRating, setOverallRating] = useState("good");
  const [computerReport, setComputerReport] = useState<File | null>(null);
  const [aiAnalysis, setAiAnalysis] = useState<Record<string, string> | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);

  const workOrders = getWorkOrders();

  const handleSelectOrder = (orderId: string) => {
    setLinkedOrderId(orderId);
    const order = getWorkOrderById(orderId);
    if (order) {
      setVehicleInfo({
        brand: order.vehicleType,
        model: order.model,
        year: order.year,
        plate: order.plate,
        vin: order.vin,
        color: order.color || "",
        mileage: order.mileage || "",
        customerName: order.customer,
        customerPhone: order.phone,
      });
      toast.success(`تم جلب بيانات السيارة من ${order.id}`);
    }
  };

  const steps = ["معلومات السيارة", "فحص الهيكل", "فحص الميكانيكا", "فحص الكهرباء", "خريطة الأضرار", "التوصيات"];

  // عند الفتح مع ربط مسبق بأمر عمل (من /inspection?new=1)
  useEffect(() => {
    if (open && preselectOrderId && !linkedOrderId) {
      handleSelectOrder(preselectOrderId);
    }
    if (!open) {
      // تنظيف عند الإغلاق
      setStep(0);
      setLinkedOrderId("");
      setVehicleInfo({ brand: "", model: "", year: "", plate: "", vin: "", color: "", mileage: "", customerName: "", customerPhone: "" });
      setBodyChecks({}); setMechChecks({}); setElecChecks({});
      setDamageMarkers([]); setNotes(""); setRecommendation(""); setOverallRating("good");
      setComputerReport(null); setAiAnalysis(null); setAnalyzing(false); setSaving(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectOrderId]);

  const handleExportPdf = () => {
    generateInspectionReportPdf({
      vehicleInfo, bodyChecks, mechChecks, elecChecks, damageMarkers,
      notes, recommendation, overallRating,
      bodyItems, mechItems, elecItems, statusLabels,
    });
  };

  /** حفظ تقرير الفحص في المخزن وربطه بأمر العمل */
  async function analyzeComputerReport() {
    if (!computerReport) return;
    setAnalyzing(true);
    try {
      const result = await extractFromFile(computerReport, "diagnostic_report");
      setAiAnalysis(result);
      toast.success("تم تحليل تقرير الكمبيوتر");
    } catch (error: any) {
      toast.error(error?.message || "تعذر تحليل التقرير");
    } finally {
      setAnalyzing(false);
    }
  }

  const handleSaveReport = async () => {
    if (!vehicleInfo.customerName.trim() || !vehicleInfo.plate.trim()) {
      toast.error("اسم العميل ورقم اللوحة مطلوبان");
      return;
    }
    const damaged = [
      ...Object.entries(bodyChecks).filter(([, s]) => s === "damaged").map(([k]) => k),
      ...Object.entries(mechChecks).filter(([, s]) => s === "damaged").map(([k]) => k),
      ...Object.entries(elecChecks).filter(([, s]) => s === "damaged").map(([k]) => k),
    ];
    const damageType = damaged.length > 0 ? damaged.slice(0, 3).join("، ") + (damaged.length > 3 ? "..." : "") : (damageMarkers.length > 0 ? `${damageMarkers.length} نقطة على المخطط` : "فحص دوري");

    // منع التكرار: إذا كان هناك فحص قائم لنفس اللوحة → نحدّثه بدل إنشاء فحص جديد
    const existing = findInspectionByPlate(vehicleInfo.plate, "general");
    const id = existing?.id || `INS-${Date.now().toString().slice(-6)}`;
    setSaving(true);
    let computerReportFileId: string | null = null;
    if (computerReport) {
      try {
        const uploaded = await uploadTenantFile(computerReport, "inspection_reports");
        computerReportFileId = uploaded.id;
      } catch (error: any) {
        toast.error(error?.message || "تعذر رفع تقرير الكمبيوتر");
        setSaving(false);
        return;
      }
    }
    const record = {
      id,
      workOrder: linkedOrderId || existing?.workOrder || "—",
      customer: vehicleInfo.customerName,
      vehicle: `${vehicleInfo.brand} ${vehicleInfo.model} ${vehicleInfo.year}`.trim(),
      date: new Date().toISOString().split("T")[0],
      damageType,
      photos: damageMarkers.length,
      status: overallRating === "excellent" ? "مكتمل" : "قيد الفحص",
      plate: vehicleInfo.plate,
      kind: "general" as const,
      overallRating,
      details: {
        vehicleInfo,
        bodyChecks,
        mechChecks,
        elecChecks,
        damageMarkers,
        notes,
        recommendation,
        computerReportFileId,
      },
      aiAnalysis: aiAnalysis || undefined,
    };
    if (existing) {
      inspectionsStore.update(id, record);
    } else {
      inspectionsStore.add(record);
    }
    logActivity({
      action: existing ? "update" : "create",
      entity: "inspection",
      entityId: id,
      label: `${record.customer} — ${record.vehicle}`,
      description: linkedOrderId ? `مرتبط بأمر العمل ${linkedOrderId}` : "فحص بدون ربط بأمر عمل",
      metadata: { workOrder: linkedOrderId, overallRating, damageMarkers: damageMarkers.length, replacedExisting: !!existing },
    });
    if (existing) {
      toast.info(`تم تحديث الفحص الحالي للسيارة ${vehicleInfo.plate}`, {
        description: `لا يمكن إنشاء أكثر من فحص عام لنفس السيارة. تم تحديث الفحص القائم (${id}) بدلاً من إنشاء فحص جديد.`,
        duration: 6000,
      });
    } else {
      toast.success(`تم حفظ تقرير الفحص ${id}${linkedOrderId ? ` وربطه بـ ${linkedOrderId}` : ""}`);
    }
    setSaving(false);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto bg-card border-border">
        <DialogHeader>
          <DialogTitle className="text-foreground">نموذج فحص المركبة</DialogTitle>
        </DialogHeader>

        {/* Steps indicator */}
        <div className="flex items-center gap-1 mb-4 overflow-x-auto pb-2">
          {steps.map((s, i) => (
            <button
              key={i}
              type="button"
              onClick={() => setStep(i)}
              className={`text-[10px] px-3 py-1.5 rounded-full whitespace-nowrap transition-all ${
                step === i
                  ? "gradient-gold text-primary-foreground font-semibold"
                  : i < step
                  ? "bg-success/15 text-success"
                  : "bg-secondary text-muted-foreground"
              }`}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        {/* Step 0: Vehicle Info */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
              <label className="text-xs font-semibold text-primary flex items-center gap-1">
                <LinkIcon size={12} /> ربط بأمر عمل موجود (جلب بيانات السيارة تلقائياً)
              </label>
              <Select value={linkedOrderId} onValueChange={handleSelectOrder}>
                <SelectTrigger className="bg-card border-border text-foreground">
                  <SelectValue placeholder="اختر أمر عمل لجلب بيانات السيارة..." />
                </SelectTrigger>
                <SelectContent className="bg-card border-border max-h-[300px]">
                  {workOrders.map(o => (
                    <SelectItem key={o.id} value={o.id}>
                      <span className="text-xs"><span className="font-mono text-primary">{o.id}</span> — {o.customer} — {o.vehicleType} {o.model} ({o.plate})</span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {linkedOrderId && (
                <p className="text-[10px] text-success">✓ تم جلب البيانات من {linkedOrderId} — يمكنك التعديل أدناه</p>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1"><label className="text-xs text-muted-foreground">اسم العميل</label>
                <Input value={vehicleInfo.customerName} onChange={e => setVehicleInfo(p => ({ ...p, customerName: e.target.value }))} className="bg-secondary border-border text-foreground" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">رقم الهاتف</label>
                <Input value={vehicleInfo.customerPhone} onChange={e => setVehicleInfo(p => ({ ...p, customerPhone: e.target.value }))} className="bg-secondary border-border text-foreground" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">الماركة</label>
                <Input value={vehicleInfo.brand} onChange={e => setVehicleInfo(p => ({ ...p, brand: e.target.value }))} className="bg-secondary border-border text-foreground" placeholder="تويوتا" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">الموديل</label>
                <Input value={vehicleInfo.model} onChange={e => setVehicleInfo(p => ({ ...p, model: e.target.value }))} className="bg-secondary border-border text-foreground" placeholder="كامري" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">السنة</label>
                <Input value={vehicleInfo.year} onChange={e => setVehicleInfo(p => ({ ...p, year: e.target.value }))} className="bg-secondary border-border text-foreground" placeholder="2024" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">اللون</label>
                <Input value={vehicleInfo.color} onChange={e => setVehicleInfo(p => ({ ...p, color: e.target.value }))} className="bg-secondary border-border text-foreground" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">رقم اللوحة</label>
                <Input value={vehicleInfo.plate} onChange={e => setVehicleInfo(p => ({ ...p, plate: e.target.value }))} className="bg-secondary border-border text-foreground" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">رقم الهيكل VIN</label>
                <Input value={vehicleInfo.vin} onChange={e => setVehicleInfo(p => ({ ...p, vin: e.target.value }))} className="bg-secondary border-border text-foreground font-mono" /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">عداد الكيلومترات</label>
                <Input value={vehicleInfo.mileage} onChange={e => setVehicleInfo(p => ({ ...p, mileage: e.target.value }))} className="bg-secondary border-border text-foreground" placeholder="50,000 كم" /></div>
            </div>
          </div>
        )}

        {/* Step 1: Body */}
        {step === 1 && (
          <ChecklistSection
            title="فحص الهيكل الخارجي"
            items={bodyItems}
            checks={bodyChecks}
            onChange={(item, status) => setBodyChecks(p => ({ ...p, [item]: status }))}
          />
        )}

        {/* Step 2: Mechanical */}
        {step === 2 && (
          <ChecklistSection
            title="فحص الميكانيكا"
            items={mechItems}
            checks={mechChecks}
            onChange={(item, status) => setMechChecks(p => ({ ...p, [item]: status }))}
          />
        )}

        {/* Step 3: Electrical */}
        {step === 3 && (
          <ChecklistSection
            title="الفحص الكهربائي"
            items={elecItems}
            checks={elecChecks}
            onChange={(item, status) => setElecChecks(p => ({ ...p, [item]: status }))}
          />
        )}

        {/* Step 4: Damage Map */}
        {step === 4 && (
          <VehicleDiagram
            markers={damageMarkers}
            onAddMarker={m => setDamageMarkers(p => [...p, m])}
            onRemoveMarker={i => setDamageMarkers(p => p.filter((_, idx) => idx !== i))}
          />
        )}

        {/* Step 5: Recommendations */}
        {step === 5 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">التقييم العام</label>
              <Select value={overallRating} onValueChange={setOverallRating}>
                <SelectTrigger className="bg-secondary border-border text-foreground">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent className="bg-card border-border">
                  <SelectItem value="excellent">ممتاز - لا تحتاج إصلاح</SelectItem>
                  <SelectItem value="good">جيد - إصلاحات بسيطة</SelectItem>
                  <SelectItem value="fair">مقبول - يحتاج إصلاحات</SelectItem>
                  <SelectItem value="damaged">متضرر - يحتاج إصلاح شامل</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">ملاحظات الفاحص</label>
              <textarea
                value={notes}
                onChange={e => setNotes(e.target.value)}
                className="w-full rounded-lg bg-secondary border border-border text-foreground p-3 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="أضف ملاحظات تفصيلية..."
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">التوصيات</label>
              <textarea
                value={recommendation}
                onChange={e => setRecommendation(e.target.value)}
                className="w-full rounded-lg bg-secondary border border-border text-foreground p-3 text-sm min-h-[80px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="التوصيات والإصلاحات المطلوبة..."
              />
            </div>
            <div className="space-y-3 rounded-xl border border-primary/20 bg-primary/5 p-4">
              <div>
                <h4 className="flex items-center gap-2 text-sm font-semibold"><BrainCircuit size={16} className="text-primary" /> تحليل تقرير فحص الكمبيوتر</h4>
                <p className="mt-1 text-[10px] text-muted-foreground">يستخرج الأكواد ووصف الأعطال والخطورة فقط، بدون طريقة الإصلاح.</p>
              </div>
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-card p-4 text-xs">
                <Upload size={15} /> {computerReport?.name || "رفع تقرير PDF أو صورة"}
                <input type="file" accept="application/pdf,image/*" className="hidden" onChange={(event) => {
                  setComputerReport(event.target.files?.[0] || null);
                  setAiAnalysis(null);
                }} />
              </label>
              <Button type="button" size="sm" variant="outline" disabled={!computerReport || analyzing} onClick={() => void analyzeComputerReport()}>
                {analyzing ? <Loader2 size={14} className="animate-spin" /> : <BrainCircuit size={14} />}
                {analyzing ? "جارٍ التحليل…" : "تحليل بالذكاء الاصطناعي"}
              </Button>
              {aiAnalysis && (
                <div className="grid gap-2 rounded-lg border border-border bg-card p-3 text-xs sm:grid-cols-2">
                  <div><span className="font-semibold">الأكواد</span><p className="mt-1 whitespace-pre-wrap text-muted-foreground" dir="ltr">{aiAnalysis.fault_codes || "—"}</p></div>
                  <div><span className="font-semibold">الخطورة</span><p className="mt-1 text-muted-foreground">{aiAnalysis.severity || "—"}</p></div>
                  <div className="sm:col-span-2"><span className="font-semibold">وصف المشاكل</span><p className="mt-1 whitespace-pre-wrap text-muted-foreground">{aiAnalysis.problems || aiAnalysis.summary || "—"}</p></div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setStep(s => Math.max(0, s - 1))}
            disabled={step === 0}
            className="border-border text-foreground gap-1"
          >
            <ChevronRight size={14} />
            السابق
          </Button>

          <div className="flex gap-2">
            {step === steps.length - 1 ? (
              <>
                <Button size="sm" variant="outline" onClick={handleExportPdf} className="border-border text-foreground gap-1">
                  <FileText size={14} />
                  تصدير PDF
                </Button>
                <Button size="sm" disabled={saving} onClick={() => void handleSaveReport()} className="gradient-gold text-primary-foreground gap-1">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
                  {saving ? "جارٍ الحفظ…" : "حفظ التقرير"}
                </Button>
              </>
            ) : (
              <Button
                size="sm"
                onClick={() => setStep(s => Math.min(steps.length - 1, s + 1))}
                className="gradient-gold text-primary-foreground gap-1"
              >
                التالي
                <ChevronLeft size={14} />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
