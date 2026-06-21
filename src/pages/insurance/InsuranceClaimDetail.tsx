import { useEffect, useState, useMemo, useRef } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight, Save, FileText, Trash2, Upload, X, Plus, Printer, Camera,
  FileUp, Car, User, Building2, AlertCircle, Shield, ClipboardCheck,
  Calculator, CheckCircle2, Wrench, ArrowLeftRight, Search, Link as LinkIcon, Sparkles, Phone,
  DollarSign, PackageCheck,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  useCustomers,
  useVehiclesByCustomer,
  useCreateClaim,
  useUpdateClaim,
  useClaim,
  useDeleteClaim,
  useUpdateClaimStatus,
  type ClaimNeededPart,
  type ClaimDocument,
} from "@/hooks/useInsuranceClaims";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { getInsuranceEstimateHtml, getInspectionHtml, getInsuranceTaxInvoiceHtml, getTemplateSettings } from "@/lib/pdfGenerator";
import { getClaimEstimateHtml } from "@/lib/insurancePdfTemplates";
import { formatDateLatin } from "@/lib/numberUtils";
import { nextWorkOrderNumber } from "@/lib/numbering";
import { saveClaimDocument } from "@/lib/uploadHtmlAsPdf";
import ClaimDocumentsPanel from "@/components/insurance/ClaimDocumentsPanel";
import { FolderArchive } from "lucide-react";
import TemplatePicker from "@/components/print/TemplatePicker";
import { buildZatcaQrDataUrl } from "@/lib/zatcaQr";
import { addWorkOrder, type WorkOrder, type NeededPart } from "@/lib/workOrdersStore";
import { inspectionsStore, type InspectionRecord } from "@/lib/inspectionsStore";
import InsuranceInspectionDialog from "@/components/inspection/InsuranceInspectionDialog";
import { insuranceInspectionStore } from "@/lib/insuranceInspectionStore";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";
import { buildInsuranceInspectionHtml } from "@/lib/insuranceInspectionPdf";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import InsuranceCompanyAutocomplete from "@/components/insurance/InsuranceCompanyAutocomplete";
import ClaimPaymentDialog from "@/components/insurance/ClaimPaymentDialog";
import { usePaymentsByClaim, PAYMENT_METHOD_LABELS, PAYMENT_STATUS_LABELS, useDeleteClaimPayment } from "@/hooks/useClaimPayments";
import { findOrCreateInsuranceCompany, useInsuranceCompany } from "@/hooks/useInsuranceCompanies";
import { useCreateInsuranceInvoice } from "@/hooks/useInsuranceInvoices";
import CancelClaimDialog from "@/components/insurance/CancelClaimDialog";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import UplItemsEditor, { type UplItem } from "@/components/insurance/UplItemsEditor";
import ClaimDeliverySection from "@/components/insurance/ClaimDeliverySection";
import InlineWorkOrderSummary from "@/components/insurance/InlineWorkOrderSummary";
import { XCircle } from "lucide-react";
import QuickEmailButton from "@/components/QuickEmailButton";
import SendInsuranceEmailDialog from "@/components/insurance/SendInsuranceEmailDialog";
import { useClaimDocuments } from "@/hooks/useClaimDocuments";
import { Mail, Send } from "lucide-react";
import Can from "@/components/Can";


const insuranceCompanies = [
  "التعاونية", "بوبا", "الراجحي", "ميدغلف", "ملاذ", "وفاء", "سلامة",
  "الاتحاد التجاري", "أليانز", "تكافل الراجحي", "أخرى",
];

const docTypeLabels: Record<string, string> = {
  police_report: "تقرير الشرطة",
  claim_form: "استمارة مطالبة",
  quote: "عرض سعر",
  inspection_report: "تقرير الفحص",
  lpo: "أمر شراء (LPO)",
  other: "مستند آخر",
};

const STAGE_FLOW: { key: string; label: string; status: "pending" | "approved" | "rejected" | "paid" | "any" }[] = [
  { key: "inspect", label: "فحص", status: "any" },
  { key: "estimate", label: "تقدير", status: "any" },
  { key: "approval", label: "موافقة", status: "any" },
  { key: "workorder", label: "أمر عمل", status: "approved" },
];

export default function InsuranceClaimDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isNew = !id || id === "new";

  const { data: existing, isLoading } = useClaim(isNew ? undefined : id);
  const createClaim = useCreateClaim();
  const updateClaim = useUpdateClaim();
  const deleteClaim = useDeleteClaim();
  const updateStatus = useUpdateClaimStatus();

  // ── Core state ──
  const [tab, setTab] = useState<string>("inspect");

  // Insurance company (primary "customer"/payer)
  const [company, setCompany] = useState("");
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [claimNumber, setClaimNumber] = useState("");
  const [lpoNumber, setLpoNumber] = useState("");

  // Vehicle owner (secondary — for contact/handover)
  const [customerId, setCustomerId] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");

  // Vehicle inline data (saved with claim even without vehicle_id)
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [vehiclePlate, setVehiclePlate] = useState("");
  const [vehicleYear, setVehicleYear] = useState("");
  const [vehicleColor, setVehicleColor] = useState("");
  const [vehicleVin, setVehicleVin] = useState("");

  // Inspection / estimate / status
  const [estimatedCost, setEstimatedCost] = useState("");
  const [approvedAmount, setApprovedAmount] = useState("");
  const [estimationType, setEstimationType] = useState<"lump_sum" | "upl">("lump_sum");
  const [uplItems, setUplItems] = useState<UplItem[]>([]);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "paid" | "cancelled">("pending");
  const [rejectionReason, setRejectionReason] = useState("");
  const [notes, setNotes] = useState("");

  // ── Workflow date tracking ──
  const [estimateDate, setEstimateDate] = useState<string>("");
  const [workshopArrivalDate, setWorkshopArrivalDate] = useState<string>("");
  const [workStartedAt, setWorkStartedAt] = useState<string>("");
  const [workCompletedAt, setWorkCompletedAt] = useState<string>("");

  // Media & docs
  const [damagePhotos, setDamagePhotos] = useState<string[]>([]);
  const [documents, setDocuments] = useState<ClaimDocument[]>([]);
  const [neededParts, setNeededParts] = useState<ClaimNeededPart[]>([]);

  // Linked work order (after conversion)
  const [linkedWorkOrderId, setLinkedWorkOrderId] = useState<string | null>(null);
  const [showWorkOrderInline, setShowWorkOrderInline] = useState(false);

  // Linked inspection (from inspection module)
  const [linkedInspection, setLinkedInspection] = useState<InspectionRecord | null>(null);
  const [showInspectionPicker, setShowInspectionPicker] = useState(false);
  const [showNewInspection, setShowNewInspection] = useState(false);
  const [inspectionsBefore, setInspectionsBefore] = useState<string[]>([]);

  const [uploading, setUploading] = useState(false);
  const [showPdf, setShowPdf] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [showInspectionPdf, setShowInspectionPdf] = useState(false);
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [showTaxInvoice, setShowTaxInvoice] = useState(false);
  const [taxInvoiceHtml, setTaxInvoiceHtml] = useState<string>("");
  const [taxInvoiceNumber, setTaxInvoiceNumber] = useState<string>("");
  const [showSendEmail, setShowSendEmail] = useState(false);

  // ── شروط/ملاحظات تقدير الإصلاح (محرّرة، تُحفظ محلياً لكل tenant) ──
  const DEFAULT_ESTIMATE_TERMS = [
    "هذا التقدير ساري لمدة 30 يوماً من تاريخ الإصدار.",
    "الأسعار خاضعة للمراجعة عند اكتشاف أضرار خفية أثناء الفك.",
    "العمل لا يبدأ إلا بعد الموافقة الخطية من شركة التأمين.",
    "أي قطع إضافية أو خدمات خارج البنود المُدرجة تُحتسب بشكل منفصل.",
    "مدة الإصلاح المقدّرة تبدأ من تاريخ توفر القطع المعتمدة.",
  ].join("\n");
  const [estimateTerms, setEstimateTerms] = useState<string>(DEFAULT_ESTIMATE_TERMS);
  const estimateTermsHydratedRef = useRef(false);
  useEffect(() => {
    let cancelled = false;
    void readCloudSetting("claim_estimate_terms", DEFAULT_ESTIMATE_TERMS).then((value) => {
      if (cancelled) return;
      setEstimateTerms(value);
      estimateTermsHydratedRef.current = true;
    });
    const unsubscribe = subscribeCloudSetting<string>("claim_estimate_terms", (value) => {
      if (!cancelled && typeof value === "string") setEstimateTerms(value);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  useEffect(() => {
    if (!estimateTermsHydratedRef.current) return;
    const timer = setTimeout(() => {
      void writeCloudSetting("claim_estimate_terms", estimateTerms).catch(() => {});
    }, 500);
    return () => clearTimeout(timer);
  }, [estimateTerms]);
  const [showEstimateTerms, setShowEstimateTerms] = useState(false);

  const { data: customers } = useCustomers();
  const { data: vehicles } = useVehiclesByCustomer(customerId || null);
  const { data: insuranceCo } = useInsuranceCompany(companyId || undefined);
  const queryClient = useQueryClient();

  // Hydrate from DB
  useEffect(() => {
    if (!existing) return;
    setCompany(existing.insurance_company || "");
    setCompanyId((existing as any).insurance_company_id ?? null);
    setClaimNumber(existing.claim_number || "");
    setCustomerId(existing.customer_id || "");
    setVehicleId(existing.vehicle_id || "");
    setOwnerName(existing.vehicle_owner_name ?? "");
    setOwnerPhone(existing.vehicle_owner_phone ?? "");
    setEstimatedCost(String(existing.estimated_cost ?? existing.estimated_amount ?? ""));
    setApprovedAmount(String(existing.approved_amount ?? ""));
    setEstimationType(((existing as any).estimation_type as "lump_sum" | "upl") ?? "lump_sum");
    setUplItems(((existing as any).upl_items as UplItem[]) ?? []);
    setVehicleMake((existing as any).vehicle_make ?? "");
    setVehicleModel((existing as any).vehicle_model ?? "");
    setVehiclePlate((existing as any).vehicle_plate ?? "");
    setVehicleYear((existing as any).vehicle_year ? String((existing as any).vehicle_year) : "");
    setVehicleColor((existing as any).vehicle_color ?? "");
    setVehicleVin((existing as any).vehicle_vin ?? "");
    setStatus(existing.status);
    setRejectionReason(existing.rejection_reason ?? "");
    const rawNotes = existing.notes ?? "";
    const lpoMatch = rawNotes.match(/\[LPO:([^\]]+)\]/);
    setLpoNumber(lpoMatch ? lpoMatch[1].trim() : "");
    setNotes(rawNotes);
    setDamagePhotos(existing.damage_photos ?? []);
    setDocuments(existing.documents ?? []);
    setNeededParts(existing.needed_parts ?? []);
    setLinkedWorkOrderId(existing.job_order_id);
    const createdAtStr = existing.created_at ? String(existing.created_at).slice(0, 10) : "";
    setEstimateDate((existing as any).estimate_date ?? createdAtStr);
    setWorkshopArrivalDate((existing as any).workshop_arrival_date ?? "");
    const ws = (existing as any).work_started_at;
    setWorkStartedAt(ws ? String(ws).slice(0, 10) : "");
    const wc = (existing as any).work_completed_at;
    setWorkCompletedAt(wc ? String(wc).slice(0, 10) : "");
  }, [existing]);

  const customer = customers?.find((c) => c.id === customerId);
  const vehicle = vehicles?.find((v) => v.id === vehicleId);

  // Auto-fill owner from selected customer
  useEffect(() => {
    if (customer && !ownerName) setOwnerName(customer.name);
    if (customer?.phone && !ownerPhone) setOwnerPhone(customer.phone);
  }, [customer]); // eslint-disable-line

  // ── Defensive ownership check ──
  // If the selected vehicle no longer belongs to the selected customer
  // (e.g. owner switched), drop the vehicle id and warn the user.
  const ownershipMismatch = useMemo(() => {
    if (!vehicleId || !customerId) return false;
    if (!vehicles) return false; // still loading — don't flag yet
    return !vehicles.some((v) => v.id === vehicleId);
  }, [vehicleId, customerId, vehicles]);

  useEffect(() => {
    if (ownershipMismatch) {
      setVehicleId("");
      toast.error("السيارة المختارة لا تنتمي للمالك الحالي — تم إلغاء الاختيار");
    }
  }, [ownershipMismatch]);

  /** Guarded vehicle setter — refuses any vehicle not in the customer's list. */
  const handleVehicleSelect = (vid: string) => {
    if (!customerId) {
      toast.error("اختر مالك السيارة أولاً");
      return;
    }
    const valid = vehicles?.some((v) => v.id === vid);
    if (!valid) {
      toast.error("هذه السيارة غير مسجلة باسم المالك المحدد");
      return;
    }
    setVehicleId(vid);
  };

  // ── Upload helpers ──
  // Files are scoped to claims/{claim_id}/{category}/ so storage RLS can verify
  // they belong to a real claim in the same tenant. We also write to claim_audit_logs.
  const uploadFile = async (
    file: File,
    category: "photos" | "docs" | "delivery" | "satisfaction" | "receiver_id",
  ): Promise<string | null> => {
    if (isNew || !id) {
      toast.error("احفظ المطالبة أولاً قبل رفع الملفات");
      return null;
    }
    setUploading(true);
    try {
      const { convertImageToWebp } = await import("@/lib/imageToWebp");
      const optimized = await convertImageToWebp(file);
      const ext = optimized.name.split(".").pop() || "bin";
      const path = `claims/${id}/${category}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { error } = await supabase.storage.from("insurance-docs").upload(path, optimized, { contentType: optimized.type });
      if (error) throw error;
      const { data } = await supabase.storage.from("insurance-docs").createSignedUrl(path, 60 * 60 * 24 * 7);

      // audit log (best-effort)
      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      if (tenant) {
        await supabase.from("claim_audit_logs").insert({
          tenant_id: tenant as string,
          claim_id: id,
          action: "upload_photo",
          category,
          file_path: path,
          details: { name: file.name, size: file.size, type: file.type },
        });
      }
      return data?.signedUrl ?? null;
    } catch (e: any) {
      toast.error("فشل رفع الملف: " + e.message);
      return null;
    } finally {
      setUploading(false);
    }
  };

  const handlePhotoUpload = async (files: FileList | null) => {
    if (!files?.length) return;
    const uploaded: string[] = [];
    for (const f of Array.from(files)) {
      const url = await uploadFile(f, "photos");
      if (url) uploaded.push(url);
    }
    setDamagePhotos((p) => [...p, ...uploaded]);
  };

  const handleDocUpload = async (files: FileList | null, type: string) => {
    if (!files?.length) return;
    const newDocs: ClaimDocument[] = [];
    for (const f of Array.from(files)) {
      const url = await uploadFile(f, "docs");
      if (url) newDocs.push({ url, name: f.name, type });
    }
    setDocuments((d) => [...d, ...newDocs]);

    // ── LPO auto-approve: عند رفع أمر الشراء، أصدر الفاتورة الضريبية تلقائياً ──
    if (type === "lpo" && newDocs.length > 0) {
      toast.success("تم رفع أمر الشراء (LPO) — جاري إصدار الفاتورة الضريبية تلقائياً…");
      // تأخير بسيط لضمان حفظ الحالة قبل توليد الفاتورة
      setTimeout(() => {
        try { generateTaxInvoice(); } catch (e) { console.warn("auto invoice on LPO failed", e); }
      }, 400);
    }
  };

  // Parts
  const addPart = () => setNeededParts((p) => [...p, { name: "", quantity: 1, notes: "" }]);
  const updatePart = (i: number, patch: Partial<ClaimNeededPart>) =>
    setNeededParts((p) => p.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const removePart = (i: number) => setNeededParts((p) => p.filter((_, idx) => idx !== i));

  // ── Inspection import ──
  const applyInspection = (ins: InspectionRecord) => {
    setLinkedInspection(ins);
    if (ins.damageType) {
      setNotes((n) => {
        const tag = `[فحص ${ins.id}] نوع الضرر: ${ins.damageType}`;
        return n.includes(ins.id) ? n : (n ? `${n}\n${tag}` : tag);
      });
    }
    toast.success(`تم ربط تقرير الفحص ${ins.id}`);
  };

  const openNewInspection = () => {
    setInspectionsBefore(inspectionsStore.getAll().map((i) => i.id));
    setShowNewInspection(true);
  };

  // After the new-inspection dialog closes, link the freshly created record.
  useEffect(() => {
    if (showNewInspection) return;
    if (inspectionsBefore.length === 0) return;
    const all = inspectionsStore.getAll();
    const beforeSet = new Set(inspectionsBefore);
    const created = all.find((i) => !beforeSet.has(i.id));
    if (created) applyInspection(created);
    setInspectionsBefore([]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showNewInspection]);

  // ── Smart owner: find or create a customer in Supabase by name/phone ──
  const findOrCreateCustomer = async (
    name: string,
    phone: string,
    tenantId: string,
  ): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) return null;
    const matchLocal = customers?.find(
      (c) => c.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (matchLocal) {
      if (phone && !matchLocal.phone) {
        await supabase.from("customers").update({ phone }).eq("id", matchLocal.id);
      }
      return matchLocal.id;
    }
    const { data, error } = await supabase
      .from("customers")
      .insert({ name: trimmed, phone: phone || null, tenant_id: tenantId })
      .select("id")
      .single();
    if (error) {
      toast.error("تعذّر إنشاء العميل: " + error.message);
      return null;
    }
    queryClient.invalidateQueries({ queryKey: ["customers"] });
    toast.success(`تم إضافة "${trimmed}" إلى قائمة العملاء`);
    return data.id;
  };

  // Computed UPL total
  const uplTotal = useMemo(
    () => uplItems.reduce((s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0), 0),
    [uplItems]
  );
  const effectiveEstimate = estimationType === "upl" ? uplTotal : (parseFloat(estimatedCost) || 0);

  // ── Save ──
  const buildPayload = async () => {
    const { data: tenant } = await supabase.rpc("get_user_tenant_id");
    if (!tenant) {
      toast.error("لم يتم التعرف على الورشة");
      return null;
    }
    return {
      tenant_id: tenant as string,
      customer_id: customerId,
      vehicle_id: vehicleId,
      job_order_id: linkedWorkOrderId,
      claim_number: claimNumber,
      insurance_company: company,
      insurance_company_id: companyId,
      estimated_amount: effectiveEstimate,
      estimated_cost: effectiveEstimate,
      approved_amount: parseFloat(approvedAmount) || 0,
      vehicle_owner_name: ownerName || null,
      vehicle_owner_phone: ownerPhone || null,
      vehicle_make: vehicleMake || null,
      vehicle_model: vehicleModel || null,
      vehicle_plate: vehiclePlate || null,
      vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
      vehicle_color: vehicleColor || null,
      vehicle_vin: vehicleVin.trim() || null,
      estimation_type: estimationType,
      upl_items: uplItems,
      notes: (() => {
        const cleaned = (notes || "").replace(/\[LPO:[^\]]+\]\n?/g, "").trim();
        const withLpo = lpoNumber.trim() ? `${cleaned}\n[LPO:${lpoNumber.trim()}]`.trim() : cleaned;
        return withLpo || undefined;
      })(),
      damage_photos: damagePhotos,
      documents,
      needed_parts: neededParts.filter((p) => p.name.trim()),
    };
  };

  const handleSave = async () => {
    if (!company || !claimNumber) {
      toast.error("يرجى إدخال: شركة التأمين ورقم المطالبة");
      return;
    }

    const { data: tenant } = await supabase.rpc("get_user_tenant_id");
    if (!tenant) {
      toast.error("لم يتم التعرف على الورشة");
      return;
    }

    // Smart customer: if no customerId yet, derive from owner name/phone
    let cId = customerId;
    if (!cId) {
      if (ownerName.trim()) {
        const created = await findOrCreateCustomer(ownerName, ownerPhone, tenant as string);
        if (!created) return;
        cId = created;
        setCustomerId(created);
      } else {
        toast.error("يرجى إدخال اسم مالك السيارة");
        return;
      }
    }

    // Smart insurance company: auto-create if user typed name but didn't pick one
    let insCompanyId = companyId;
    if (!insCompanyId && company.trim()) {
      try {
        insCompanyId = await findOrCreateInsuranceCompany(company, tenant as string);
        if (insCompanyId) setCompanyId(insCompanyId);
      } catch (e: any) {
        console.warn("Insurance company auto-create failed:", e.message);
      }
    }

    const payload = {
      tenant_id: tenant as string,
      customer_id: cId,
      vehicle_id: vehicleId || null,
      job_order_id: linkedWorkOrderId,
      claim_number: claimNumber,
      insurance_company: company,
      insurance_company_id: insCompanyId,
      estimated_amount: effectiveEstimate,
      estimated_cost: effectiveEstimate,
      approved_amount: parseFloat(approvedAmount) || 0,
      vehicle_owner_name: ownerName || null,
      vehicle_owner_phone: ownerPhone || null,
      vehicle_make: vehicleMake || null,
      vehicle_model: vehicleModel || null,
      vehicle_plate: vehiclePlate || null,
      vehicle_year: vehicleYear ? parseInt(vehicleYear) : null,
      vehicle_color: vehicleColor || null,
      vehicle_vin: vehicleVin.trim() || null,
      estimation_type: estimationType,
      upl_items: uplItems,
      notes: notes || undefined,
      damage_photos: damagePhotos,
      documents,
      needed_parts: neededParts.filter((p) => p.name.trim()),
      estimate_date: estimateDate || null,
      workshop_arrival_date: workshopArrivalDate || null,
      work_started_at: workStartedAt ? new Date(workStartedAt).toISOString() : null,
    };

    if (isNew) {
      createClaim.mutate(payload, {
        onSuccess: (d: any) => navigate(`/insurance/${d.id}`, { replace: true }),
      });
    } else {
      updateClaim.mutate({ id: id!, updates: payload });
    }
  };

  const handleDelete = () => {
    if (!id || isNew) return;
    if (!confirm("هل أنت متأكد من حذف هذه المطالبة؟")) return;
    deleteClaim.mutate(id, { onSuccess: () => navigate("/insurance") });
  };

  // ── Approve ──
  // عند الموافقة: trigger في DB ينشئ أمر العمل تلقائياً ويربطه بـ auto_job_order_id.
  // بعدها: (1) نزامن بيانات السيارة المُدخلة في المطالبة على سجل vehicles
  // (2) لا ننتقل تلقائياً — نترك المستخدم يختار "عرض هنا" أو "فتح في الصفحة" أو "متابعة للتسليم".
  const handleApprove = async () => {
    if (!id || isNew) {
      toast.error("احفظ المطالبة أولاً");
      return;
    }
    if (!approvedAmount) {
      toast.error("أدخل المبلغ الموافق عليه");
      return;
    }
    if (!workshopArrivalDate) {
      toast.warning("تحذير: لم يتم إدخال تاريخ وصول السيارة للورشة — يُفضّل إدخاله قبل اعتماد المطالبة.");
      // نستمر في الاعتماد لكن نحذر فقط
    }
    updateStatus.mutate(
      { id, status: "approved", approved_amount: parseFloat(approvedAmount) },
      {
        onSuccess: async () => {
          setStatus("approved");
          await queryClient.invalidateQueries({ queryKey: ["insurance_claims", id] });
          // اقرأ المطالبة المحدّثة من DB لمعرفة WO المُنشأ
          const { data: refreshed } = await supabase
            .from("insurance_claims" as any)
            .select("auto_job_order_id, job_order_id, vehicle_id")
            .eq("id", id)
            .maybeSingle();
          const r = refreshed as any;
          const woId = r?.auto_job_order_id || r?.job_order_id;

          // ── مزامنة بيانات السيارة من حقول المطالبة على سجل السيارة المرتبطة ──
          if (r?.vehicle_id) {
            const vehiclePatch: any = {};
            if (vehicleMake)  vehiclePatch.brand = vehicleMake;
            if (vehicleModel) vehiclePatch.model = vehicleModel;
            if (vehiclePlate) vehiclePatch.plate_number = vehiclePlate;
            if (vehicleYear)  vehiclePatch.year = parseInt(vehicleYear) || null;
            if (vehicleColor) vehiclePatch.color = vehicleColor;
            if (Object.keys(vehiclePatch).length) {
              const { error: vErr } = await supabase
                .from("vehicles")
                .update(vehiclePatch)
                .eq("id", r.vehicle_id);
              if (vErr) console.warn("vehicle sync failed:", vErr.message);
            }
          }

          if (woId) {
            setLinkedWorkOrderId(woId);
            setTab("workorder"); // الانتقال لتبويب أمر العمل (لكن بدون فتح صفحة منفصلة)
            toast.success("تمت الموافقة وتم إنشاء أمر العمل تلقائياً", {
              description: "اختر: عرض هنا، فتح صفحة كاملة، أو الانتقال للتسليم",
              duration: 8000,
            });
          } else {
            toast.success("تمت الموافقة على المطالبة");
            setTab("workorder");
          }
        },
      }
    );
  };

  const handleReject = () => {
    if (!id || isNew) return;
    if (!rejectionReason.trim()) {
      toast.error("أدخل سبب الرفض");
      return;
    }
    updateStatus.mutate(
      { id, status: "rejected", rejection_reason: rejectionReason },
      { onSuccess: () => setStatus("rejected") }
    );
  };

  // ── Convert to Work Order ──
  const handleConvertToWorkOrder = async () => {
    if (status !== "approved") {
      toast.error("يجب الموافقة على المطالبة أولاً");
      return;
    }
    // ── Smart fallback: use inline claim fields when relational vehicle/customer are missing
    const effectivePlate = (vehicle?.plate_number || vehiclePlate || "").trim();
    const effectiveMake  = (vehicle?.brand        || vehicleMake  || "").trim();
    const effectiveModel = (vehicle?.model        || vehicleModel || "").trim();
    const effectiveYear  = String(vehicle?.year ?? vehicleYear ?? "").trim();
    const effectiveCustomerName = (customer?.name || ownerName || "").trim();
    const effectivePhone        = (ownerPhone || customer?.phone || "").trim();

    // Validate with precise messages so the user knows EXACTLY what's missing
    const missing: string[] = [];
    if (!effectivePlate)        missing.push("رقم لوحة السيارة");
    if (!effectiveMake)         missing.push("ماركة السيارة");
    if (!effectiveModel)        missing.push("موديل السيارة");
    if (!effectiveCustomerName) missing.push("اسم مالك السيارة");
    if (!company)               missing.push("شركة التأمين");
    if (!claimNumber)           missing.push("رقم المطالبة");
    if (missing.length > 0) {
      toast.error(`الحقول الناقصة: ${missing.join("، ")}`, {
        description: "أكمل البيانات في تبويب «معلومات المطالبة» ثم أعد المحاولة.",
        duration: 7000,
      });
      return;
    }

    const newId = nextWorkOrderNumber();
    const partsForOrder: NeededPart[] = neededParts
      .filter((p) => p.name.trim())
      .map((p, i) => ({
        id: `${newId}-p${i}`,
        name: p.name,
        quantity: p.quantity || 1,
        notes: p.notes,
        status: "pending",
      }));

    const order: WorkOrder = {
      id: newId,
      customer: company || effectiveCustomerName, // payer = insurance company
      phone: effectivePhone,
      plate: effectivePlate,
      vehicleType: effectiveMake,
      model: effectiveModel,
      year: effectiveYear,
      vin: "",
      insurance: company,
      claimNumber: claimNumber,
      entryDate: new Date().toISOString().slice(0, 10),
      technician: "",
      serviceType: "إصلاح تأمين",
      status: "بانتظار قطع الغيار",
      totalCost: parseFloat(approvedAmount) || 0,
      description: `محوّل من مطالبة تأمين ${claimNumber} — ${company}\nمالك السيارة: ${effectiveCustomerName} (${effectivePhone || "—"})`,
      partsCost: 0,
      laborCost: 0,
      partsNeeded: partsForOrder,
      // Embed damage photos as stage photos under "inspection".
      // Filter out missing/empty URLs and preserve original order so the
      // claim's gallery matches the work order's inspection phase exactly.
      photos: damagePhotos
        .filter((url) => typeof url === "string" && url.trim().length > 0)
        .map((url, i) => ({
          id: `${newId}-ph${i}`,
          phase: "inspection" as const,
          dataUrl: url,
          caption: `صورة ضرر ${i + 1} — مطالبة ${claimNumber}`,
          uploadedAt: new Date().toISOString(),
        })),
    };

    const validCount = damagePhotos.filter((u) => u && u.trim()).length;
    const missingCount = damagePhotos.length - validCount;
    if (missingCount > 0) {
      toast.warning(`تم تجاهل ${missingCount} صورة بروابط مفقودة عند نقلها لأمر العمل`);
    }

    addWorkOrder(order);

    // Link claim to the new work order id is not possible (job_order_id requires UUID).
    // Instead, persist linkage in notes and update local state.
    const linkNote = `\n\n[تم إنشاء أمر عمل: ${newId}]`;
    if (id && !isNew) {
      updateClaim.mutate({
        id,
        updates: { notes: (notes || "") + linkNote },
      });
      setNotes((notes || "") + linkNote);
    }

    toast.success(`تم إنشاء أمر العمل ${newId} بنجاح`);
    navigate(`/work-orders/${newId}`);
  };

  // ── PDF ──
  // ── Inspection report PDF (uses the linked inspection + claim's photos) ──
  // For insurance-kind inspections we use the dedicated Al Madina Takaful template
  // (which renders item-level comments + REPAIR/SUSPECT/REPLACE marks correctly),
  // and we always append a final page gallery with all damage photos.
  const buildInspectionPdf = () => {
    const ins = linkedInspection;
    const veh = vehicle
      ? `${vehicle.brand} ${vehicle.model}${vehicle.year ? ` - ${vehicle.year}` : ""} • ${vehicle.plate_number}`
      : ins?.vehicle || "—";

    // Damage photos page (appended to whichever template we use)
    const photosGallery = damagePhotos.length
      ? `<div class="page" style="page-break-before:always;">
          <h2 style="text-align:center;font-size:18px;margin-bottom:14px;color:#1a1a2e;">
            صور الأضرار / Damage Photos (${damagePhotos.length})
          </h2>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px;">
            ${damagePhotos.map((url, i) => `
              <div style="border:1px solid #e2e8f0;border-radius:6px;overflow:hidden;background:#fafafa;page-break-inside:avoid;">
                <img src="${url}" style="width:100%;height:220px;object-fit:cover;display:block;"
                     onerror="this.style.display='none';this.nextElementSibling.style.display='flex';"/>
                <div style="display:none;height:220px;align-items:center;justify-content:center;color:#94a3b8;font-size:11px;">
                  ⚠️ تعذّر تحميل الصورة
                </div>
                <div style="padding:6px;font-size:10.5px;text-align:center;color:#64748b;">صورة ${i + 1} / Photo ${i + 1}</div>
              </div>
            `).join("")}
          </div>
        </div>`
      : "";

    // ── Insurance-kind: use Al Madina Takaful template with full saved payload ──
    const insurancePayload = ins ? insuranceInspectionStore.get(ins.id) : null;
    if (ins?.kind === "insurance" || insurancePayload) {
      const payload = insurancePayload || {
        reportNo: ins?.id || `INS-${claimNumber || "TMP"}`,
        date: ins?.date || new Date().toISOString().slice(0, 10),
        claimNo: claimNumber || "",
        regNo: vehicle?.plate_number || vehiclePlate || "",
        gatePass: "",
        garageName: "Alwafa Integrated Services",
        makeModel: veh,
        modelYear: vehicle?.year ? String(vehicle.year) : (vehicleYear || ""),
        area: "",
        type: "",
        workshopGrade: "A",
        insuranceCompany: company || "",
        remarks: notes || "",
        surveyorName: "",
        sections: [],
        annotatedImages: [],
      } as any;
      const html = buildInsuranceInspectionHtml(payload);
      return photosGallery ? html.replace("</body>", `${photosGallery}</body>`) : html;
    }

    // ── Fallback: legacy general inspection template ──
    const html = getInspectionHtml({
      inspectionId: ins?.id || `INS-${claimNumber || "TMP"}`,
      workOrderId: ins?.workOrder && ins.workOrder !== "—" ? ins.workOrder : `مطالبة ${claimNumber}`,
      date: ins?.date || new Date().toISOString().slice(0, 10),
      customerName: ownerName || ins?.customer || company,
      vehicleInfo: veh,
      damageType: ins?.damageType || "—",
      photoCount: damagePhotos.length,
      status: ins?.status || "قيد الفحص",
      notes: notes || undefined,
    } as any);

    const ownerBlock = `
      <div style="margin:14px 0;padding:12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;">
        <div style="font-weight:700;color:#1e3a8a;margin-bottom:6px;">بيانات المالك وشركة التأمين / Owner & Insurer</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;">
          <div><strong>المالك:</strong> ${ownerName || "—"}</div>
          <div><strong>الهاتف:</strong> ${ownerPhone || "—"}</div>
          <div><strong>شركة التأمين:</strong> ${company || "—"}</div>
          <div><strong>رقم المطالبة:</strong> ${claimNumber || "—"}</div>
        </div>
      </div>`;

    let withOwner = html.replace("</div>\n\n    ${sectionTitle", `</div>${ownerBlock}\n\n    \${sectionTitle`);
    if (withOwner === html) withOwner = html.replace("</body>", `${ownerBlock}</body>`);
    return photosGallery ? withOwner.replace("</body>", `${photosGallery}</body>`) : withOwner;
  };

  const buildPdf = useMemo(() => () => {
    const ex: any = existing || {};
    const subtotal = parseFloat(estimatedCost) || 0;
    const cleanEstimateText = (text?: string | null) =>
      (text || "")
        .replace(/\[LPO:[^\]]+\]\n?/gi, "")
        .split("\n")
        .filter((line) => !/\bLPO\b/i.test(line))
        .join("\n")
        .trim();

    const estimateDateStr = estimateDate
      ? formatDateLatin(estimateDate)
      : (ex.estimate_date ? formatDateLatin(ex.estimate_date) : (ex.incident_date ? formatDateLatin(ex.incident_date) : formatDateLatin(new Date())));
    const html = getClaimEstimateHtml({
      claimNumber: claimNumber || "—",
      date: estimateDateStr,
      insuranceCompany: company || "—",
      policyNumber: ex.policy_number || null,
      policyExpiry: ex.policy_expiry_date ? formatDateLatin(ex.policy_expiry_date) : null,
      adjusterName: ex.adjuster_name || null,
      adjusterPhone: ex.adjuster_phone || null,
      incidentDate: estimateDateStr,
      incidentLocation: ex.incident_location || null,
      incidentDescription: ex.incident_description || null,
      customerName: ownerName || null,
      customerPhone: ownerPhone || null,
      vehicle: {
        make: vehicle?.brand || vehicleMake || null,
        model: vehicle?.model || vehicleModel || null,
        plate: vehicle?.plate_number || vehiclePlate || null,
        year: vehicle?.year || (vehicleYear ? Number(vehicleYear) : null),
        color: (vehicle as any)?.color || vehicleColor || null,
        vin: (vehicle as any)?.vin_number || (vehicle as any)?.vin || vehicleVin || null,
      },
      estimationType,
      lumpSumAmount: subtotal,
      uplItems: estimationType === "upl" ? (uplItems || []).map((u: any) => ({
        description: u.description || "",
        quantity: Number(u.quantity) || 1,
        unit_price: Number(u.unit_price) || 0,
      })) : undefined,
      approvedAmount: approvedAmount ? parseFloat(approvedAmount) : null,
      deductibleAmount: Number(ex.deductible_amount) || 0,
      notes: [cleanEstimateText(estimateTerms), cleanEstimateText(notes)].filter(Boolean).join("\n\n") || null,
      damagePhotos: damagePhotos || [],
    });
    return html;
  }, [existing, vehicle, claimNumber, company, ownerName, ownerPhone, vehicleMake, vehicleModel, vehiclePlate, vehicleYear, vehicleColor, estimatedCost, approvedAmount, estimationType, uplItems, notes, estimateTerms, damagePhotos, estimateDate]);

  // ── ملخص شامل للمطالبة (مختلف عن "تقدير المطالبة") ──
  const { data: claimPayments = [] } = usePaymentsByClaim(id);
  const { data: claimDocs = [] } = useClaimDocuments(isNew ? undefined : id);
  const buildSummaryPdf = useMemo(() => () => {
    const tpl = getTemplateSettings();
    const fmt = (n: number) => new Intl.NumberFormat("ar-OM", { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(n || 0);
    const safe = (v: any) => (v === null || v === undefined || v === "" ? "—" : String(v));
    const dateStr = (d: any) => formatDateLatin(d);

    const vehLine = (vehicle ? `${vehicle.brand} ${vehicle.model}${vehicle.year ? ` - ${vehicle.year}` : ""}` : `${vehicleMake} ${vehicleModel}${vehicleYear ? ` - ${vehicleYear}` : ""}`).trim() || "—";
    const plate = vehicle?.plate_number || vehiclePlate || "—";
    const color = (vehicle as any)?.color || vehicleColor || "—";

    const totalPaid = (claimPayments || []).reduce((s: number, p: any) => s + (Number(p.amount) || 0), 0);
    const approvedNum = parseFloat(approvedAmount) || 0;
    const estimatedNum = parseFloat(estimatedCost) || 0;
    const remaining = Math.max(0, approvedNum - totalPaid);
    const statusLabel = ({ pending: "بانتظار الموافقة", approved: "تمت الموافقة", rejected: "مرفوضة", paid: "مدفوعة", cancelled: "ملغاة" } as any)[status] || status;

    const partsRows = (neededParts || []).filter((p) => p.name?.trim()).map((p, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${safe(p.name)}</td><td style="text-align:center">${p.quantity || 1}</td><td>${safe(p.notes)}</td></tr>`).join("") || `<tr><td colspan="4" style="text-align:center;color:#888">لا توجد قطع مسجلة</td></tr>`;

    const docsRows = (documents || []).map((d, i) => `<tr><td style="text-align:center">${i + 1}</td><td>${safe(d.name)}</td><td style="text-align:center">${docTypeLabels[d.type] || d.type}</td></tr>`).join("") || `<tr><td colspan="3" style="text-align:center;color:#888">لا توجد مستندات</td></tr>`;

    const paymentRows = (claimPayments || []).map((p: any, i: number) => `<tr><td style="text-align:center">${i + 1}</td><td style="text-align:center">${dateStr(p.payment_date)}</td><td style="text-align:center">${PAYMENT_METHOD_LABELS[p.payment_method] || p.payment_method}</td><td style="text-align:center">${PAYMENT_STATUS_LABELS[p.status] || p.status}</td><td style="text-align:center">${safe(p.reference_number)}</td><td style="text-align:left;font-weight:600">${fmt(Number(p.amount))} ر.ع</td></tr>`).join("") || `<tr><td colspan="6" style="text-align:center;color:#888">لا توجد دفعات</td></tr>`;

    const photosBlock = damagePhotos.length ? `<div class="section"><h3>صور الأضرار (${damagePhotos.length})</h3><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">${damagePhotos.slice(0, 9).map((u, i) => `<div style="border:1px solid #ddd;border-radius:4px;overflow:hidden"><img src="${u}" style="width:100%;height:120px;object-fit:cover;display:block" crossorigin="anonymous"/><div style="font-size:10px;text-align:center;padding:3px;background:#f7f7f7">صورة ${i + 1}</div></div>`).join("")}</div></div>` : "";

    return `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"/><title>ملخص مطالبة ${claimNumber}</title>
<style>
@page { size: A4; margin: 12mm; }
* { box-sizing: border-box; }
body { font-family: 'Tajawal','Cairo',Arial,sans-serif; color:#1a1a1a; margin:0; padding:0; font-size:12px; line-height:1.55; }
.page { padding: 8mm; background:#fff; }
.hd { display:flex; justify-content:space-between; align-items:center; border-bottom:3px double #1e3a8a; padding-bottom:10px; margin-bottom:14px; }
.hd h1 { margin:0; font-size:20px; color:#1e3a8a; }
.hd .meta { font-size:11px; color:#555; text-align:left; }
.badge { display:inline-block; padding:2px 10px; border-radius:14px; font-size:11px; font-weight:700; }
.b-pending { background:#fff3cd; color:#a36b00; }
.b-approved { background:#d4edda; color:#0f6b3a; }
.b-rejected { background:#f8d7da; color:#a02234; }
.b-paid { background:#cfe9ff; color:#0a4f8c; }
.b-cancelled { background:#e9ecef; color:#666; text-decoration:line-through; }
.section { margin-bottom:14px; page-break-inside: avoid; }
.section h3 { background:linear-gradient(90deg,#1e3a8a,#2563eb); color:#fff; padding:6px 12px; margin:0 0 8px; font-size:13px; border-radius:4px; }
.grid2 { display:grid; grid-template-columns:1fr 1fr; gap:8px 16px; }
.grid3 { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px 16px; }
.field { display:flex; gap:6px; padding:4px 0; border-bottom:1px dashed #e3e3e3; }
.field b { color:#444; min-width:120px; }
table { width:100%; border-collapse:collapse; font-size:11px; }
th, td { border:1px solid #d0d0d0; padding:5px 7px; }
th { background:#f0f4ff; color:#1e3a8a; font-weight:700; }
.totals { display:grid; grid-template-columns:1fr 1fr 1fr; gap:8px; margin-top:10px; }
.totals .box { border:1px solid #d0d0d0; border-radius:6px; padding:8px 10px; background:#fafbff; }
.totals .box .lbl { font-size:10px; color:#666; }
.totals .box .val { font-size:14px; font-weight:800; color:#1e3a8a; }
.ft { margin-top:18px; border-top:1px solid #ccc; padding-top:8px; font-size:10px; color:#666; text-align:center; }
</style></head><body>
<div class="page">
  <div class="hd">
    <div>
      <h1>ملخص مطالبة تأمين</h1>
      <div style="font-size:11px;color:#555;margin-top:4px">${tpl.companyName || "ورشة"} ${tpl.vatNumber ? `• الرقم الضريبي: ${tpl.vatNumber}` : ""}</div>
    </div>
    <div class="meta">
      <div><b>رقم المطالبة:</b> ${safe(claimNumber)}</div>
      <div><b>تاريخ الطباعة:</b> ${formatDateLatin(new Date())}</div>
      <div style="margin-top:4px"><span class="badge b-${status}">${statusLabel}</span></div>
    </div>
  </div>

  <div class="section"><h3>بيانات شركة التأمين</h3>
    <div class="grid2">
      <div class="field"><b>الشركة:</b> ${safe(company)}</div>
      <div class="field"><b>السجل التجاري:</b> ${safe(insuranceCo?.commercial_registration)}</div>
      <div class="field"><b>الرقم الضريبي:</b> ${safe(insuranceCo?.tax_number)}</div>
      <div class="field"><b>الهاتف:</b> ${safe(insuranceCo?.phone)}</div>
      <div class="field"><b>البريد:</b> ${safe(insuranceCo?.email)}</div>
      <div class="field"><b>صندوق البريد:</b> ${safe(insuranceCo?.po_box)}</div>
      <div class="field"><b>المعاين (Adjuster):</b> ${safe((existing as any)?.adjuster_name)}</div>
      <div class="field"><b>هاتف المعاين:</b> ${safe((existing as any)?.adjuster_phone)}</div>
      <div class="field"><b>رقم الوثيقة:</b> ${safe((existing as any)?.policy_number)}</div>
      <div class="field"><b>انتهاء الوثيقة:</b> ${dateStr((existing as any)?.policy_expiry_date)}</div>
    </div>
  </div>

  <div class="section"><h3>بيانات مالك المركبة</h3>
    <div class="grid2">
      <div class="field"><b>الاسم:</b> ${safe(ownerName)}</div>
      <div class="field"><b>الهاتف:</b> ${safe(ownerPhone)}</div>
    </div>
  </div>

  <div class="section"><h3>بيانات المركبة</h3>
    <div class="grid3">
      <div class="field"><b>النوع/الموديل:</b> ${vehLine}</div>
      <div class="field"><b>اللوحة:</b> ${plate}</div>
      <div class="field"><b>اللون:</b> ${color}</div>
      <div class="field"><b>رقم الشاصي (VIN):</b> ${safe((vehicle as any)?.vin_number)}</div>
      <div class="field"><b>سنة الصنع:</b> ${safe(vehicle?.year || vehicleYear)}</div>
    </div>
  </div>

  <div class="section"><h3>تفاصيل الحادث</h3>
    <div class="grid2">
      <div class="field"><b>تاريخ التقدير:</b> ${dateStr(estimateDate || (existing as any)?.estimate_date || (existing as any)?.incident_date || (existing as any)?.created_at)}</div>
      <div class="field"><b>موقع الحادث:</b> ${safe((existing as any)?.incident_location)}</div>
    </div>
    <div class="field" style="margin-top:4px"><b>الوصف:</b> ${safe((existing as any)?.incident_description)}</div>
  </div>

  ${linkedInspection ? `<div class="section"><h3>تقرير الفحص المرتبط</h3>
    <div class="grid2">
      <div class="field"><b>رقم الفحص:</b> ${safe(linkedInspection.id)}</div>
      <div class="field"><b>تاريخ الفحص:</b> ${safe(linkedInspection.date)}</div>
      <div class="field"><b>نوع الضرر:</b> ${safe(linkedInspection.damageType)}</div>
      <div class="field"><b>المركبة:</b> ${safe(linkedInspection.vehicle)}</div>
    </div>
  </div>` : ""}

  <div class="section"><h3>قطع الغيار المطلوبة (${neededParts.filter((p) => p.name?.trim()).length})</h3>
    <table><thead><tr><th style="width:6%">#</th><th>اسم القطعة</th><th style="width:10%">الكمية</th><th>ملاحظات</th></tr></thead><tbody>${partsRows}</tbody></table>
  </div>

  <div class="section"><h3>التقدير المالي والموافقة</h3>
    <div class="grid2">
      <div class="field"><b>نوع التقدير:</b> ${estimationType === "upl" ? "UPL (قائمة بنود)" : "Lump Sum (مبلغ مقطوع)"}</div>
      <div class="field"><b>التحمل (Deductible):</b> ${fmt(Number((existing as any)?.deductible_amount) || 0)} ر.ع</div>
    </div>
    <div class="totals">
      <div class="box"><div class="lbl">المبلغ المقدّر</div><div class="val">${fmt(estimatedNum)} ر.ع</div></div>
      <div class="box"><div class="lbl">المبلغ المعتمد</div><div class="val">${fmt(approvedNum)} ر.ع</div></div>
      <div class="box"><div class="lbl">المتبقي للسداد</div><div class="val">${fmt(remaining)} ر.ع</div></div>
    </div>
    ${rejectionReason ? `<div style="margin-top:8px;padding:8px;background:#fff5f5;border:1px solid #f5c2c7;border-radius:4px;color:#a02234"><b>سبب الرفض:</b> ${safe(rejectionReason)}</div>` : ""}
    ${notes ? `<div style="margin-top:8px;padding:8px;background:#fffbe6;border:1px solid #ffe69c;border-radius:4px"><b>ملاحظات:</b> ${safe(notes)}</div>` : ""}
  </div>

  <div class="section"><h3>المستندات (${documents.length})</h3>
    <table><thead><tr><th style="width:6%">#</th><th>الاسم</th><th style="width:25%">النوع</th></tr></thead><tbody>${docsRows}</tbody></table>
  </div>

  <div class="section"><h3>الدفعات (${claimPayments.length}) — إجمالي مدفوع: ${fmt(totalPaid)} ر.ع</h3>
    <table><thead><tr><th style="width:5%">#</th><th>التاريخ</th><th>الطريقة</th><th>الحالة</th><th>المرجع</th><th style="width:18%">المبلغ</th></tr></thead><tbody>${paymentRows}</tbody></table>
  </div>

  ${photosBlock}

  <div class="ft">هذا الملخص أُنشئ تلقائياً من نظام ${tpl.companyName || "إدارة المطالبات"} • ${new Date().toLocaleString("ar-OM")}</div>
</div>
</body></html>`;
  }, [
    claimNumber, status, company, insuranceCo, ownerName, ownerPhone,
    vehicle, vehicleMake, vehicleModel, vehiclePlate, vehicleYear, vehicleColor,
    linkedInspection, neededParts, estimationType, estimatedCost, approvedAmount,
    rejectionReason, notes, documents, damagePhotos, existing, claimPayments,
  ]);

  /** يولّد فاتورة ضريبية رسمية مع QR ZATCA TLV — يلزم CR+VAT لشركة التأمين + إكمال أمر العمل أو التسليم. */
  const jobOrderCompleted = (existing as any)?.job_order?.status === "completed" || (existing as any)?.job_order?.status === "delivered";
  const claimDelivered = !!(existing as any)?.delivered_at;
  const hasLpo = documents.some((d) => d.type === "lpo");
  const canIssueTaxInvoice = jobOrderCompleted || claimDelivered || hasLpo;

  // فاتورة نشطة مرتبطة بهذه المطالبة (Single Source of Truth)
  const { data: activeInvoice } = useQuery({
    queryKey: ["claim_active_invoice", existing?.id],
    enabled: !!existing?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("insurance_invoices" as any)
        .select("id,invoice_number,total,paid_amount,status")
        .eq("claim_id", existing!.id)
        .neq("status", "cancelled")
        .maybeSingle();
      return (data as any) || null;
    },
  });
  const hasActiveInvoice = !!activeInvoice;

  const generateTaxInvoice = async () => {
    if (!canIssueTaxInvoice) {
      toast.error("لا يمكن إصدار الفاتورة الضريبية إلا بعد إكمال أمر العمل أو تسجيل تسليم المركبة");
      return;
    }
    if (!insuranceCo) {
      toast.error("يرجى اختيار شركة التأمين أولاً");
      return;
    }
    const missing: string[] = [];
    if (!insuranceCo.commercial_registration?.trim()) missing.push("السجل التجاري");
    if (!insuranceCo.tax_number?.trim()) missing.push("الرقم الضريبي");
    if (missing.length) {
      toast.error(
        `لإصدار فاتورة ضريبية رسمية يجب أن يكون لدى شركة "${insuranceCo.name}" بيانات: ${missing.join(" و")}. عدّل بطاقة الشركة أولاً.`,
        { duration: 6000 },
      );
      return;
    }

    // مبالغ من المطالبة: المبلغ المعتمد من شركة التأمين يُعتبر "غير شامل ضريبة القيمة المضافة".
    // النظام يضيف 5% VAT تلقائياً عند إصدار الفاتورة الضريبية.
    const approvedRaw = parseFloat(approvedAmount) || parseFloat(estimatedCost) || 0;
    if (approvedRaw <= 0) {
      toast.error("لا يمكن إصدار فاتورة بمبلغ صفر — أدخل المبلغ المعتمد أولاً.");
      return;
    }
    const VAT_RATE = 0.05;
    const subtotal = +approvedRaw.toFixed(3);
    const vat = +(subtotal * VAT_RATE).toFixed(3);
    const total = +(subtotal + vat).toFixed(3);
    const invNumber = `TI-${claimNumber.replace(/[^A-Z0-9-]/gi, "")}-${new Date().getFullYear()}`;

    // QR (ZATCA TLV) من بيانات الورشة (البائع) — لا من بيانات شركة التأمين.
    const tpl = getTemplateSettings();
    let qrDataUrl: string | undefined;
    try {
      qrDataUrl = await buildZatcaQrDataUrl({
        sellerName: tpl.companyName,
        vatNumber: tpl.vatNumber,
        timestamp: new Date().toISOString(),
        total,
        vat,
      });
    } catch (e) {
      console.warn("QR generation failed", e);
    }

    const veh = vehicle ? `${vehicle.brand} ${vehicle.model}${vehicle.year ? ` - ${vehicle.year}` : ""}` : "";

    // ── بناء بنود الفاتورة الضريبية بنفس منطق "تقدير الإصلاح" حتى تتطابق المستندات ──
    // إذا كان التقدير UPL وفيه أسعار → نستخدم نفس بنود التقدير (مع تحجيمها للمبلغ المعتمد عند الاختلاف).
    // وإلا → بند مقطوع واحد بقيمة المبلغ المعتمد.
    let invoiceItems: Array<{ description: string; quantity: number; unitPrice: number; discount: number; tax: number }> = [];
    if (estimationType === "upl" && (uplItems || []).some((u: any) => (Number(u.unit_price) || 0) > 0)) {
      const rawSum = (uplItems || []).reduce(
        (s: number, u: any) => s + (Number(u.quantity) || 0) * (Number(u.unit_price) || 0),
        0,
      );
      const scale = rawSum > 0 && Math.abs(rawSum - subtotal) > 0.01 ? subtotal / rawSum : 1;
      invoiceItems = (uplItems || [])
        .filter((u: any) => (u.description || "").trim())
        .map((u: any) => ({
          description: u.description,
          quantity: Number(u.quantity) || 1,
          unitPrice: +(((Number(u.unit_price) || 0)) * scale).toFixed(3),
          discount: 0,
          tax: VAT_RATE * 100,
        }));
    }
    if (invoiceItems.length === 0) {
      invoiceItems = [{
        description: `خدمات إصلاح بموجب المطالبة ${claimNumber}${veh ? ` — ${veh}` : ""}`,
        quantity: 1,
        unitPrice: subtotal,
        discount: 0,
        tax: VAT_RATE * 100,
      }];
    }

    const dueDays = insuranceCo.payment_terms_days || 90;
    const due = new Date();
    due.setDate(due.getDate() + dueDays);

    const html = getInsuranceTaxInvoiceHtml({
      docType: "invoice",
      template: "default",
      number: invNumber,
      invoiceNumber: invNumber,
      issueDate: formatDateLatin(new Date()),
      paymentDueDate: formatDateLatin(due),
      customerName: ownerName || company,
      customFields: [],
      items: invoiceItems,
      subtotal,
      discountTotal: 0,
      taxTotal: vat,
      total,
      notes: notes || undefined,
      insuranceCompany: company,
      claimNumber,
      vehiclePlate: vehicle?.plate_number,
      vehicleInfo: veh,
      insuranceCommercialRegistration: insuranceCo.commercial_registration ?? undefined,
      insuranceTaxNumber: insuranceCo.tax_number ?? undefined,
      insurancePoBox: insuranceCo.po_box ?? undefined,
      insuranceBranchCity: insuranceCo.branch_city ?? undefined,
      insuranceAddress: insuranceCo.address ?? undefined,
      insurancePhone: insuranceCo.phone ?? undefined,
      insuranceEmail: insuranceCo.email ?? undefined,
      insuranceBankName: (insuranceCo as any).bank_name ?? undefined,
      insuranceIban: (insuranceCo as any).iban ?? undefined,
      insuranceBankAccountName: (insuranceCo as any).bank_account_name ?? undefined,
      qrDataUrl,
      lpoNumber: lpoNumber.trim() || undefined,
    });

    setTaxInvoiceHtml(html);
    setTaxInvoiceNumber(invNumber);
    setShowTaxInvoice(true);

    // حفظ نسخة في جدول insurance_invoices لتظهر في صفحة محاسبة المطالبات (مزامنة فورية)
    try {
      const { data: tenant } = await supabase.rpc("get_user_tenant_id");
      if (tenant && existing?.id) {
        // منع تكرار فاتورة نشطة لنفس المطالبة (Single Source of Truth)
        const { data: existingInv } = await supabase
          .from("insurance_invoices" as any)
          .select("id,invoice_number")
          .eq("claim_id", existing.id)
          .neq("status", "cancelled")
          .maybeSingle();

        if (existingInv) {
          toast.info(
            `هذه المطالبة لديها فاتورة نشطة بالفعل (#${(existingInv as any).invoice_number}) — لم يتم إنشاء فاتورة جديدة.`
          );
        } else {
          const persistedItems = invoiceItems.map((it) => ({
            description: it.description,
            quantity: Number(it.quantity) || 1,
            unit_price: Number(it.unitPrice) || 0,
          }));

          const { error: insErr } = await supabase.from("insurance_invoices" as any).insert({
            tenant_id: tenant as string,
            claim_id: existing.id,
            invoice_number: "", // الـ trigger يولّد الرقم INS-INV-XXXXX
            insurance_company_id: insuranceCo?.id ?? null,
            insurance_company_name: insuranceCo?.name ?? company,
            vehicle_make: vehicle?.brand ?? (existing as any)?.vehicle_make ?? null,
            vehicle_model: vehicle?.model ?? (existing as any)?.vehicle_model ?? null,
            vehicle_plate: vehicle?.plate_number ?? (existing as any)?.vehicle_plate ?? null,
            subtotal,
            vat,
            total,
            paid_amount: 0,
            status: "issued",
            due_date: due.toISOString().slice(0, 10),
            notes: notes || null,
            lpo_number: lpoNumber.trim() || null,
            items: persistedItems,
          } as any);
          if (insErr) throw insErr;
          queryClient.invalidateQueries({ queryKey: ["insurance_invoices"] });
          toast.success("تم حفظ الفاتورة في محاسبة المطالبات");
        }
      }
    } catch (e: any) {
      console.warn("persist insurance invoice failed", e);
    }
  };

  if (!isNew && isLoading) {
    return <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>;
  }

  // Status pill
  const statusMeta: Record<string, { label: string; cls: string }> = {
    pending: { label: "بانتظار الموافقة", cls: "bg-warning/15 text-warning" },
    approved: { label: "تمت الموافقة", cls: "bg-success/15 text-success" },
    rejected: { label: "مرفوضة", cls: "bg-destructive/15 text-destructive" },
    paid: { label: "مدفوعة", cls: "bg-info/15 text-info" },
    cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground line-through" },
  };

  return (
    <div className="space-y-5 pb-12" dir="rtl">
      {/* ── Header ── */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/insurance")}>
            <ArrowRight size={18} />
          </Button>
          <div>
            <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
              <Shield className="text-primary" size={24} />
              {isNew ? "مطالبة تأمين جديدة" : `مطالبة ${claimNumber || "..."}`}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
              <Building2 size={12} /> {company || "—"}
              {!isNew && (
                <>
                  <span className="opacity-50">•</span>
                  <Badge className={statusMeta[status].cls}>{statusMeta[status].label}</Badge>
                </>
              )}
              {!isNew && (existing as any)?.delivered_at && (
                <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white gap-1 border-0 shadow-sm">
                  <PackageCheck size={11} /> تم التسليم • {new Date((existing as any).delivered_at).toLocaleDateString("en-GB")}
                </Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {!isNew && (
            <Button
              variant="outline"
              onClick={() => navigate(`/insurance/${id}/archive`)}
              className="gap-2 border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10"
              title="أرشيف المطالبة (للعرض فقط)"
            >
              <FolderArchive size={16} /> الأرشيف
            </Button>
          )}
          {!isNew && (
            <Button variant="outline" onClick={() => setShowSummary(true)} className="gap-2">
              <FileText size={16} /> ملخص المطالبة
            </Button>
          )}
          {!isNew && (
            <Button
              variant="outline"
              onClick={() => setShowPdf(true)}
              className="gap-2 border-primary/40 text-primary hover:bg-primary/10"
              title="طباعة/معاينة تقدير الإصلاح"
            >
              <Printer size={16} /> طباعة تقدير الإصلاح
            </Button>
          )}
          {!isNew && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEstimateTerms(true)}
              className="gap-1 text-xs text-muted-foreground hover:text-primary"
              title="تحرير شروط/ملاحظات تقدير الإصلاح"
            >
              <FileText size={14} /> شروط التقدير
            </Button>
          )}
          {!isNew && (
            <Button
              variant="outline"
              onClick={() => setShowSendEmail(true)}
              className="gap-2 border-info/40 text-info hover:bg-info/10"
              title="إرسال تقرير التأمين بالبريد مع الصور والـ PDF"
            >
              <Send size={16} /> إرسال للتأمين
            </Button>
          )}
          <Button onClick={handleSave} disabled={createClaim.isPending || updateClaim.isPending || uploading} className="gap-2">
            <Save size={16} />
            {isNew ? "حفظ" : "حفظ التعديلات"}
          </Button>
          {!isNew && status !== "cancelled" && status !== "paid" && (
            <Button
              variant="outline"
              onClick={() => setShowCancelDialog(true)}
              className="gap-2 border-destructive/40 text-destructive hover:bg-destructive/10"
            >
              <XCircle size={16} /> إغلاق/إلغاء
            </Button>
          )}
          {!isNew && (
            <Can module="Insurance/Claims" action="Delete">
              <Button variant="ghost" size="icon" className="text-destructive" onClick={handleDelete}>
                <Trash2 size={16} />
              </Button>
            </Can>
          )}

        </div>
      </div>

      {/* ── Header Identity Card (Insurance + Owner) ── */}
      <Card className="p-5 grid md:grid-cols-2 gap-5 bg-gradient-to-l from-primary/5 to-transparent">
        {/* Insurance company (primary) */}
        <div className="space-y-3">
          <div className="flex items-center gap-2 text-sm font-bold text-primary">
            <Building2 size={16} /> شركة التأمين (الجهة الدافعة)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">شركة التأمين *</Label>
              <InsuranceCompanyAutocomplete
                value={company}
                companyId={companyId}
                onChange={(name, cid) => { setCompany(name); setCompanyId(cid); }}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">رقم المطالبة *</Label>
              <Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} placeholder="CLM-001" />
            </div>
            {/* LPO يُضاف لاحقاً من الفاتورة الضريبية بعد إرسالها لشركة التأمين */}
          </div>
        </div>

        {/* Vehicle owner (secondary) — smart autocomplete */}
        <div className="space-y-3 border-r-0 md:border-r md:pr-5 border-border">
          <div className="flex items-center gap-2 text-sm font-bold text-muted-foreground">
            <User size={16} /> مالك السيارة (اختياري — يُجلب تلقائياً من بيانات السيارة)
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">اسم المالك</Label>
              <OwnerAutocomplete
                value={ownerName}
                onChange={(v) => {
                  setOwnerName(v);
                  // If user clears or types a different name, drop the linked customer
                  if (customer && customer.name !== v) {
                    setCustomerId("");
                    setVehicleId("");
                  }
                }}
                onSelect={(c) => {
                  setCustomerId(c.id);
                  setOwnerName(c.name);
                  if (c.phone) setOwnerPhone(c.phone);
                  setVehicleId("");
                }}
                customers={customers || []}
              />
              <p className="text-[10px] text-muted-foreground">
                {customerId ? (
                  <span className="text-success inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> عميل موجود في النظام
                  </span>
                ) : ownerName.trim() ? (
                  <span className="text-info inline-flex items-center gap-1">
                    <Sparkles size={10} /> سيُضاف كعميل جديد عند الحفظ
                  </span>
                ) : (
                  "ابحث بالاسم أو أدخل اسماً جديداً"
                )}
              </p>
            </div>
            <div className="space-y-1.5 col-span-2">
              <Label className="text-xs">هاتف المالك</Label>
              <Input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+968 ..." dir="ltr" />
            </div>
          </div>
        </div>
      </Card>

      {/* ── Vehicle data (inline, optional, saved with claim) ── */}
      <Card className="p-5">
        <VehicleMakeModelPicker
          make={vehicleMake}
          model={vehicleModel}
          plate={vehiclePlate}
          year={vehicleYear}
          color={vehicleColor}
          vin={vehicleVin}
          onChange={(patch) => {
            if (patch.make !== undefined) setVehicleMake(patch.make);
            if (patch.model !== undefined) setVehicleModel(patch.model);
            if (patch.plate !== undefined) setVehiclePlate(patch.plate);
            if (patch.year !== undefined) setVehicleYear(patch.year);
            if (patch.color !== undefined) setVehicleColor(patch.color);
            if (patch.vin !== undefined) setVehicleVin(patch.vin);
          }}
        />
      </Card>

      {/* ── Workflow Dates ── */}
      <Can module="Insurance Claims" action="Edit" fallback={
        <Card className="p-4">
          <div className="flex items-center gap-2 text-sm font-semibold mb-3">
            <ClipboardCheck size={16} className="text-primary" /> تواريخ سير العملية
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div><div className="text-muted-foreground mb-1">تاريخ التقدير</div><div className="font-semibold">{estimateDate ? formatDateLatin(estimateDate) : "—"}</div></div>
            <div><div className="text-muted-foreground mb-1">وصول السيارة للورشة</div><div className="font-semibold">{workshopArrivalDate ? formatDateLatin(workshopArrivalDate) : "—"}</div></div>
            <div><div className="text-muted-foreground mb-1">بدء العمل</div><div className="font-semibold">{workStartedAt ? formatDateLatin(workStartedAt) : "—"}</div></div>
            <div><div className="text-muted-foreground mb-1">تاريخ التسليم</div><div className="font-semibold">{(existing as any)?.delivered_at ? formatDateLatin((existing as any).delivered_at) : "—"}</div></div>
          </div>
        </Card>
      }>
        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <ClipboardCheck size={16} className="text-primary" /> تواريخ سير العملية
            </div>
            <div className="text-[11px] text-muted-foreground">يتم تسجيل أي تعديل تلقائياً في سجل التدقيق.</div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">تاريخ التقدير</Label>
                <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setEstimateDate(new Date().toISOString().slice(0, 10))}>اليوم</button>
              </div>
              <Input type="date" value={estimateDate} onChange={(e) => setEstimateDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">وصول السيارة للورشة</Label>
                <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setWorkshopArrivalDate(new Date().toISOString().slice(0, 10))}>اليوم</button>
              </div>
              <Input type="date" value={workshopArrivalDate} onChange={(e) => setWorkshopArrivalDate(e.target.value)} />
            </div>
            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <Label className="text-xs">بدء العمل</Label>
                <button type="button" className="text-[10px] text-primary hover:underline" onClick={() => setWorkStartedAt(new Date().toISOString().slice(0, 10))}>اليوم</button>
              </div>
              <Input type="date" value={workStartedAt} onChange={(e) => setWorkStartedAt(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">تاريخ التسليم</Label>
              <Input
                type="date"
                value={(existing as any)?.delivered_at ? String((existing as any).delivered_at).slice(0, 10) : ""}
                readOnly
                disabled
                className="bg-muted/40"
              />
              <p className="text-[10px] text-muted-foreground">يُسجَّل تلقائياً عند تسليم السيارة من تبويب «التسليم».</p>
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            تاريخ وصول السيارة هو المرجع الرئيسي لاحتساب مدة بقاء المركبة ولون حالة المطالبة (أخضر / برتقالي / أصفر / أحمر).
          </p>
          <div className="flex justify-end pt-2 border-t">
            <Button
              size="sm"
              onClick={async () => {
                if (isNew || !id) {
                  toast.error("احفظ المطالبة أولاً");
                  return;
                }
                try {
                  const { error } = await supabase
                    .from("insurance_claims" as any)
                    .update({
                      estimate_date: estimateDate || null,
                      workshop_arrival_date: workshopArrivalDate || null,
                      work_started_at: workStartedAt ? new Date(workStartedAt).toISOString() : null,
                    })
                    .eq("id", id);
                  if (error) throw error;
                  await queryClient.invalidateQueries({ queryKey: ["insurance_claims", id] });
                  await queryClient.invalidateQueries({ queryKey: ["insurance_claims"] });
                  toast.success("تم الحفظ");
                } catch (e: any) {
                  toast.error(e.message || "تعذر الحفظ");
                }
              }}
            >
              حفظ التعديلات
            </Button>
          </div>
        </Card>
      </Can>

      {/* ── Workflow Tabs ── */}
      <Tabs value={tab} onValueChange={setTab} className="space-y-4">
        <TabsList className="grid w-full grid-cols-7">
          <TabsTrigger value="inspect" className="gap-1.5">
            <ClipboardCheck size={14} /> 1. فحص
          </TabsTrigger>
          <TabsTrigger value="estimate" className="gap-1.5">
            <Calculator size={14} /> 2. صور وتقدير
          </TabsTrigger>
          <TabsTrigger value="approval" className="gap-1.5">
            <CheckCircle2 size={14} /> 3. موافقة
          </TabsTrigger>
          <TabsTrigger value="workorder" className="gap-1.5">
            <Wrench size={14} /> 4. أمر عمل
          </TabsTrigger>
          <TabsTrigger value="delivery" className="gap-1.5" disabled={isNew}>
            <PackageCheck size={14} /> 5. تسليم
          </TabsTrigger>
          <TabsTrigger value="payments" className="gap-1.5" disabled={isNew}>
            <DollarSign size={14} /> 6. مدفوعات
          </TabsTrigger>
          <TabsTrigger value="documents" className="gap-1.5" disabled={isNew}>
            <FolderArchive size={14} /> 7. الأرشيف
          </TabsTrigger>
        </TabsList>

        {/* ── 1) Inspection: damage photos + needed parts (the "inspection result") ── */}
        <TabsContent value="inspect" className="space-y-4 mt-4">
          {/* Linked inspection report */}
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <ClipboardCheck size={16} className="text-primary" /> تقرير الفحص الفني
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" className="gap-1" onClick={() => setShowInspectionPicker(true)}>
                  <Search size={13} /> استيراد فحص موجود
                </Button>
                <Button variant="default" size="sm" className="gap-1" onClick={openNewInspection}>
                  <Plus size={13} /> فحص جديد
                </Button>
              </div>
            </div>

            {linkedInspection ? (
              <div className="space-y-3">
                <div className="p-3 bg-success/10 border border-success/30 rounded-lg flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <LinkIcon size={16} className="text-success shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground truncate">
                        {linkedInspection.id} — {linkedInspection.customer}
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate">
                        {linkedInspection.vehicle} • {linkedInspection.damageType} • {linkedInspection.date}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1"
                      onClick={() => setShowInspectionPdf(true)}
                    >
                      <Printer size={13} /> تصدير PDF
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setLinkedInspection(null)}>
                      <X size={14} />
                    </Button>
                  </div>
                </div>
                {damagePhotos.length > 0 && (
                  <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                    <Camera size={11} className="text-primary" />
                    سيتم تضمين {damagePhotos.length} صورة من صور الأضرار في PDF التقرير، وستنتقل بنفس الترتيب إلى أمر العمل عند التحويل.
                  </div>
                )}
              </div>
            ) : (
              <div className="text-center py-4 text-muted-foreground text-xs border-2 border-dashed border-border rounded-lg">
                اربط تقرير فحص من قسم الفحص والمعاينة، أو أنشئ فحصاً جديداً
              </div>
            )}
          </Card>

          {/* Damage photos */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Camera size={16} className="text-primary" /> صور الأضرار ({damagePhotos.length})
              </div>
              <label className="cursor-pointer">
                <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => handlePhotoUpload(e.target.files)} disabled={uploading} />
                <Button variant="outline" size="sm" className="gap-1" asChild>
                  <span><Upload size={14} /> رفع صور</span>
                </Button>
              </label>
            </div>
            {damagePhotos.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
                لا توجد صور بعد. ارفع صور الأضرار لتوثيق حالة السيارة.
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                {damagePhotos.map((url, i) => (
                  <div key={i} className="relative group rounded-lg overflow-hidden border border-border">
                    <img
                      src={url}
                      alt={`damage-${i}`}
                      className="w-full h-32 object-cover bg-muted"
                      loading="lazy"
                      onError={(e) => {
                        const img = e.currentTarget;
                        img.style.display = "none";
                        const fallback = img.nextElementSibling as HTMLElement | null;
                        if (fallback) fallback.style.display = "flex";
                      }}
                    />
                    <div className="hidden absolute inset-0 items-center justify-center bg-muted text-muted-foreground text-xs flex-col gap-1" style={{ display: "none" }}>
                      <span>⚠️</span>
                      <span>صورة مفقودة</span>
                    </div>
                    <button
                      onClick={() => setDamagePhotos((p) => p.filter((_, idx) => idx !== i))}
                      className="absolute top-1 left-1 w-6 h-6 rounded-full bg-destructive text-destructive-foreground opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Inspection report upload */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <FileText size={16} className="text-primary" /> تقرير الفحص والمستندات
              </div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(docTypeLabels).map(([type, label]) => (
                  <label key={type} className="cursor-pointer">
                    <input type="file" multiple accept=".pdf,image/*" className="hidden"
                      onChange={(e) => handleDocUpload(e.target.files, type)} disabled={uploading} />
                    <Button variant="outline" size="sm" className="gap-1" asChild>
                      <span><FileUp size={12} /> {label}</span>
                    </Button>
                  </label>
                ))}
              </div>
            </div>
            {documents.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
                ارفع تقرير الفحص الفني أو أي مستندات مساندة.
              </div>
            ) : (
              <div className="space-y-2">
                {documents.map((doc, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-secondary/30 rounded-lg">
                    <div className="flex items-center gap-3 min-w-0">
                      <FileText size={16} className="text-primary shrink-0" />
                      <div className="min-w-0">
                        <a href={doc.url} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-primary hover:underline truncate block">
                          {doc.name}
                        </a>
                        <Badge variant="secondary" className="text-[10px] mt-0.5">{docTypeLabels[doc.type] ?? doc.type}</Badge>
                      </div>
                    </div>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive" onClick={() => setDocuments((d) => d.filter((_, idx) => idx !== i))}>
                      <Trash2 size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <div className="flex justify-end">
            <Button onClick={() => setTab("estimate")} className="gap-2">
              التالي: التقدير <ArrowLeftRight size={14} />
            </Button>
          </div>
        </TabsContent>

        {/* ── 2) Estimate: needed parts + cost estimate ── */}
        <TabsContent value="estimate" className="space-y-4 mt-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Car size={16} className="text-primary" /> قطع الغيار المطلوبة ({neededParts.length})
              </div>
              <Button variant="outline" size="sm" className="gap-1" onClick={addPart}>
                <Plus size={14} /> إضافة قطعة
              </Button>
            </div>
            {neededParts.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm border-2 border-dashed border-border rounded-lg">
                أضف قائمة القطع المطلوبة لشركة التأمين.
              </div>
            ) : (
              <div className="space-y-2">
                {neededParts.map((p, i) => (
                  <div key={i} className="grid grid-cols-12 gap-2 items-end">
                    <div className="col-span-12 md:col-span-5 space-y-1">
                      <Label className="text-xs">اسم القطعة</Label>
                      <Input value={p.name} onChange={(e) => updatePart(i, { name: e.target.value })} placeholder="مثال: مصد أمامي" />
                    </div>
                    <div className="col-span-4 md:col-span-2 space-y-1">
                      <Label className="text-xs">الكمية</Label>
                      <Input type="number" min={1} value={p.quantity} onChange={(e) => updatePart(i, { quantity: parseInt(e.target.value) || 1 })} />
                    </div>
                    <div className="col-span-7 md:col-span-4 space-y-1">
                      <Label className="text-xs">ملاحظات</Label>
                      <Input value={p.notes ?? ""} onChange={(e) => updatePart(i, { notes: e.target.value })} placeholder="جديد / مستعمل ..." />
                    </div>
                    <div className="col-span-1 flex justify-end">
                      <Button variant="ghost" size="icon" className="h-9 w-9 text-destructive" onClick={() => removePart(i)}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Cost estimate */}
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
                <Calculator size={16} className="text-primary" /> تقدير التكلفة
              </div>
              <div className="flex items-center gap-2">
                <Label className="text-xs">نوع التقدير:</Label>
                <Select value={estimationType} onValueChange={(v) => setEstimationType(v as "lump_sum" | "upl")}>
                  <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="lump_sum">Lump Sum (مبلغ مقطوع)</SelectItem>
                    <SelectItem value="upl">UPL (قائمة بنود)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            {estimationType === "lump_sum" ? (
              <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>المبلغ المقدر للإصلاح (ر.ع)</Label>
                  <Input type="number" step="0.01" value={estimatedCost} onChange={(e) => setEstimatedCost(e.target.value)} placeholder="0.00" className="text-lg font-semibold" />
                  <p className="text-xs text-muted-foreground">سيُستخدم في PDF التقدير المُرسل لشركة التأمين.</p>
                </div>
                <div className="space-y-1.5">
                  <Label>ملاحظات</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ملاحظات على التقدير..." />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <UplItemsEditor items={uplItems} onChange={setUplItems} />
                <div className="space-y-1.5">
                  <Label>ملاحظات</Label>
                  <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="ملاحظات على التقدير..." />
                </div>
              </div>
            )}
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("inspect")}>السابق</Button>
            <div className="flex gap-2 flex-wrap items-center">
              <TemplatePicker docType="insurance_tax_invoice" size="sm" />
              <Button variant="outline" onClick={() => setShowPdf(true)} disabled={isNew} className="gap-2">
                <Printer size={14} /> معاينة التقدير
              </Button>
              <Button
                variant="outline"
                onClick={generateTaxInvoice}
                disabled={isNew || !canIssueTaxInvoice || hasActiveInvoice}
                className="gap-2 border-success/40 text-success hover:bg-success/10"
                title={
                  hasActiveInvoice
                    ? `فاتورة نشطة (#${activeInvoice.invoice_number}) — لا يمكن إصدار فاتورة أخرى`
                    : (!canIssueTaxInvoice ? "متاح بعد إكمال أمر العمل أو تسليم المركبة أو رفع LPO" : "")
                }
              >
                <FileText size={14} />
                {hasActiveInvoice
                  ? `فاتورة #${activeInvoice.invoice_number} مُصدرة`
                  : <>فاتورة ضريبية رسمية (QR){!canIssueTaxInvoice && " 🔒"}</>}
              </Button>
              <Button onClick={() => setTab("approval")} className="gap-2">
                التالي: الموافقة <ArrowLeftRight size={14} />
              </Button>
            </div>
          </div>
        </TabsContent>

        {/* ── 3) Approval ── */}
        <TabsContent value="approval" className="space-y-4 mt-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <CheckCircle2 size={16} className="text-primary" /> موافقة شركة التأمين
            </div>

            <div className="grid md:grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <Label>المبلغ المقدر</Label>
                  <Input value={estimatedCost} disabled className="bg-muted/40" data-amount="true" />
                </div>
                <div className="space-y-1.5">
                  <Label>المبلغ الموافق عليه (ر.ع) *</Label>
                  <Input type="number" step="0.01" value={approvedAmount} onChange={(e) => setApprovedAmount(e.target.value)} placeholder="0.00" className="text-lg font-semibold text-success" data-amount="true" />
                </div>
            </div>

            {status === "rejected" && (
              <div className="space-y-1.5">
                <Label>سبب الرفض</Label>
                <Textarea value={rejectionReason} onChange={(e) => setRejectionReason(e.target.value)} rows={2} />
              </div>
            )}

            <div className="flex flex-wrap gap-2 pt-2">
              <Button onClick={handleApprove} disabled={status === "approved" || isNew || updateStatus.isPending} className="gap-2 bg-success hover:bg-success/90 text-success-foreground">
                <CheckCircle2 size={16} /> موافقة على المطالبة
              </Button>
              <Button variant="outline" onClick={() => setStatus("rejected")} disabled={status === "rejected" || isNew}>
                رفض
              </Button>
              {status === "rejected" && (
                <Button variant="destructive" onClick={handleReject} disabled={updateStatus.isPending}>
                  تأكيد الرفض
                </Button>
              )}
            </div>

            {status === "approved" && (
              <div className="p-3 bg-success/10 border border-success/30 rounded-lg flex items-center gap-2 text-success text-sm">
                <CheckCircle2 size={16} /> تمت الموافقة. يمكنك الآن إنشاء أمر العمل من التبويب التالي.
              </div>
            )}
          </Card>

          <div className="flex justify-between">
            <Button variant="outline" onClick={() => setTab("estimate")}>السابق</Button>
            {status === "approved" && (
              <Button onClick={() => setTab("workorder")} className="gap-2">
                التالي: أمر العمل <ArrowLeftRight size={14} />
              </Button>
            )}
          </div>
        </TabsContent>

        {/* ── 4) Convert to Work Order ── */}
        <TabsContent value="workorder" className="space-y-4 mt-4">
          <Card className="p-5 space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
              <Wrench size={16} className="text-primary" /> تحويل إلى أمر عمل
            </div>
            <p className="text-sm text-muted-foreground">
              سيتم إنشاء أمر عمل جديد يحتوي على: السيارة، صور الأضرار (في مرحلة الفحص)، قطع الغيار المطلوبة، والمبلغ الموافق عليه كتقدير أولي.
              شركة التأمين <strong className="text-foreground">{company}</strong> ستكون الجهة الدافعة.
            </p>

            <div className="grid md:grid-cols-3 gap-3 text-sm">
              <div className="p-3 bg-secondary/40 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">السيارة</div>
                <div className="font-medium">{vehicle ? `${vehicle.brand} ${vehicle.model} — ${vehicle.plate_number}` : "—"}</div>
              </div>
              <div className="p-3 bg-secondary/40 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">صور وقطع</div>
                <div className="font-medium">{damagePhotos.length} صور • {neededParts.filter(p => p.name.trim()).length} قطعة</div>
              </div>
              <div className="p-3 bg-success/10 rounded-lg">
                <div className="text-xs text-muted-foreground mb-1">المبلغ الموافق</div>
                <div className="font-bold text-success" data-amount="true">{parseFloat(approvedAmount || "0").toFixed(3)} ر.ع</div>
              </div>
            </div>

            {/* عند وجود أمر عمل تلقائي مرتبط بالموافقة → 3 خيارات */}
            {linkedWorkOrderId ? (
              <div className="space-y-3">
                <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-lg flex items-center gap-2 text-emerald-700 dark:text-emerald-400 text-sm">
                  <CheckCircle2 size={16} />
                  أمر العمل تم إنشاؤه تلقائياً عند الموافقة وبيانات السيارة تمت مزامنتها. اختر الإجراء التالي:
                </div>
                <div className="grid md:grid-cols-3 gap-2">
                  <Button
                    onClick={() => setShowWorkOrderInline((v) => !v)}
                    variant={showWorkOrderInline ? "default" : "outline"}
                    className="gap-2"
                    size="lg"
                  >
                    <Wrench size={16} /> {showWorkOrderInline ? "إخفاء العرض هنا" : "فتح أمر العمل هنا"}
                  </Button>
                  <Button
                    onClick={() => navigate(`/work-orders/${linkedWorkOrderId}`)}
                    className="gap-2 bg-blue-600 hover:bg-blue-700 text-white"
                    size="lg"
                  >
                    <LinkIcon size={16} /> الانتقال لصفحة أمر العمل
                  </Button>
                  <Button
                    onClick={() => setTab("delivery")}
                    variant="outline"
                    className="gap-2"
                    size="lg"
                  >
                    <PackageCheck size={16} /> الانتقال للتسليم
                  </Button>
                </div>
                {/* عرض الملخص inline داخل نفس الصفحة */}
                {showWorkOrderInline && <InlineWorkOrderSummary workOrderId={linkedWorkOrderId} />}
              </div>
            ) : (
              <Button
                onClick={handleConvertToWorkOrder}
                disabled={status !== "approved"}
                className="w-full gap-2"
                size="lg"
              >
                <Wrench size={18} /> إنشاء أمر العمل هنا
              </Button>
            )}

            {!workshopArrivalDate && (
              <div className="p-3 bg-destructive/10 border border-destructive/30 rounded-lg flex items-center gap-2 text-destructive text-sm">
                <AlertCircle size={16} />
                تحذير: لم يتم تسجيل <strong>تاريخ وصول السيارة للورشة</strong> — يُفضّل إدخاله من تبويب «تفاصيل» قبل إنشاء أمر العمل.
              </div>
            )}
            {workshopArrivalDate && status !== "approved" && status !== "paid" && (
              <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-center gap-2 text-warning text-sm">
                <AlertCircle size={16} /> يجب الموافقة على المطالبة أولاً قبل التحويل لأمر عمل.
              </div>
            )}
          </Card>
        </TabsContent>

        {/* ── 5) Delivery tab ── */}
        <TabsContent value="delivery" className="space-y-4 mt-4">
          {!isNew && id && (
            <ClaimDeliverySection
              claimId={id}
              workOrderId={linkedWorkOrderId || undefined}
              initial={{
                delivery_photos: (existing as any)?.delivery_photos ?? [],
                satisfaction_photos: (existing as any)?.satisfaction_photos ?? [],
                receiver_id_photo: (existing as any)?.receiver_id_photo ?? null,
                receiver_name: (existing as any)?.receiver_name ?? null,
                receiver_id_number: (existing as any)?.receiver_id_number ?? null,
                delivered_at: (existing as any)?.delivered_at ?? null,
                delivery_notes: (existing as any)?.delivery_notes ?? null,
              }}
              onSaved={() => queryClient.invalidateQueries({ queryKey: ["insurance_claim", id] })}
            />
          )}
        </TabsContent>

        {/* ── 6) Payments tab ── */}
        <TabsContent value="payments" className="space-y-4 mt-4">
          {!isNew && id && (
            <PaymentsSection
              claimId={id}
              insuranceCompanyId={companyId}
              approvedAmount={parseFloat(approvedAmount) || 0}
              estimatedAmount={parseFloat(estimatedCost) || 0}
              status={status}
              onAllPaid={() => updateStatus.mutate({ id, status: "paid" }, { onSuccess: () => setStatus("paid") })}
            />
          )}
        </TabsContent>

        {/* ── 7) Documents Archive ── */}
        <TabsContent value="documents" className="space-y-4 mt-4">
          {!isNew && id && <ClaimDocumentsPanel claimId={id} />}
        </TabsContent>
      </Tabs>

      {/* Estimate PDF — auto-saves to archive as claim_estimate */}
      {!isNew && id && showPdf && (() => {
        const html = buildPdf();
        return (
          <PdfPreviewDialog
            open={showPdf}
            onOpenChange={setShowPdf}
            htmlContent={html}
            title={`تقدير المطالبة ${claimNumber}`}
            fileName={`Estimate-${claimNumber}`}
            autoSave={async () => saveClaimDocument({
              claimId: id,
              category: "claim_estimate",
              fileBaseName: `Estimate-${claimNumber}`,
              htmlContent: html,
              meta: { claim_number: claimNumber },
            })}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["claim_documents", id] })}
          />
        );
      })()}

      {/* Comprehensive Claim Summary PDF — auto-saves as claim_summary */}
      {!isNew && id && showSummary && (() => {
        const html = buildSummaryPdf();
        return (
          <PdfPreviewDialog
            open={showSummary}
            onOpenChange={setShowSummary}
            htmlContent={html}
            title={`ملخص المطالبة ${claimNumber}`}
            fileName={`Claim-Summary-${claimNumber}`}
            autoSave={async () => saveClaimDocument({
              claimId: id,
              category: "claim_summary",
              fileBaseName: `Claim-Summary-${claimNumber}`,
              htmlContent: html,
              meta: { claim_number: claimNumber },
            })}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["claim_documents", id] })}
          />
        );
      })()}

      {/* Tax Invoice PDF (with ZATCA-style QR) — auto-saves */}
      {showTaxInvoice && taxInvoiceHtml && id && (
        <PdfPreviewDialog
          open={showTaxInvoice}
          onOpenChange={setShowTaxInvoice}
          htmlContent={taxInvoiceHtml}
          title={`فاتورة ضريبية ${taxInvoiceNumber}`}
          fileName={`Tax-Invoice-${taxInvoiceNumber}`}
          autoSave={async () => saveClaimDocument({
            claimId: id,
            category: "tax_invoice",
            fileBaseName: `TaxInvoice-${taxInvoiceNumber}`,
            htmlContent: taxInvoiceHtml,
            meta: { invoice_number: taxInvoiceNumber },
          })}
          onSaved={() => queryClient.invalidateQueries({ queryKey: ["claim_documents", id] })}
        />
      )}

      {/* Inspection report PDF — auto-saves */}
      {linkedInspection && id && showInspectionPdf && (() => {
        const html = buildInspectionPdf();
        return (
          <PdfPreviewDialog
            open={showInspectionPdf}
            onOpenChange={setShowInspectionPdf}
            htmlContent={html}
            title={`تقرير فحص ${linkedInspection.id}`}
            fileName={`Inspection-${linkedInspection.id}`}
            autoSave={async () => saveClaimDocument({
              claimId: id,
              category: "inspection",
              fileBaseName: `Inspection-${linkedInspection.id}`,
              htmlContent: html,
              meta: { inspection_id: linkedInspection.id },
            })}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["claim_documents", id] })}
          />
        );
      })()}

      {/* Inspection picker dialog */}
      <InspectionPickerDialog
        open={showInspectionPicker}
        onOpenChange={setShowInspectionPicker}
        onPick={(ins) => {
          applyInspection(ins);
          setShowInspectionPicker(false);
        }}
      />

      {/* New insurance inspection dialog (Al Madina Takaful style) */}
      <InsuranceInspectionDialog
        open={showNewInspection}
        onOpenChange={setShowNewInspection}
        preselectOrderId={linkedWorkOrderId || undefined}
      />

      {/* Send Insurance Email Dialog */}
      {!isNew && id && (
        <SendInsuranceEmailDialog
          open={showSendEmail}
          onOpenChange={setShowSendEmail}
          defaultEmail={insuranceCo?.email ?? ""}
          claimNumber={claimNumber}
          insuranceCompany={company}
          vehiclePlate={vehiclePlate || vehicle?.plate_number}
          vehicleInfo={`${vehicleMake || vehicle?.brand || ""} ${vehicleModel || vehicle?.model || ""}`.trim()}
          damagePhotos={damagePhotos}
          savedDocs={claimDocs.map(d => ({ id: d.id, file_path: d.file_path, category: d.category, created_at: d.created_at }))}
          buildAndSaveEstimatePdf={async () => {
            const html = buildPdf();
            const res = await saveClaimDocument({
              claimId: id, category: "claim_estimate",
              fileBaseName: `Estimate-${claimNumber}`,
              htmlContent: html, meta: { claim_number: claimNumber, sent_via: "email" },
            });
            queryClient.invalidateQueries({ queryKey: ["claim_documents", id] });
            return res?.url ?? null;
          }}
          buildAndSaveSummaryPdf={async () => {
            const html = buildSummaryPdf();
            const res = await saveClaimDocument({
              claimId: id, category: "claim_summary",
              fileBaseName: `Claim-Summary-${claimNumber}`,
              htmlContent: html, meta: { claim_number: claimNumber, sent_via: "email" },
            });
            queryClient.invalidateQueries({ queryKey: ["claim_documents", id] });
            return res?.url ?? null;
          }}
        />
      )}

      {/* Cancel/Close claim dialog */}
      {!isNew && existing && (
        <CancelClaimDialog
          open={showCancelDialog}
          onClose={() => setShowCancelDialog(false)}
          claim={existing}
          approvedAmount={parseFloat(approvedAmount) || 0}
          estimatedAmount={parseFloat(estimatedCost) || 0}
          isSubmitting={updateStatus.isPending}
          onConfirm={async ({ reason }) => {
            await new Promise<void>((resolve, reject) => {
              updateStatus.mutate(
                { id: id!, status: "cancelled", rejection_reason: reason },
                {
                  onSuccess: () => {
                    setStatus("cancelled");
                    setRejectionReason(reason);
                    resolve();
                  },
                  onError: (e) => reject(e),
                },
              );
            });
          }}
        />
      )}

      {/* تحرير شروط/ملاحظات تقدير الإصلاح */}
      <Dialog open={showEstimateTerms} onOpenChange={setShowEstimateTerms}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>شروط تقدير الإصلاح</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              يظهر هذا النص في أسفل مستند تقدير الإصلاح. يُحفظ تلقائياً ويُستخدم في جميع التقديرات القادمة.
            </p>
            <Textarea
              value={estimateTerms}
              onChange={(e) => setEstimateTerms(e.target.value)}
              rows={10}
              className="font-mono text-sm"
              placeholder="اكتب شروط التقدير، سطر لكل شرط…"
            />
            <div className="flex justify-between gap-2">
              <Button variant="ghost" size="sm" onClick={() => setEstimateTerms(DEFAULT_ESTIMATE_TERMS)}>
                استعادة الافتراضي
              </Button>
              <Button onClick={() => { setShowEstimateTerms(false); toast.success("تم حفظ الشروط"); }}>
                حفظ
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Owner autocomplete — searches the tenant customers list and lets the
// user keep typing a brand-new name (which will be auto-created on save).
// ════════════════════════════════════════════════════════════════════════
interface OwnerAutoProps {
  value: string;
  onChange: (v: string) => void;
  onSelect: (c: { id: string; name: string; phone: string | null }) => void;
  customers: { id: string; name: string; phone: string | null }[];
}

function OwnerAutocomplete({ value, onChange, onSelect, customers }: OwnerAutoProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    if (!q) return customers.slice(0, 6);
    return customers
      .filter((c) => c.name.toLowerCase().includes(q) || (c.phone || "").includes(q))
      .slice(0, 8);
  }, [value, customers]);

  return (
    <div ref={wrapRef} className="relative">
      <Input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="ابحث أو أدخل اسم مالك جديد"
        autoComplete="off"
      />
      {open && matches.length > 0 && (
        <div className="absolute z-50 mt-1 w-full bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {matches.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => { onSelect(c); setOpen(false); }}
              className="w-full text-right px-3 py-2 hover:bg-secondary/60 border-b border-border/40 last:border-b-0 flex items-center justify-between gap-3"
            >
              <div className="flex items-center gap-2 min-w-0">
                <User size={13} className="text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm text-foreground truncate">{c.name}</div>
                  {c.phone && (
                    <div className="text-[10px] text-muted-foreground flex items-center gap-1" dir="ltr">
                      <Phone size={9} /> {c.phone}
                    </div>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════════
// Inspection picker dialog — pulls inspections from the local store
// (same data shown on the Inspection page) so the user can attach one.
// ════════════════════════════════════════════════════════════════════════
interface PickerProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (ins: InspectionRecord) => void;
}

function InspectionPickerDialog({ open, onOpenChange, onPick }: PickerProps) {
  const [search, setSearch] = useState("");
  const [tick, setTick] = useState(0);

  useEffect(() => inspectionsStore.subscribe(() => setTick((t) => t + 1)), []);

  const list = useMemo(() => {
    void tick;
    const all = inspectionsStore.getAll();
    if (!search.trim()) return all;
    const q = search.toLowerCase();
    return all.filter(
      (i) =>
        i.id.toLowerCase().includes(q) ||
        i.customer.toLowerCase().includes(q) ||
        i.vehicle.toLowerCase().includes(q) ||
        (i.workOrder || "").toLowerCase().includes(q),
    );
  }, [search, tick, open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl bg-card" dir="rtl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ClipboardCheck size={18} className="text-primary" /> اختر تقرير فحص
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="relative">
            <Search size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ابحث برقم الفحص، العميل، السيارة، أو أمر العمل"
              className="pr-9"
            />
          </div>
          <div className="max-h-[400px] overflow-y-auto space-y-2">
            {list.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                لا توجد تقارير فحص — أنشئ فحصاً جديداً من زر "فحص جديد"
              </div>
            ) : (
              list.map((ins) => (
                <button
                  key={ins.id}
                  onClick={() => onPick(ins)}
                  className="w-full text-right p-3 rounded-lg border border-border hover:border-primary hover:bg-secondary/40 transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <span className="text-sm font-bold text-foreground">{ins.id}</span>
                    <Badge variant="secondary" className="text-[10px]">{ins.status}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-0.5">
                    <div><User size={10} className="inline mr-1" /> {ins.customer}</div>
                    <div><Car size={10} className="inline mr-1" /> {ins.vehicle}</div>
                    <div className="flex items-center gap-3">
                      <span>📅 {ins.date}</span>
                      <span>🔧 {ins.damageType}</span>
                      {ins.workOrder && ins.workOrder !== "—" && <span>📋 {ins.workOrder}</span>}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Payments Section (used inside the Payments tab) ──
function PaymentsSection({
  claimId,
  insuranceCompanyId,
  approvedAmount,
  estimatedAmount,
  status,
  onAllPaid,
}: {
  claimId: string;
  insuranceCompanyId: string | null;
  approvedAmount: number;
  estimatedAmount: number;
  status: string;
  onAllPaid: () => void;
}) {
  const { data: payments } = usePaymentsByClaim(claimId);
  const del = useDeleteClaimPayment();
  const [showDialog, setShowDialog] = useState(false);

  // ── المصدر المالي الموحّد: نقرأ من الفاتورة المرتبطة (إن وُجدت) ──
  // وإلا نحسب من المطالبة (المعتمد/المُقدّر + VAT) للحفاظ على التوافق.
  const { data: linkedInvoice } = useQuery({
    queryKey: ["claim_active_invoice", claimId],
    enabled: !!claimId,
    queryFn: async () => {
      const { data } = await supabase
        .from("insurance_invoices" as any)
        .select("id,invoice_number,total,subtotal,vat,paid_amount,status")
        .eq("claim_id", claimId)
        .neq("status", "cancelled")
        .maybeSingle();
      return (data as any) || null;
    },
  });

  const taxSettings = getTemplateSettings();
  const vatRate = taxSettings.taxEnabled === false ? 0 : (Number(taxSettings.vatRate) || 0) / 100;

  // الأولوية للفاتورة المرتبطة
  const approvedNet = linkedInvoice
    ? Number(linkedInvoice.subtotal) || 0
    : (approvedAmount > 0 ? approvedAmount : estimatedAmount);
  const vatAmount = linkedInvoice
    ? Number(linkedInvoice.vat) || 0
    : +(approvedNet * vatRate).toFixed(3);
  const baseAmount = linkedInvoice
    ? Number(linkedInvoice.total) || 0
    : +(approvedNet + vatAmount).toFixed(3);

  const totalPaid = linkedInvoice
    ? Number(linkedInvoice.paid_amount) || 0
    : (payments ?? [])
        .filter((p) => p.status === "cleared")
        .reduce((s, p) => s + Number(p.amount), 0);
  const remaining = baseAmount - totalPaid;

  // Auto-mark as paid when fully settled
  useEffect(() => {
    if (baseAmount > 0 && remaining <= 0.01 && status === "approved") {
      onAllPaid();
    }
  }, [remaining, baseAmount, status]); // eslint-disable-line

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2 text-sm font-bold">
          <DollarSign size={16} className="text-primary" /> دفعات شركة التأمين
          {linkedInvoice && (
            <Badge
              className={`text-[10px] ${
                linkedInvoice.status === "paid"
                  ? "bg-green-700 text-white"
                  : linkedInvoice.status === "partial"
                  ? "bg-amber-500 text-white"
                  : "bg-blue-500 text-white"
              }`}
            >
              فاتورة #{linkedInvoice.invoice_number} —{" "}
              {linkedInvoice.status === "paid"
                ? "مدفوعة بالكامل"
                : linkedInvoice.status === "partial"
                ? `مدفوعة جزئياً (متبقي ${(Number(linkedInvoice.total) - Number(linkedInvoice.paid_amount)).toFixed(3)})`
                : "مُصدرة"}
            </Badge>
          )}
        </div>
        <Can module="Insurance Payments" action="Record payment">
          <Button
            size="sm"
            onClick={() => setShowDialog(true)}
            disabled={(status !== "approved" && status !== "paid") || remaining <= 0}
            className="gap-1.5"
          >
            <Plus size={14} /> تسجيل دفعة
          </Button>
        </Can>

      </div>

      {status !== "approved" && status !== "paid" && (
        <div className="p-3 bg-warning/10 border border-warning/30 rounded-lg flex items-center gap-2 text-warning text-sm">
          <AlertCircle size={16} /> يجب الموافقة على المطالبة أولاً قبل تسجيل دفعات.
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
        <div className="p-3 bg-secondary/40 rounded-lg" data-amount="true">
          <div className="text-xs text-muted-foreground mb-1">المعتمد (صافي)</div>
          <div className="font-bold">{approvedNet.toLocaleString()} ر.ع</div>
        </div>
        <div className="p-3 bg-secondary/40 rounded-lg" data-amount="true">
          <div className="text-xs text-muted-foreground mb-1">
            ضريبة {(vatRate * 100).toFixed(0)}%
          </div>
          <div className="font-bold">{vatAmount.toLocaleString()} ر.ع</div>
        </div>
        <div className="p-3 bg-success/10 rounded-lg" data-amount="true">
          <div className="text-xs text-muted-foreground mb-1">المدفوع</div>
          <div className="font-bold text-success">{totalPaid.toLocaleString()} ر.ع</div>
        </div>
        <div className={`p-3 rounded-lg ${remaining > 0 ? "bg-warning/10" : "bg-success/10"}`} data-amount="true">
          <div className="text-xs text-muted-foreground mb-1">
            المتبقي (شامل الضريبة)
          </div>
          <div className={`font-bold ${remaining > 0 ? "text-warning" : "text-success"}`}>
            {remaining.toLocaleString()} ر.ع
          </div>
        </div>
      </div>

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-secondary/30 border-b border-border">
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">رقم</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">التاريخ</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">الطريقة / مصدر الخصم</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">المرجع</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">المبلغ</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">المتبقي بعدها</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground">الحالة</th>
              <th className="text-right py-2 px-3 text-xs text-muted-foreground"></th>
            </tr>
          </thead>
          <tbody>
            {!payments?.length ? (
              <tr><td colSpan={8} className="py-6 text-center text-muted-foreground text-sm">لا توجد دفعات بعد</td></tr>
            ) : (() => {
              // ترتيب من الأقدم للأحدث لحساب الرصيد المتراكم
              const sorted = [...payments].sort((a, b) => new Date(a.payment_date).getTime() - new Date(b.payment_date).getTime());
              let running = baseAmount;
              const rowsWithBalance = sorted.map((p) => {
                if (p.status !== "bounced") running -= Number(p.amount);
                return { p, balanceAfter: running };
              });
              // اعرض من الأحدث للأقدم
              return rowsWithBalance.reverse().map(({ p, balanceAfter }) => (
                <tr key={p.id} className="border-b border-border/50 hover:bg-secondary/10">
                  <td className="py-2 px-3 font-mono text-xs text-primary">{p.payment_number}</td>
                  <td className="py-2 px-3">{formatDateLatin(p.payment_date)}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1.5">
                      {p.payment_method === "offset" && <ArrowLeftRight size={12} className="text-warning" />}
                      <span>{PAYMENT_METHOD_LABELS[p.payment_method]}</span>
                    </div>
                    {p.payment_method === "offset" && p.notes && (
                      <div className="text-[11px] text-warning mt-1 leading-snug">↳ {p.notes}</div>
                    )}
                  </td>
                  <td className="py-2 px-3 text-xs text-muted-foreground">
                    {p.reference_number ?? "-"}
                    {p.bank_name && <div>{p.bank_name}</div>}
                  </td>
                  <td className="py-2 px-3 font-semibold text-success">{Number(p.amount).toLocaleString()} ر.ع</td>
                  <td className={`py-2 px-3 font-semibold ${balanceAfter > 0 ? "text-warning" : "text-success"}`}>
                    {balanceAfter.toLocaleString()} ر.ع
                  </td>
                  <td className="py-2 px-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${
                      p.status === "cleared" ? "bg-success/15 text-success" :
                      p.status === "bounced" ? "bg-destructive/15 text-destructive" :
                      "bg-warning/15 text-warning"
                    }`}>{PAYMENT_STATUS_LABELS[p.status]}</span>
                  </td>
                  <td className="py-2 px-3">
                    <Button
                      variant="ghost" size="icon" className="h-7 w-7 text-destructive"
                      onClick={() => { if (confirm("حذف هذه الدفعة؟")) del.mutate(p.id); }}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </td>
                </tr>
              ));
            })()}
          </tbody>
        </table>
      </div>

      <ClaimPaymentDialog
        open={showDialog}
        onOpenChange={setShowDialog}
        claimId={claimId}
        insuranceCompanyId={insuranceCompanyId}
        remainingAmount={remaining}
      />
    </Card>
  );
}
