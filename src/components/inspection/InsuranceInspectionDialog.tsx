import { useEffect, useMemo, useRef, useState } from "react";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ChevronLeft, ChevronRight, FileText, Link as LinkIcon, Image as ImageIcon, Camera, Search as SearchIcon, FileSearch, X } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  generateInsuranceInspectionPdf,
  generateInsuranceInspectionPdfBlob,
  buildInsuranceInspectionHtml,
  DEFAULT_INSURANCE_INSPECTION_SECTIONS,
  type InsuranceInspSection,
  type HighlightColor,
  type TextHighlight,
} from "@/lib/insuranceInspectionPdf";
import VehicleAnnotationCanvas, { DEFAULT_VEHICLE_SVG_DATA_URL } from "./VehicleAnnotationCanvas";
import { VEHICLE_TEMPLATES } from "@/lib/vehicleDiagrams";
import { getWorkOrders, getWorkOrderById } from "@/lib/workOrdersStore";
import { inspectionsStore, findInspectionByPlate } from "@/lib/inspectionsStore";
import { insuranceInspectionStore } from "@/lib/insuranceInspectionStore";
import { logActivity } from "@/lib/auditLogStore";
import { useInsuranceClaims } from "@/hooks/useInsuranceClaims";
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preselectOrderId?: string;
  /** When true, renders the form inline as a full page instead of a modal dialog */
  asPage?: boolean;
  /** When provided, loads an existing saved inspection for editing */
  editId?: string;
}

const STEPS = ["البيانات الأساسية", "بنود الفحص", "مخطط الأضرار", "الملاحظات والحفظ"];

const cloneSections = (): InsuranceInspSection[] =>
  DEFAULT_INSURANCE_INSPECTION_SECTIONS.map(s => ({
    ...s,
    items: s.items.map(i => ({ ...i, repair: false, suspect: false, replace: false, comment: "" })),
  }));

export default function InsuranceInspectionDialog({ open, onOpenChange, preselectOrderId, asPage, editId }: Props) {
  const [step, setStep] = useState(0);
  const [linkedOrderId, setLinkedOrderId] = useState("");
  const [meta, setMeta] = useState({
    reportNo: `DR-${Date.now().toString().slice(-6)}`,
    date: new Date().toISOString().split("T")[0],
    claimNo: "",
    regNo: "",
    gatePass: "",
    garageName: "شركة الوفاء للأعمال المتكاملة",
    makeModel: "",
    modelYear: "",
    area: "",
    type: "",
    workshopGrade: "A",
    insuranceCompany: "",
    surveyorName: "",
    customer: "",
    phone: "",
  });
  const [sections, setSections] = useState<InsuranceInspSection[]>(cloneSections());
  const [remarks, setRemarks] = useState("");
  const [imageMode, setImageMode] = useState<"template" | "photo">("template");
  const [templateId, setTemplateId] = useState<string>(VEHICLE_TEMPLATES[0].id);
  const [photos, setPhotos] = useState<string[]>([]);
  const [activePhotoIdx, setActivePhotoIdx] = useState(0);
  const [annotatedDataUrl, setAnnotatedDataUrl] = useState<string>("");
  // per-source annotated PNGs — keyed by "template:<id>" or "photo:<idx>"
  const [annotatedMap, setAnnotatedMap] = useState<Record<string, string>>({});
  const [woPickerOpen, setWoPickerOpen] = useState(false);
  const [claimPickerOpen, setClaimPickerOpen] = useState(false);
  const [linkedClaimId, setLinkedClaimId] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);

  const workOrders = getWorkOrders();
  const { data: claims = [] } = useInsuranceClaims();
  const currentTemplate = VEHICLE_TEMPLATES.find(t => t.id === templateId) || VEHICLE_TEMPLATES[0];
  const currentImage = imageMode === "photo" && photos[activePhotoIdx]
    ? photos[activePhotoIdx]
    : (currentTemplate?.src || DEFAULT_VEHICLE_SVG_DATA_URL);

  // reset on open/close
  useEffect(() => {
    if (open && editId) {
      const saved = insuranceInspectionStore.get(editId);
      if (saved) {
        const { remarks: r, sections: s, annotatedImages, photos: savedPhotos, _savedAt, ...rest } = saved as any;
        setMeta(rest);
        setSections(Array.isArray(s) && s.length ? s : cloneSections());
        setRemarks(r || "");
        if (Array.isArray(savedPhotos) && savedPhotos.length) {
          setPhotos(savedPhotos);
        }
        if (Array.isArray(annotatedImages) && annotatedImages.length) {
          const map: Record<string, string> = {};
          annotatedImages.forEach((src: string, i: number) => { map[`saved:${i}`] = src; });
          setAnnotatedMap(map);
        }
        toast.info(`جارٍ تعديل التقرير ${editId}`);
        return;
      }
    }
    if (open && preselectOrderId && !linkedOrderId) selectOrder(preselectOrderId);
    if (!open) {
      setStep(0);
      setLinkedOrderId("");
      setLinkedClaimId("");
      setSections(cloneSections());
      setRemarks("");
      setAnnotatedDataUrl("");
      setAnnotatedMap({});
      setPhotos([]);
      setActivePhotoIdx(0);
      setImageMode("template");
      setTemplateId(VEHICLE_TEMPLATES[0].id);
      setMeta(m => ({ ...m, reportNo: `DR-${Date.now().toString().slice(-6)}`, date: new Date().toISOString().split("T")[0] }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, preselectOrderId, editId]);

  function selectOrder(orderId: string) {
    setLinkedOrderId(orderId);
    setWoPickerOpen(false);
    const o = getWorkOrderById(orderId);
    if (!o) return;
    setMeta(m => ({
      ...m,
      regNo: o.plate || "",
      makeModel: `${o.vehicleType || ""} ${o.model || ""}`.trim(),
      modelYear: o.year || "",
      customer: o.customer || "",
      phone: o.phone || "",
      claimNo: (o as any).claimNo || m.claimNo,
      insuranceCompany: (o as any).insuranceCompany || m.insuranceCompany,
    }));
    // grab stage photos if available
    const sp = ((o as any).stagePhotos as string[]) || [];
    if (sp.length > 0) {
      setPhotos(prev => Array.from(new Set([...prev, ...sp])));
      setActivePhotoIdx(0);
    }
    toast.success(`تم جلب بيانات السيارة من ${orderId}`);
  }

  function selectClaim(claimId: string) {
    setLinkedClaimId(claimId);
    setClaimPickerOpen(false);
    const c = (claims as any[]).find(x => x.id === claimId);
    if (!c) return;
    setMeta(m => ({
      ...m,
      claimNo: c.claim_number || m.claimNo,
      insuranceCompany: c.insurance_company || m.insuranceCompany,
      regNo: c.vehicle?.plate_number || c.vehicle_plate || m.regNo,
      makeModel: c.vehicle ? `${c.vehicle.brand || ""} ${c.vehicle.model || ""}`.trim() : (`${c.vehicle_make || ""} ${c.vehicle_model || ""}`.trim() || m.makeModel),
      modelYear: String(c.vehicle?.year || c.vehicle_year || m.modelYear || ""),
      customer: c.customer?.name || c.vehicle_owner_name || m.customer,
      phone: c.customer?.phone || c.vehicle_owner_phone || m.phone,
      surveyorName: c.adjuster_name || m.surveyorName,
    }));
    // attach damage photos from the claim
    const dp = (c.damage_photos as string[]) || [];
    if (dp.length > 0) {
      setPhotos(prev => Array.from(new Set([...prev, ...dp])));
      setActivePhotoIdx(0);
    }
    toast.success(`تم جلب البيانات من المطالبة ${c.claim_number}`);
  }

  function toggleField(secIdx: number, itemIdx: number, field: "repair" | "suspect" | "replace") {
    setSections(prev => prev.map((s, si) => si !== secIdx ? s : {
      ...s,
      items: s.items.map((it, ii) => ii !== itemIdx ? it : { ...it, [field]: !it[field] }),
    }));
  }
  function setComment(secIdx: number, itemIdx: number, val: string) {
    setSections(prev => prev.map((s, si) => si !== secIdx ? s : {
      ...s,
      items: s.items.map((it, ii) => ii !== itemIdx ? it : { ...it, comment: val }),
    }));
  }

  /** Captured selection range — preserved before button focus can collapse it */
  const lastSelectionRef = useRef<{ secIdx: number; itemIdx: number; start: number; end: number } | null>(null);

  /** Called when user releases mouse / key inside the EN label — capture current selection offsets */
  function captureSelection(secIdx: number, itemIdx: number) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
      lastSelectionRef.current = null;
      return;
    }
    const range = sel.getRangeAt(0);
    const root = document.querySelector<HTMLElement>(`[data-en-label="${secIdx}-${itemIdx}"]`);
    if (!root || !root.contains(range.commonAncestorContainer)) {
      lastSelectionRef.current = null;
      return;
    }
    const preRange = range.cloneRange();
    preRange.selectNodeContents(root);
    preRange.setEnd(range.startContainer, range.startOffset);
    const start = preRange.toString().length;
    const end = start + range.toString().length;
    if (end <= start) { lastSelectionRef.current = null; return; }
    lastSelectionRef.current = { secIdx, itemIdx, start, end };
  }

  /** Apply current text-selection inside the EN label of an item as a highlight */
  function applySelectionHighlight(secIdx: number, itemIdx: number, color: HighlightColor) {
    // Prefer the captured selection (won't be lost when the color button takes focus)
    let captured = lastSelectionRef.current;
    if (!captured || captured.secIdx !== secIdx || captured.itemIdx !== itemIdx) {
      // Fallback: try live selection
      captureSelection(secIdx, itemIdx);
      captured = lastSelectionRef.current;
    }
    if (!captured) {
      toast.info("حدد جزءاً من النص الإنجليزي أولاً ثم اضغط اللون");
      return;
    }
    const { start, end } = captured;
    setSections(prev => prev.map((s, si) => si !== secIdx ? s : {
      ...s,
      items: s.items.map((it, ii) => {
        if (ii !== itemIdx) return it;
        const clampedEnd = Math.min(end, it.en.length);
        const clampedStart = Math.max(0, Math.min(start, clampedEnd));
        if (clampedEnd <= clampedStart) return it;
        const existing = (it.highlights || []).filter(h => h.end <= clampedStart || h.start >= clampedEnd);
        const next: TextHighlight[] = [...existing, { start: clampedStart, end: clampedEnd, color }].sort((a, b) => a.start - b.start);
        return { ...it, highlights: next };
      }),
    }));
    lastSelectionRef.current = null;
    window.getSelection()?.removeAllRanges();
  }


  function clearHighlights(secIdx: number, itemIdx: number) {
    setSections(prev => prev.map((s, si) => si !== secIdx ? s : {
      ...s,
      items: s.items.map((it, ii) => ii !== itemIdx ? it : { ...it, highlights: [] }),
    }));
  }

  /** Render the EN label with current highlights as styled spans */
  function renderEnWithHighlights(text: string, highlights?: TextHighlight[]) {
    const HL_BG: Record<HighlightColor, string> = { blue: "bg-info/25 text-info", yellow: "bg-warning/25 text-warning", red: "bg-destructive/25 text-destructive" };
    if (!highlights || highlights.length === 0) return text;
    const sorted = [...highlights].filter(h => h.end > h.start && h.start >= 0 && h.end <= text.length).sort((a, b) => a.start - b.start);
    const out: React.ReactNode[] = [];
    let cursor = 0;
    sorted.forEach((h, idx) => {
      if (h.start < cursor) return;
      if (h.start > cursor) out.push(<span key={`t${idx}`}>{text.slice(cursor, h.start)}</span>);
      out.push(<span key={`h${idx}`} className={cn("rounded px-0.5 font-bold", HL_BG[h.color])}>{text.slice(h.start, h.end)}</span>);
      cursor = h.end;
    });
    if (cursor < text.length) out.push(<span key="end">{text.slice(cursor)}</span>);
    return out;
  }

  // unique key for current annotation source
  const currentSourceKey = imageMode === "photo" ? `photo:${activePhotoIdx}` : `template:${templateId}`;
  const annotatedImagesAll = Object.values(annotatedMap).filter(Boolean);

  function persistInspection() {
    // منع التكرار: في حالة الإنشاء (وليس التعديل) إذا وُجد فحص تأمين سابق لنفس اللوحة → نُحدّثه ونعيد استخدام نفس الـ id
    const existingForPlate = !editId ? findInspectionByPlate(meta.regNo, "insurance") : undefined;
    const id = existingForPlate?.id || meta.reportNo;
    const isEdit = (!!editId && !!inspectionsStore.getById(id)) || !!existingForPlate;
    const recordPayload = {
      id,
      workOrder: linkedOrderId || existingForPlate?.workOrder || "—",
      customer: meta.customer || "—",
      vehicle: meta.makeModel || meta.regNo || "—",
      date: meta.date,
      damageType: `Insurance Inspection — ${meta.insuranceCompany || "—"}`,
      photos: photos.length + annotatedImagesAll.length,
      status: "مكتمل",
      kind: "insurance" as const,
      plate: meta.regNo,
    };
    if (isEdit) {
      inspectionsStore.update(id, recordPayload);
    } else {
      inspectionsStore.add(recordPayload);
    }
    // Save the full insurance payload so the report page can rebuild the exact PDF view
    const result = insuranceInspectionStore.save(id, {
      ...meta,
      reportNo: id,
      remarks,
      sections,
      annotatedImages: annotatedImagesAll,
      photos,
    });
    if (result === "failed") {
      toast.error("تعذّر حفظ التقرير — ذاكرة المتصفح ممتلئة", {
        description: "احذف بعض التقارير القديمة من قائمة الفحص ثم أعد المحاولة.",
        duration: 8000,
      });
    } else if (result === "trimmed") {
      toast.warning("تم حفظ بيانات التقرير بدون الصور", {
        description: "الصور والمخططات تجاوزت سعة المتصفح. النصوص وبنود الفحص محفوظة كاملة، لكن سيتطلب إعادة رفع الصور.",
        duration: 8000,
      });
    }
    logActivity({
      action: isEdit ? "update" : "create",
      entity: "inspection",
      entityId: id,
      label: `Insurance inspection ${meta.regNo} — ${meta.insuranceCompany}`,
      description: `${meta.claimNo} ${linkedOrderId ? "• linked to " + linkedOrderId : ""}${existingForPlate ? " • merged with existing inspection for same vehicle" : ""}`,
    });
    if (existingForPlate) {
      toast.info(`تم تحديث فحص التأمين الحالي للسيارة ${meta.regNo}`, {
        description: `لا يمكن إنشاء أكثر من فحص تأمين لنفس السيارة. تم تحديث الفحص القائم (${id}) بدلاً من إنشاء فحص جديد.`,
        duration: 6000,
      });
    }
    return result;
  }


  function handleSaveOnly() {
    if (!meta.claimNo.trim() && !meta.regNo.trim()) {
      toast.error("Claim No. or Reg No. is required");
      return;
    }
    const r = persistInspection();
    if (r !== "failed") {
      toast.success(`Saved report ${meta.reportNo}`);
      onOpenChange(false);
    }
  }


  function handleSavePdf() {
    if (!meta.claimNo.trim() && !meta.regNo.trim()) {
      toast.error("Claim No. or Reg No. is required");
      return;
    }
    generateInsuranceInspectionPdf({
      ...meta,
      remarks,
      sections,
      annotatedImages: annotatedImagesAll,
      photos,
    });
    persistInspection();
    toast.success(`Generated report ${meta.reportNo}`);
  }

  async function handleDownloadPdf() {
    if (pdfBusy) return;
    if (!meta.claimNo.trim() && !meta.regNo.trim()) {
      toast.error("Claim No. or Reg No. is required");
      return;
    }
    const data = { ...meta, remarks, sections, annotatedImages: annotatedImagesAll, photos };
    try {
      setPdfBusy(true);
      toast.loading("جارٍ تحضير ملف PDF...", { id: "ins-pdf" });
      const blob = await generateInsuranceInspectionPdfBlob(data, `Inspection_${meta.reportNo || Date.now()}`, true);
      if (blob.size === 0) throw new Error("Empty PDF file");
      persistInspection();
      toast.success(`تم تنزيل التقرير ${meta.reportNo}`, { id: "ins-pdf" });
    } catch (e) {
      console.error(e);
      toast.error("تعذّر تنزيل الـ PDF: " + ((e as Error)?.message || "خطأ غير معروف"), { id: "ins-pdf" });
    } finally {
      setPdfBusy(false);
    }
  }

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    const { fileToWebpDataUrl } = await import("@/lib/imageToWebp");
    const urls = await Promise.all(files.map((f) => fileToWebpDataUrl(f)));
    setPhotos(prev => {
      const next = [...prev, ...urls];
      setActivePhotoIdx(prev.length);
      return next;
    });
    setImageMode("photo");
    toast.success(`تم تحميل ${urls.length} صورة`);
    e.target.value = "";
  };

  const removePhoto = (idx: number) => {
    setPhotos(prev => {
      const next = prev.filter((_, i) => i !== idx);
      if (activePhotoIdx >= next.length) setActivePhotoIdx(Math.max(0, next.length - 1));
      if (next.length === 0) setImageMode("template");
      return next;
    });
  };

  const body = (
    <>
        {!asPage && (
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle className="text-foreground">
              تقرير فحص أضرار للتأمين <span className="text-xs font-normal text-muted-foreground">/ Insurance Damage Inspection</span>
            </ResponsiveDialogTitle>
          </ResponsiveDialogHeader>
        )}

        {/* Steps */}
        <div className="flex items-center gap-1 mb-3 overflow-x-auto pb-2">
          {STEPS.map((s, i) => (
            <button
              key={i} type="button" onClick={() => setStep(i)}
              className={cn("text-[11px] px-3 py-1.5 rounded-full whitespace-nowrap transition-all",
                step === i ? "gradient-gold text-primary-foreground font-semibold"
                  : i < step ? "bg-success/15 text-success" : "bg-secondary text-muted-foreground")}
            >
              {i + 1}. {s}
            </button>
          ))}
        </div>

        {/* Step 0 — Meta */}
        {step === 0 && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* Searchable work-order picker */}
              <div className="p-3 rounded-lg bg-primary/5 border border-primary/20 space-y-2">
                <label className="text-xs font-semibold text-primary flex items-center gap-1">
                  <LinkIcon size={12} /> ربط بأمر عمل (بحث)
                </label>
                <Popover open={woPickerOpen} onOpenChange={setWoPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between bg-card border-border font-normal">
                      <span className="truncate text-xs">
                        {linkedOrderId ? (
                          <>
                            <span className="font-mono text-primary">{linkedOrderId}</span>
                            {meta.customer && <> — {meta.customer}</>}
                          </>
                        ) : "ابحث عن أمر عمل..."}
                      </span>
                      <SearchIcon size={14} className="opacity-60 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[--radix-popover-trigger-width] bg-card border-border" align="start">
                    <Command>
                      <CommandInput placeholder="ابحث برقم الأمر، العميل، اللوحة..." />
                      <CommandList>
                        <CommandEmpty>لا توجد نتائج</CommandEmpty>
                        <CommandGroup>
                          {workOrders.map(o => (
                            <CommandItem
                              key={o.id}
                              value={`${o.id} ${o.customer} ${o.plate} ${o.vehicleType} ${o.model}`}
                              onSelect={() => selectOrder(o.id)}
                              className="text-xs cursor-pointer"
                            >
                              <span className="font-mono text-primary mr-2">{o.id}</span>
                              <span className="text-foreground">{o.customer}</span>
                              <span className="text-muted-foreground mx-1">•</span>
                              <span className="text-muted-foreground">{o.plate}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>

              {/* Claim picker */}
              <div className="p-3 rounded-lg bg-info/5 border border-info/20 space-y-2">
                <label className="text-xs font-semibold text-info flex items-center gap-1">
                  <FileSearch size={12} /> أو جلب من مطالبة تأمين
                </label>
                <Popover open={claimPickerOpen} onOpenChange={setClaimPickerOpen}>
                  <PopoverTrigger asChild>
                    <Button variant="outline" role="combobox" className="w-full justify-between bg-card border-border font-normal">
                      <span className="truncate text-xs">
                        {linkedClaimId
                          ? (claims as any[]).find(c => c.id === linkedClaimId)?.claim_number || "—"
                          : "ابحث في المطالبات..."}
                      </span>
                      <SearchIcon size={14} className="opacity-60 shrink-0" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-[--radix-popover-trigger-width] bg-card border-border" align="start">
                    <Command>
                      <CommandInput placeholder="ابحث برقم المطالبة، الشركة، العميل..." />
                      <CommandList>
                        <CommandEmpty>لا توجد مطالبات</CommandEmpty>
                        <CommandGroup>
                          {(claims as any[]).map(c => (
                            <CommandItem
                              key={c.id}
                              value={`${c.claim_number} ${c.insurance_company} ${c.customer?.name || ""} ${c.vehicle?.plate_number || ""}`}
                              onSelect={() => selectClaim(c.id)}
                              className="text-xs cursor-pointer"
                            >
                              <span className="font-mono text-info mr-2">{c.claim_number}</span>
                              <span className="text-foreground">{c.insurance_company}</span>
                              <span className="text-muted-foreground mx-1">•</span>
                              <span className="text-muted-foreground">{c.customer?.name || "—"}</span>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="رقم المطالبة CLAIM NO." val={meta.claimNo} onChange={v => setMeta(m => ({ ...m, claimNo: v }))} mono />
              <Field label="شركة التأمين Insurance Company" val={meta.insuranceCompany} onChange={v => setMeta(m => ({ ...m, insuranceCompany: v }))} />
              <Field label="رقم اللوحة REG NO." val={meta.regNo} onChange={v => setMeta(m => ({ ...m, regNo: v }))} mono />
              <Field label="إذن الدخول GATE PASS" val={meta.gatePass} onChange={v => setMeta(m => ({ ...m, gatePass: v }))} mono />
              <Field label="الماركة/الموديل MAKE/MODEL" val={meta.makeModel} onChange={v => setMeta(m => ({ ...m, makeModel: v }))} />
              <Field label="سنة الصنع MODEL YEAR" val={meta.modelYear} onChange={v => setMeta(m => ({ ...m, modelYear: v }))} mono />
              <Field label="المنطقة AREA" val={meta.area} onChange={v => setMeta(m => ({ ...m, area: v }))} />
              <Field label="النوع TYPE" val={meta.type} onChange={v => setMeta(m => ({ ...m, type: v }))} />
              <Field label="درجة الورشة W/S GRADE" val={meta.workshopGrade} onChange={v => setMeta(m => ({ ...m, workshopGrade: v }))} />
              <Field label="اسم المعاين SURVEYOR" val={meta.surveyorName} onChange={v => setMeta(m => ({ ...m, surveyorName: v }))} />
              <Field label="العميل CUSTOMER" val={meta.customer} onChange={v => setMeta(m => ({ ...m, customer: v }))} />
              <Field label="الهاتف PHONE" val={meta.phone} onChange={v => setMeta(m => ({ ...m, phone: v }))} mono />
            </div>
          </div>
        )}

        {/* Step 1 — Checks */}
        {step === 1 && (
          <Tabs defaultValue="0" className="w-full flex flex-col">
            {sections.map((s, secIdx) => (
              <TabsContent key={secIdx} value={String(secIdx)} className="mt-0 order-1">
                <div className="space-y-2 pb-4">
                  {s.items.map((it, itemIdx) => (
                    <div key={it.key} className="rounded-lg border border-border bg-card p-3 space-y-2">
                      <div className="flex flex-col sm:flex-row sm:items-start gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-semibold text-foreground">{it.ar}</div>
                          <div
                            data-en-label={`${secIdx}-${itemIdx}`}
                            className="text-[11px] text-muted-foreground tracking-wide select-text cursor-text leading-relaxed"
                            title="حدد جزءاً من النص ثم اختر لوناً لتلوينه"
                            onMouseUp={() => captureSelection(secIdx, itemIdx)}
                            onKeyUp={() => captureSelection(secIdx, itemIdx)}
                            onTouchEnd={() => captureSelection(secIdx, itemIdx)}
                          >
                            {renderEnWithHighlights(it.en, it.highlights)}
                          </div>
                          {/* Highlight controls */}
                          <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                            <span className="text-[9px] text-muted-foreground">تلوين النص المحدد:</span>
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applySelectionHighlight(secIdx, itemIdx, "blue")}
                              className="w-5 h-5 rounded bg-info/70 hover:bg-info border border-info/50" title="إصلاح / Repair (أزرق)" />
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applySelectionHighlight(secIdx, itemIdx, "yellow")}
                              className="w-5 h-5 rounded bg-warning/70 hover:bg-warning border border-warning/50" title="مشتبه / Suspect (أصفر)" />
                            <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applySelectionHighlight(secIdx, itemIdx, "red")}
                              className="w-5 h-5 rounded bg-destructive/70 hover:bg-destructive border border-destructive/50" title="استبدال / Replace (أحمر)" />

                            {(it.highlights && it.highlights.length > 0) && (
                              <button type="button" onClick={() => clearHighlights(secIdx, itemIdx)}
                                className="text-[9px] text-muted-foreground hover:text-destructive underline px-1">مسح</button>
                            )}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          {(["repair", "suspect", "replace"] as const).map(f => (
                            <button
                              key={f} type="button" onClick={() => toggleField(secIdx, itemIdx, f)}
                              className={cn("px-3 py-1.5 rounded-lg text-[11px] font-semibold border-2 transition-all min-w-[70px]",
                                it[f] ? (f === "repair" ? "bg-info/15 border-info text-info"
                                  : f === "suspect" ? "bg-warning/15 border-warning text-warning"
                                    : "bg-destructive/15 border-destructive text-destructive")
                                  : "border-border text-muted-foreground hover:border-foreground/30")}
                            >
                              {f === "repair" ? "إصلاح" : f === "suspect" ? "مشتبه" : "استبدال"}
                            </button>
                          ))}
                        </div>
                      </div>
                      <Input
                        value={it.comment || ""}
                        onChange={e => setComment(secIdx, itemIdx, e.target.value)}
                        placeholder="تعليق على هذا البند... (اختياري)"
                        className="bg-secondary border-border text-xs h-8"
                      />
                    </div>
                  ))}
                </div>
              </TabsContent>
            ))}

            {/* Tabs at the BOTTOM — bold & sticky for clear navigation */}
            <div className="order-2 sticky bottom-0 z-20 -mx-1 mt-3 bg-background/95 backdrop-blur-sm border-t-2 border-primary/40 pt-2 pb-1 shadow-[0_-4px_16px_-4px_rgba(0,0,0,0.25)]">
              <div className="text-[10px] font-bold text-primary uppercase tracking-widest mb-1.5 text-center">
                الأقسام / Sections
              </div>
              <TabsList className="w-full justify-start overflow-x-auto flex-nowrap h-auto p-1.5 bg-secondary/60 gap-1">
                {sections.map((s, i) => (
                  <TabsTrigger
                    key={i}
                    value={String(i)}
                    className="text-xs whitespace-nowrap font-semibold px-4 py-2 data-[state=active]:gradient-gold data-[state=active]:text-primary-foreground data-[state=active]:shadow-md"
                  >
                    {s.titleAr}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
          </Tabs>
        )}

        {/* Step 2 — Damage diagram */}
        {step === 2 && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 p-2 rounded-lg bg-primary/5 border border-primary/20">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-primary">مصدر صورة المركبة:</span>
                <Button size="sm" variant={imageMode === "template" ? "default" : "outline"}
                  onClick={() => setImageMode("template")} className="gap-1 h-8">
                  <ImageIcon size={14} /> بلوبرنت
                </Button>
                <Button size="sm" variant={imageMode === "photo" ? "default" : "outline"}
                  onClick={() => { if (photos.length) setImageMode("photo"); else document.getElementById("ins-photo-upload")?.click(); }}
                  className="gap-1 h-8">
                  <Camera size={14} /> صور فعلية {photos.length > 0 && `(${photos.length})`}
                </Button>
                <input id="ins-photo-upload" type="file" accept="image/*" multiple onChange={handlePhotoUpload} className="hidden" />
                <Button size="sm" variant="outline" onClick={() => document.getElementById("ins-photo-upload")?.click()} className="text-xs h-8 gap-1">
                  <Camera size={12} /> + إضافة صور
                </Button>
              </div>
              {imageMode === "template" && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">نوع المركبة:</span>
                  {VEHICLE_TEMPLATES.map(t => (
                    <button
                      key={t.id} type="button" onClick={() => setTemplateId(t.id)}
                      className={cn("px-3 py-1 rounded-md text-[11px] border-2 transition-all",
                        templateId === t.id
                          ? "border-primary bg-primary/15 text-primary font-semibold"
                          : "border-border text-muted-foreground hover:border-foreground/40")}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {imageMode === "photo" && photos.length > 0 && (
                <div className="space-y-1">
                  <span className="text-[11px] text-muted-foreground">الصور المحملة ({photos.length}) — اختر للتعليق:</span>
                  <div className="flex gap-2 overflow-x-auto pb-2">
                    {photos.map((p, i) => (
                      <div key={i} className="relative shrink-0 group">
                        <button
                          type="button"
                          onClick={() => setActivePhotoIdx(i)}
                          className={cn("block rounded-md overflow-hidden border-2 transition-all relative",
                            activePhotoIdx === i ? "border-primary ring-2 ring-primary/30" : "border-border hover:border-foreground/40")}
                        >
                          <img src={p} alt={`photo ${i + 1}`} className="h-16 w-24 object-cover" />
                          {annotatedMap[`photo:${i}`] && (
                            <span className="absolute bottom-0 left-0 right-0 bg-success/90 text-success-foreground text-[9px] py-0.5 text-center font-bold">✓ Annotated</span>
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => removePhoto(i)}
                          className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                          title="حذف"
                        >
                          <X size={10} />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <VehicleAnnotationCanvas
              key={currentSourceKey}
              imageSrc={currentImage}
              onChange={(dataUrl) => {
                setAnnotatedDataUrl(dataUrl);
                setAnnotatedMap(prev => ({ ...prev, [currentSourceKey]: dataUrl }));
              }}
              onSave={(dataUrl) => {
                setAnnotatedDataUrl(dataUrl);
                setAnnotatedMap(prev => ({ ...prev, [currentSourceKey]: dataUrl }));
                toast.success("Annotations saved");
              }}
            />

            <div className="text-[11px] text-muted-foreground flex items-center justify-between flex-wrap gap-2">
              <span>
                {annotatedImagesAll.length > 0
                  ? `✓ ${annotatedImagesAll.length} annotated diagram(s) — each will be a separate PDF page`
                  : "Draw on the image, then move to the next step. Switch between photos/templates to annotate multiple."}
              </span>
            </div>
          </div>
        )}

        {/* Step 3 — Remarks & save */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="space-y-1">
              <label className="text-xs text-muted-foreground font-medium">الملاحظات العامة REMARKS</label>
              <textarea
                value={remarks} onChange={e => setRemarks(e.target.value)}
                className="w-full rounded-lg bg-secondary border border-border text-foreground p-3 text-sm min-h-[100px] resize-none focus:outline-none focus:ring-2 focus:ring-ring"
                placeholder="أضف ملاحظات شاملة على التقرير..."
              />
            </div>

            <div className="rounded-lg bg-secondary/50 border border-border p-3 text-xs space-y-1">
              <div><strong>Report No:</strong> <span className="font-mono text-primary">{meta.reportNo}</span></div>
              <div><strong>Claim:</strong> {meta.claimNo || "—"} • <strong>Reg:</strong> {meta.regNo || "—"}</div>
              <div><strong>Vehicle:</strong> {meta.makeModel} {meta.modelYear}</div>
              <div><strong>Diagrams:</strong> {annotatedImagesAll.length > 0 ? `✓ ${annotatedImagesAll.length} attached` : "— none"}</div>
              <div>
                <strong>Selected items:</strong>{" "}
                {sections.reduce((acc, s) => acc + s.items.filter(i => i.repair || i.suspect || i.replace).length, 0)}
              </div>
            </div>
          </div>
        )}

        {/* Navigation */}
        <div className="flex items-center justify-between pt-3 border-t border-border mt-3 flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => setStep(s => Math.max(0, s - 1))} disabled={step === 0}>
            <ChevronRight size={14} /> السابق
          </Button>

          <div className="flex items-center gap-2 flex-wrap">
            {step === STEPS.length - 1 ? (
              <>
                <Button size="sm" variant="outline" onClick={handleSaveOnly} className="gap-1">
                  💾 حفظ فقط
                </Button>
                <Button size="sm" variant="outline" onClick={handleSavePdf} className="gap-1">
                  🖨️ طباعة
                </Button>
                <Button size="sm" onClick={handleDownloadPdf} disabled={pdfBusy} className="gradient-gold text-primary-foreground gap-1">
                  <FileText size={14} /> {pdfBusy ? "جارٍ التحضير..." : "تنزيل PDF"}
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))} className="gradient-gold text-primary-foreground gap-1">
                التالي <ChevronLeft size={14} />
              </Button>
            )}
          </div>
        </div>
    </>
  );

  if (asPage) {
    return <div dir="rtl" className="space-y-3">{body}</div>;
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange} className="max-w-6xl max-h-[95vh] overflow-y-auto">
      {body}
    </ResponsiveDialog>
  );
}

function Field({ label, val, onChange, mono }: { label: string; val: string; onChange: (v: string) => void; mono?: boolean }) {
  return (
    <div className="space-y-1">
      <label className="text-xs text-muted-foreground">{label}</label>
      <Input value={val} onChange={e => onChange(e.target.value)} className={cn("bg-secondary border-border text-foreground", mono && "font-mono")} />
    </div>
  );
}
