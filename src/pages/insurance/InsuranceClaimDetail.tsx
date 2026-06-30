import { useEffect, useState, useMemo, useRef } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowRight, Save, FileText, Trash2, Upload, X, Plus, Printer, Camera,
  FileUp, Car, User, Building2, AlertCircle, Shield, ClipboardCheck,
  Calculator, CheckCircle2, Wrench, ArrowLeftRight, Search, Link as LinkIcon, Sparkles, Phone,
  DollarSign, PackageCheck, ShieldCheck, Hourglass, Settings, BadgeCheck, ClipboardList,
  Receipt, Wallet, Clock3, UserRound, CarFront, CheckSquare, ImagePlus,
  WalletCards, MessagesSquare, History, MessageCircle,
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
import { saveWorkOrderToCloud, type WorkOrder, type NeededPart } from "@/lib/workOrdersStore";
import { inspectionsStore, type InspectionRecord } from "@/lib/inspectionsStore";
import InsuranceInspectionDialog from "@/components/inspection/InsuranceInspectionDialog";
import { insuranceInspectionStore } from "@/lib/insuranceInspectionStore";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";
import { buildInsuranceInspectionHtml } from "@/lib/insuranceInspectionPdf";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import InsuranceCompanyAutocomplete from "@/components/insurance/InsuranceCompanyAutocomplete";
import InsuranceEmployeeSelect from "@/components/insurance/InsuranceEmployeeSelect";
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
import VehicleAvatar from "@/components/vehicles/VehicleAvatar";
import { expensesStore } from "@/lib/expensesStore";
import { isUuid } from "@/lib/uuid";


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

const dateOnly = (value?: string | null) => value ? String(value).slice(0, 10) : "";

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
  const [insuranceEmployeeId, setInsuranceEmployeeId] = useState<string | null>(null);
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
  const estimateDateRef = useRef<HTMLInputElement>(null);
  const workshopArrivalDateRef = useRef<HTMLInputElement>(null);
  const workStartedAtRef = useRef<HTMLInputElement>(null);

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
  const [stageDialog, setStageDialog] = useState<{ key: string; label: string } | null>(null);
  const [stageDate, setStageDate] = useState<string>(dateOnly(new Date().toISOString()));
  const [stageNote, setStageNote] = useState("");
  const [savingStage, setSavingStage] = useState(false);
  const [claimViewIndex, setClaimViewIndex] = useState(0);
  const claimViewTouchedRef = useRef(false);

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
  const [editInsuranceSection, setEditInsuranceSection] = useState(false);
  const [editVehicleSection, setEditVehicleSection] = useState(false);

  const { data: customers } = useCustomers();
  const { data: vehicles } = useVehiclesByCustomer(customerId || null);
  const { data: insuranceCo } = useInsuranceCompany(companyId || undefined);
  const queryClient = useQueryClient();

  // Hydrate from DB
  useEffect(() => {
    if (!existing) return;
    setCompany(existing.insurance_company || "");
    setCompanyId((existing as any).insurance_company_id ?? null);
    setInsuranceEmployeeId((existing as any).insurance_employee_id ?? null);
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
    setWorkshopArrivalDate(dateOnly((existing as any).workshop_arrival_date));
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
    if (!isUuid(customerId)) throw new Error("Customer must be saved before creating the claim.");
    if (vehicleId && !isUuid(vehicleId)) throw new Error("Vehicle must be saved before creating the claim.");
    return {
      tenant_id: tenant as string,
      customer_id: customerId,
      vehicle_id: vehicleId || null,
      job_order_id: linkedWorkOrderId && isUuid(linkedWorkOrderId) ? linkedWorkOrderId : null,
      claim_number: claimNumber,
      insurance_company: company,
      insurance_company_id: companyId,
      insurance_employee_id: insuranceEmployeeId,
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

  const writeClaimAudit = async (action: string, details: Record<string, unknown>, category = "workflow") => {
    if (!id || isNew) return;
    const tenantId = (existing as any)?.tenant_id;
    if (!tenantId) return;
    const { error } = await supabase.from("claim_audit_logs").insert({
      tenant_id: tenantId,
      claim_id: id,
      action,
      category,
      details: details as any,
    });
    if (error) throw error;
    await queryClient.invalidateQueries({ queryKey: ["claim_audit_logs", id] });
  };

  const hydrateFromVerifiedClaim = (verified: any) => {
    if (!verified?.id) return;
    setStatus(verified.status ?? status);
    setApprovedAmount(String(verified.approved_amount ?? approvedAmount ?? ""));
    if ("insurance_employee_id" in verified) {
      setInsuranceEmployeeId(verified.insurance_employee_id ?? null);
    }
    setWorkshopArrivalDate(dateOnly(verified.workshop_arrival_date));
    setWorkStartedAt(dateOnly(verified.work_started_at));
    setWorkCompletedAt(dateOnly(verified.work_completed_at));
    if (verified.estimate_date) setEstimateDate(dateOnly(verified.estimate_date));
  };

  const getWorkflowDateValues = () => ({
    estimate: estimateDateRef.current?.value || estimateDate || "",
    arrival: workshopArrivalDateRef.current?.value || workshopArrivalDate || "",
    started: workStartedAtRef.current?.value || workStartedAt || "",
  });

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
    if (!isUuid(cId)) {
      toast.error("Customer must be saved before creating the claim.");
      return;
    }
    if (vehicleId && !isUuid(vehicleId)) {
      toast.error("Vehicle must be saved before creating the claim.");
      return;
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
      job_order_id: linkedWorkOrderId && isUuid(linkedWorkOrderId) ? linkedWorkOrderId : null,
      claim_number: claimNumber,
      insurance_company: company,
      insurance_company_id: insCompanyId,
      insurance_employee_id: insuranceEmployeeId,
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
      try {
        const workflowDates = getWorkflowDateValues();
        const verified = await updateClaim.mutateAsync({
          id: id!,
          updates: {
            ...payload,
            estimate_date: workflowDates.estimate || null,
            workshop_arrival_date: workflowDates.arrival || null,
            work_started_at: workflowDates.started ? new Date(workflowDates.started).toISOString() : null,
          },
        });
        hydrateFromVerifiedClaim(verified);
        await writeClaimAudit("claim_details_saved", {
          workshop_arrival_date: workflowDates.arrival || null,
          estimate_date: workflowDates.estimate || null,
          work_started_at: workflowDates.started || null,
        });
      } catch (e: any) {
        toast.error(e?.message || "فشل حفظ المطالبة");
      }
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
        onSuccess: async (verified: any) => {
          hydrateFromVerifiedClaim(verified);
          await queryClient.invalidateQueries({ queryKey: ["claim_audit_logs", id] });
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
      customerId,
      vehicleId,
      claimId: id && isUuid(id) ? id : undefined,
      workOrderType: "insurance",
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

    let savedOrder: WorkOrder;
    try {
      savedOrder = await saveWorkOrderToCloud(order);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ أمر العمل في Supabase");
      return;
    }

    const linkNote = `\n\n[تم إنشاء أمر عمل: ${savedOrder.id}]`;
    if (id && !isNew) {
      await updateClaim.mutateAsync({
        id,
        updates: {
          notes: (notes || "") + linkNote,
          job_order_id: savedOrder.cloudId || null,
        },
      });
      setNotes((notes || "") + linkNote);
      setLinkedWorkOrderId(savedOrder.cloudId || savedOrder.id);
    }

    toast.success(`تم إنشاء أمر العمل ${savedOrder.id} بنجاح`);
    navigate(`/work-orders/${savedOrder.id}`);
  };

  const openStageDialog = (step: { key: string; label: string }) => {
    if (isNew || !id) {
      toast.error("احفظ المطالبة أولاً قبل تغيير المرحلة");
      return;
    }
    setStageDialog({ key: step.key, label: step.label });
    setStageDate(dateOnly(new Date().toISOString()));
    setStageNote("");
  };

  const handleConfirmStageChange = async () => {
    if (!stageDialog || !id || isNew) return;
    const changedAt = stageDate || dateOnly(new Date().toISOString());
    const updates: Record<string, any> = {};

    if (stageDialog.key === "received" || stageDialog.key === "arrived") {
      updates.workshop_arrival_date = changedAt;
      updates.estimate_date = changedAt;
    } else if (stageDialog.key === "awaiting_approval") {
      updates.estimate_date = changedAt;
    } else if (stageDialog.key === "repairing") {
      updates.work_started_at = new Date(changedAt).toISOString();
      updates.status = "approved";
    } else if (stageDialog.key === "ready") {
      updates.work_completed_at = new Date(changedAt).toISOString();
    } else if (stageDialog.key === "delivered") {
      updates.delivered_at = new Date(changedAt).toISOString();
      updates.status = "paid";
    } else {
      toast.info("هذه المرحلة تُدار من الإجراء الخاص بها، وليس من شريط المراحل.");
      return;
    }

    setSavingStage(true);
    try {
      const { data: verified, error } = await supabase
        .from("insurance_claims" as any)
        .update(updates)
        .eq("id", id)
        .select("id,status,estimate_date,workshop_arrival_date,work_started_at,work_completed_at,delivered_at,updated_at")
        .single();
      if (error) throw error;

      hydrateFromVerifiedClaim(verified);
      await writeClaimAudit("claim_vehicle_stage_changed", {
        to_stage: stageDialog.key,
        to_label: stageDialog.label,
        changed_at: changedAt,
        note: stageNote.trim() || null,
        updates,
      });
      await queryClient.invalidateQueries({ queryKey: ["insurance_claims", id] });
      await queryClient.invalidateQueries({ queryKey: ["claim_audit_logs", id] });
      setStageDialog(null);
      toast.success("تم حفظ مرحلة المركبة والتأكد منها");
    } catch (e: any) {
      toast.error(e?.message || "فشل حفظ مرحلة المركبة");
    } finally {
      setSavingStage(false);
    }
  };

  const openUnifiedCustomerPortal = async () => {
    const workOrderForPortal = linkedWorkOrderId || (existing as any)?.auto_job_order_id || (existing as any)?.job_order_id || "";
    if (!workOrderForPortal) {
      toast.error("رابط العميل يتطلب أمر عمل مرتبط بالمطالبة أولاً.");
      return;
    }
    try {
      const { data, error } = await supabase
        .from("customer_portal_tokens" as any)
        .select("token")
        .eq("job_order_id", workOrderForPortal)
        .maybeSingle();
      if (error) throw error;
      if (!(data as any)?.token) {
        toast.error("لم يتم إنشاء رابط العميل بعد. افتح أمر العمل المرتبط لإنشاء/مزامنة رابط العميل.");
        return;
      }
      window.open(`/p/${(data as any).token}`, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      toast.error(e?.message || "تعذر فتح رابط العميل");
    }
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
  const { data: claimAudit = [] } = useQuery({
    queryKey: ["claim_audit_logs", id],
    enabled: !isNew && !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_audit_logs")
        .select("id, action, category, details, created_at, user_id")
        .eq("claim_id", id!)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data || []) as any[];
    },
  });
  const [, refreshExpenses] = useState(0);
  useEffect(() => expensesStore.subscribe(() => refreshExpenses((n) => n + 1)), []);
  const claimExpenses = useMemo(() => {
    if (!existing?.id && !linkedWorkOrderId) return [];
    const seen = new Set<string>();
    return expensesStore.getAll().filter((expense) => {
      if (expense.deletedAt || expense.archivedAt) return false;
      const linked =
        expense.claimId === existing?.id ||
        expense.sourceClaimId === existing?.id ||
        (!!linkedWorkOrderId && (expense.linkedWorkOrderId === linkedWorkOrderId || expense.sourceWorkOrderId === linkedWorkOrderId));
      if (!linked || seen.has(expense.id)) return false;
      seen.add(expense.id);
      return true;
    });
  }, [existing?.id, linkedWorkOrderId]);
  const claimExpensesTotal = useMemo(
    () => claimExpenses.reduce((sum, expense) => sum + (Number(expense.amount) || 0), 0),
    [claimExpenses],
  );
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

  // Status pill
  const statusMeta: Record<string, { label: string; cls: string }> = {
    pending: { label: "بانتظار الموافقة", cls: "bg-warning/15 text-warning" },
    approved: { label: "تمت الموافقة", cls: "bg-success/15 text-success" },
    rejected: { label: "مرفوضة", cls: "bg-destructive/15 text-destructive" },
    paid: { label: "مدفوعة", cls: "bg-info/15 text-info" },
    cancelled: { label: "ملغاة", cls: "bg-muted text-muted-foreground line-through" },
  };
  const invoiceTotal = Number((activeInvoice as any)?.total || 0);
  const paidTotal = (activeInvoice as any)?.paid_amount != null
    ? Number((activeInvoice as any).paid_amount || 0)
    : claimPayments.filter((p) => p.status === "cleared").reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paymentRemaining = Math.max(0, invoiceTotal > 0 ? invoiceTotal - paidTotal : Number(approvedAmount || estimatedCost || 0) - paidTotal);
  const paymentStatusLabel = paymentRemaining <= 0 && paidTotal > 0 ? "مدفوع" : paidTotal > 0 ? "مدفوع جزئيًا" : "غير مدفوع";
  const vehicleTitle = `${vehicleMake || vehicle?.brand || "—"} ${vehicleModel || vehicle?.model || ""}`.trim();
  const hasLinkedWorkOrder = !!(linkedWorkOrderId || (existing as any)?.auto_job_order_id || (existing as any)?.job_order_id);
  const effectiveWorkOrderId = linkedWorkOrderId || (existing as any)?.auto_job_order_id || (existing as any)?.job_order_id || "";
  const linkedWorkOrderStatus = (existing as any)?.job_order?.status || "—";
  const isClosedClaim = status === "cancelled" || status === "rejected";
  const isDeliveredClaim = !!(existing as any)?.delivered_at || status === "paid";
  const isReadyForDelivery = !!workCompletedAt && !isDeliveredClaim && !isClosedClaim;
  const isRepairingClaim = !!workStartedAt && !workCompletedAt && status === "approved";
  const isAwaitingApproval = !isNew && status === "pending";
  const isApprovedClaim = status === "approved";
  const currentClaimStepIndex = isClosedClaim
    ? 3
    : isDeliveredClaim || isReadyForDelivery
      ? 3
      : isRepairingClaim || isApprovedClaim || hasLinkedWorkOrder
        ? 2
        : isAwaitingApproval
          ? 1
          : 0;
  const vehicleProgress = [
    { key: "received", label: "البيانات الأساسية", subtitle: "الاستلام والفحص", Icon: FileText, date: workshopArrivalDate || estimateDate, editable: true },
    { key: "awaiting_approval", label: "الفحص والمرفقات", subtitle: "التقدير والمستندات", Icon: Upload, date: estimateDate, editable: true },
    { key: "repairing", label: "الاعتماد والتنفيذ", subtitle: "الموافقة وأمر العمل", Icon: Wrench, date: workStartedAt || dateOnly((existing as any)?.approved_at), editable: true },
    { key: "ready", label: "الفاتورة والإغلاق", subtitle: "الدفع والتسليم", Icon: PackageCheck, date: workCompletedAt || dateOnly((existing as any)?.delivered_at), editable: true },
  ].map((step, index) => ({
    ...step,
    index,
    state: index < currentClaimStepIndex ? "completed" : index === currentClaimStepIndex ? "current" : "upcoming",
  }));

  useEffect(() => {
    if (!claimViewTouchedRef.current) setClaimViewIndex(currentClaimStepIndex);
  }, [currentClaimStepIndex]);

  if (!isNew && isLoading) {
    return <div className="p-8 text-center text-muted-foreground">جاري التحميل...</div>;
  }

  return (
    <div className="space-y-5 pb-12" dir="rtl">
      <span className="sr-only">Claim Management Center</span>
      <Card className="overflow-hidden rounded-2xl border-slate-200/80 bg-white shadow-sm">
        <div className="grid divide-y divide-border lg:grid-cols-7 lg:divide-x lg:divide-x-reverse lg:divide-y-0">
          <HeaderMetric label="رقم المطالبة" value={claimNumber || "—"} icon={<FileText size={18} className="text-primary" />} strong />
          <HeaderMetric label="شركة التأمين" value={company || "—"} icon={<Building2 size={18} className="text-primary" />} />
          <HeaderMetric label="العميل" value={ownerName || customer?.name || "—"} icon={<UserRound size={18} className="text-slate-700" />} />
          <HeaderMetric label="المركبة" value={vehicleTitle || "—"} icon={<CarFront size={18} className="text-slate-700" />} />
          <HeaderMetric label="رقم اللوحة" value={vehiclePlate || vehicle?.plate_number || "—"} sub={(vehicle as any)?.plate_country || "OM"} />
          <HeaderMetric label="حالة التقدير" value={statusMeta[status]?.label || status} badgeClass={statusMeta[status]?.cls} />
          <HeaderMetric label="حالة الدفع" value={paymentStatusLabel} badgeClass={paymentRemaining <= 0 && paidTotal > 0 ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-700 border-slate-200"} />
        </div>

        <div className="border-t bg-slate-50/80 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2 [&>button]:h-10 [&>button]:rounded-lg [&>button]:px-5 [&>button]:text-sm [&>button]:font-semibold">
            <Button onClick={handleSave} disabled={createClaim.isPending || updateClaim.isPending || uploading} className="gap-2 bg-blue-800 hover:bg-blue-900">
              <Save size={16} /> حفظ
            </Button>
            <Button
              onClick={handleApprove}
              disabled={!isAwaitingApproval || updateStatus.isPending}
              title={!isAwaitingApproval ? "تظهر الموافقة فقط عندما تكون المطالبة بانتظار الاعتماد" : undefined}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <CheckCircle2 size={16} /> اعتماد / موافقة
            </Button>
            {!isNew && isApprovedClaim && hasLinkedWorkOrder ? (
              <Button variant="default" onClick={() => navigate(`/work-orders/${effectiveWorkOrderId}`)} className="gap-2 bg-blue-600 hover:bg-blue-700">
                <ClipboardList size={16} /> فتح أمر العمل
              </Button>
            ) : (
              <Button
                variant="default"
                onClick={handleConvertToWorkOrder}
                disabled={isNew || !isApprovedClaim || hasLinkedWorkOrder}
                title={hasLinkedWorkOrder ? "يوجد أمر عمل مرتبط بالفعل" : !isApprovedClaim ? "يُنشأ أمر العمل بعد اعتماد المطالبة" : undefined}
                className="gap-2 bg-blue-600 hover:bg-blue-700"
              >
                <Wrench size={16} /> إنشاء أمر عمل
              </Button>
            )}
            <Button
              variant="default"
              onClick={generateTaxInvoice}
              disabled={isNew || hasActiveInvoice || isClosedClaim || !canIssueTaxInvoice}
              title={hasActiveInvoice ? "توجد فاتورة مرتبطة بالفعل" : !canIssueTaxInvoice ? "تحتاج LPO أو إكمال أمر العمل/التسليم" : undefined}
              className="gap-2 bg-emerald-600 hover:bg-emerald-700"
            >
              <Receipt size={16} /> إنشاء فاتورة
            </Button>
            <Button variant="outline" onClick={() => setShowSendEmail(true)} disabled={isNew} className="gap-2">
              <MessageCircle size={16} /> إرسال رسالة
            </Button>
            <Button variant="outline" onClick={() => setShowSummary(true)} disabled={isNew} className="gap-2">
              <Printer size={16} /> PDF
            </Button>
            <Button variant="outline" onClick={openUnifiedCustomerPortal} disabled={isNew} className="gap-2">
              <LinkIcon size={16} /> رابط العميل
            </Button>
            <Button variant="outline" disabled title="لا توجد إجراءات إضافية مفعّلة لهذه المرحلة حالياً" className="gap-2">
              <Sparkles size={16} /> المزيد
            </Button>
            <Button variant="ghost" onClick={() => smartBack(navigate, "/insurance/list")} className="gap-2 mr-auto">
              <ArrowRight size={16} /> رجوع
            </Button>
          </div>
        </div>
      </Card>

      <Card className="rounded-2xl border-slate-200 bg-white px-5 py-6 shadow-sm">
        <div className="relative grid gap-4 md:grid-cols-4">
          <div className="absolute left-10 right-10 top-7 hidden border-t border-dashed border-blue-300 md:block" />
          {vehicleProgress.map((step) => {
            const Icon = step.Icon;
            const active = step.state === "current";
            const done = step.state === "completed";
            return (
              <button
                key={step.key}
                type="button"
                onClick={() => {
                  claimViewTouchedRef.current = true;
                  setClaimViewIndex(step.index);
                }}
                disabled={isNew}
                className="relative z-10 flex flex-col items-center gap-2 rounded-xl p-2 text-center transition hover:bg-blue-50/60 disabled:cursor-not-allowed disabled:opacity-70"
              >
                <span
                  className={`flex h-12 w-12 items-center justify-center rounded-full border-2 text-sm font-bold shadow-sm ${
                    claimViewIndex === step.index
                      ? "border-blue-600 bg-blue-600 text-white"
                      : active
                      ? "border-blue-600 bg-blue-600 text-white"
                      : done
                      ? "border-emerald-500 bg-emerald-500 text-white"
                      : "border-slate-200 bg-white text-slate-500"
                  }`}
                >
                  {done ? <CheckCircle2 size={20} /> : active ? step.index + 1 : <Icon size={20} />}
                </span>
                <div className={claimViewIndex === step.index ? "text-blue-700" : active ? "text-blue-700" : done ? "text-emerald-700" : "text-slate-500"}>
                  <div className="font-bold text-sm">{step.index + 1}. {step.label}</div>
                  <div className="text-xs">{step.subtitle}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground">{step.date ? formatDateLatin(step.date) : "لم تُحدّث بعد"}</div>
                </div>
                {claimViewIndex === step.index && <span className="mt-1 h-1 w-28 rounded-full bg-blue-600" />}
              </button>
            );
          })}
        </div>
      </Card>

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
        {[
          { label: "حالة المطالبة", value: statusMeta[status]?.label || status, Icon: BadgeCheck },
          { label: "حالة السيارة", value: vehicleProgress.find((s) => s.state === "current")?.label || "—", Icon: Car },
          { label: "أمر العمل", value: hasLinkedWorkOrder ? "مرتبط" : "غير منشأ", Icon: ClipboardList },
          { label: "الفاتورة", value: activeInvoice ? `#${(activeInvoice as any).invoice_number}` : "لا توجد", Icon: Receipt },
          { label: "المبلغ الموافق", value: `${Number(approvedAmount || 0).toFixed(3)} ر.ع`, Icon: Wallet },
          { label: "آخر تحديث", value: formatDateLatin((existing as any)?.updated_at || new Date()), Icon: Clock3 },
        ].map(({ label, value, Icon }) => (
          <Card key={label} className="rounded-2xl border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon size={15} className="text-primary" /> {label}</div>
            <div className="mt-2 text-sm font-bold text-foreground truncate">{value}</div>
          </Card>
        ))}
      </div>

      {claimViewIndex === 0 && (
        <div className="grid gap-4 xl:grid-cols-[1.15fr_0.9fr_1.1fr] [&>div]:rounded-2xl [&>div]:border-slate-200 [&>div]:bg-white [&>div]:shadow-sm">
          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-blue-700"><Building2 size={18} /> 1. بيانات شركة التأمين / الجهة الدافعة</h2>
              {!isNew && <Button size="sm" variant="outline" onClick={() => setEditInsuranceSection((v) => !v)}>تعديل بيانات التأمين</Button>}
            </div>
            {isNew || editInsuranceSection ? (
              <div className="grid gap-3">
                <div className="space-y-1.5"><Label>شركة التأمين *</Label><InsuranceCompanyAutocomplete value={company} companyId={companyId} onChange={(name, cid) => { setCompany(name); setCompanyId(cid); setInsuranceEmployeeId(null); }} /></div>
                <div className="space-y-1.5"><Label>موظف التأمين</Label><InsuranceEmployeeSelect companyId={companyId} value={insuranceEmployeeId} onChange={setInsuranceEmployeeId} placeholder="الموظف المسؤول" /></div>
                <div className="space-y-1.5"><Label>رقم المطالبة *</Label><Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} /></div>
                <div className="space-y-1.5"><Label>LPO / المرجع</Label><Input value={lpoNumber} onChange={(e) => setLpoNumber(e.target.value)} /></div>
              </div>
            ) : (
              <div className="grid gap-3 text-sm md:grid-cols-2">
                <Info label="اسم شركة التأمين" value={company} />
                <Info label="رقم المطالبة" value={claimNumber} />
                <Info label="موظف التأمين" value={(existing as any)?.insurance_employee?.name || "—"} />
                <Info label="رقم المرجع / LPO" value={lpoNumber || "—"} />
                <Info label="البريد الإلكتروني" value={insuranceCo?.email || "—"} />
                <Info label="رقم التواصل" value={insuranceCo?.phone || "—"} />
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-blue-700"><UserRound size={18} /> بيانات العميل</h2>
              {customerId && <Button size="sm" variant="outline" onClick={() => navigate(`/customers/${customerId}`)}>فتح العميل</Button>}
            </div>
            {isNew ? (
              <div className="grid gap-3">
                <OwnerAutocomplete value={ownerName} onChange={setOwnerName} onSelect={(c) => { setCustomerId(c.id); setOwnerName(c.name); if (c.phone) setOwnerPhone(c.phone); setVehicleId(""); }} customers={customers || []} />
                <Input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+968 ..." dir="ltr" />
              </div>
            ) : (
              <div className="grid gap-3 text-sm">
                <Info label="الاسم" value={ownerName || customer?.name || "—"} />
                <Info label="رقم الجوال" value={ownerPhone || customer?.phone || "—"} />
                <Info label="البريد الإلكتروني" value={(customer as any)?.email || "—"} />
              </div>
            )}
            <Button size="sm" variant="outline" onClick={() => setShowSendEmail(true)} disabled={isNew} className="w-full">إرسال رسالة للعميل</Button>
          </Card>

          <Card className="p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-bold flex items-center gap-2 text-blue-700"><CarFront size={18} /> 3. بيانات السيارة</h2>
              <div className="flex gap-2">
                {!isNew && vehicleId && <Button size="sm" variant="outline" onClick={() => navigate(`/vehicles/${encodeURIComponent(vehicleId)}`)}>فتح المركبة</Button>}
                {!isNew && <Button size="sm" variant="outline" onClick={() => setEditVehicleSection((v) => !v)}>تعديل</Button>}
              </div>
            </div>
            {isNew || editVehicleSection ? (
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
            ) : (
              <div className="flex gap-4">
                <VehicleAvatar imageUrl={(vehicle as any)?.vehicle_cover_image_url || (vehicle as any)?.vehicle_thumbnail_url} fallbackPhotos={damagePhotos} label={vehicleTitle} size="lg" />
                <div className="grid flex-1 gap-2 text-sm">
                  <Info label="اللوحة" value={vehiclePlate || vehicle?.plate_number || "—"} />
                  <Info label="VIN" value={(vehicle as any)?.vin_number || vehicleVin || "—"} />
                  <Info label="الماركة / الموديل" value={`${vehicleTitle} ${vehicleYear || vehicle?.year || ""}`.trim()} />
                  <Info label="اللون" value={vehicleColor || (vehicle as any)?.color || "—"} />
                </div>
              </div>
            )}
          </Card>

          <Card className="p-5 space-y-4 xl:col-span-1">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><ClipboardList size={18} /> 4. ملخص أمر العمل المرتبط</h2>
            <div className="grid gap-3 text-sm">
              <Info label="رقم أمر العمل" value={effectiveWorkOrderId || "—"} />
              <Info label="حالة أمر العمل" value={linkedWorkOrderStatus} />
              <Info label="تاريخ الإنشاء" value={formatDateLatin((existing as any)?.job_order?.created_at || (existing as any)?.created_at || new Date())} />
            </div>
            {hasLinkedWorkOrder ? (
              <Button className="w-full gap-2" onClick={() => navigate(`/work-orders/${effectiveWorkOrderId}`)}><ClipboardList size={15} /> فتح أمر العمل</Button>
            ) : (
              !isNew && isApprovedClaim && <Button className="w-full gap-2" onClick={handleConvertToWorkOrder}><Wrench size={15} /> فتح / إنشاء أمر العمل</Button>
            )}
          </Card>

          <Card className="p-5 xl:col-span-2">
            <h2 className="font-bold flex items-center gap-2 text-blue-700 mb-4"><BadgeCheck size={18} /> بطاقات ملخص سريعة</h2>
            <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
              {[
                ["حالة المطالبة", statusMeta[status]?.label || status, BadgeCheck],
                ["حالة المركبة", vehicleProgress.find((s) => s.state === "current")?.label || "—", Car],
                ["أمر العمل", hasLinkedWorkOrder ? "مفتوح" : "غير منشأ", Wrench],
                ["حالة الفاتورة", activeInvoice ? "مصدرة" : "لم يتم الإنشاء", Receipt],
                ["المبلغ المعتمد", `${Number(approvedAmount || 0).toFixed(3)} ر.ع`, Wallet],
                ["آخر تحديث", formatDateLatin((existing as any)?.updated_at || new Date()), Clock3],
              ].map(([label, value, Icon]: any) => (
                <div key={label} className="rounded-xl border bg-slate-50 p-3 text-center">
                  <Icon size={18} className="mx-auto mb-2 text-blue-700" />
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                  <div className="mt-1 text-sm font-bold">{value}</div>
                </div>
              ))}
            </div>
          </Card>
          <TimelineStrip claimAudit={claimAudit} className="xl:col-span-3" />
        </div>
      )}

      {claimViewIndex === 1 && (
        <div className="grid gap-4 xl:grid-cols-[1.05fr_1.05fr_0.8fr] [&>div]:rounded-2xl [&>div]:border-slate-200 [&>div]:bg-white [&>div]:shadow-sm">
          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold flex items-center gap-2 text-blue-700"><ImagePlus size={18} /> صور الحادث</h2><Badge variant="outline">{damagePhotos.length} صور</Badge></div>
            <div className="grid grid-cols-4 gap-2">
              {damagePhotos.slice(0, 4).map((src, i) => <img key={i} src={src} className="h-20 w-full rounded-lg border object-cover" />)}
              <button type="button" className="flex h-20 items-center justify-center rounded-lg border border-dashed text-muted-foreground" onClick={() => toast.info("استخدم لوحة المستندات بالأسفل لرفع الصور")}>+</button>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="font-bold flex items-center gap-2 text-blue-700"><Camera size={18} /> صور الإصلاح</h2><Button size="sm" variant="outline" onClick={() => setShowInspectionPicker(true)}>ربط فحص</Button></div>
            <div className="grid grid-cols-5 gap-2">
              {damagePhotos.slice(0, 5).map((src, i) => <img key={i} src={src} className="h-20 w-full rounded-lg border object-cover opacity-80" />)}
              <div className="flex h-20 items-center justify-center rounded-lg border border-dashed text-muted-foreground">+</div>
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><FileText size={18} /> ملخص المطالبة</h2>
            <Info label="رقم المطالبة" value={claimNumber || "—"} />
            <Info label="تاريخ الحادث" value={formatDateLatin((existing as any)?.incident_date || (existing as any)?.created_at || new Date())} />
            <Info label="شركة التأمين" value={company || "—"} />
            <Info label="حالة التقدير" value={statusMeta[status]?.label || status} />
            <Button variant="outline" onClick={() => setShowSummary(true)} disabled={isNew}>عرض تفاصيل المطالبة</Button>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><FileUp size={18} /> المستندات</h2>
            {!isNew && id ? <ClaimDocumentsPanel claimId={id} /> : <p className="text-sm text-muted-foreground">احفظ المطالبة أولاً قبل رفع المستندات.</p>}
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><ClipboardCheck size={18} /> تقرير الفحص ROP</h2>
            <Info label="تاريخ الفحص" value={formatDateLatin(estimateDate || (existing as any)?.created_at || new Date())} />
            <Info label="الفاحص" value={(claimAudit as any[])[0]?.user_id || "—"} />
            <Info label="حالة الشاسيه" value="سليم" />
            <Button variant="outline" onClick={() => setShowInspectionPdf(true)} disabled={!linkedInspection}>عرض / تحميل التقرير</Button>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><CarFront size={18} /> موقع الضرر</h2>
            <div className="flex h-48 items-center justify-center rounded-xl border bg-slate-50 text-muted-foreground">
              <CarFront size={72} />
            </div>
            <p className="text-xs text-muted-foreground">تعرض خريطة الضرر عند توفر بيانات الفحص المرتبط.</p>
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><ShieldCheck size={18} /> تقرير LPO</h2>
            <Info label="LPO" value={lpoNumber || "لم يتم إصدار LPO بعد"} />
            <Button variant="outline" disabled={!lpoNumber}>عرض LPO</Button>
          </Card>

          <Card className="p-5 space-y-3 xl:col-span-2">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><CheckSquare size={18} /> البنود المطلوبة / الموافق عليها</h2>
            <ApprovedItemsTable uplItems={uplItems} neededParts={neededParts} />
          </Card>

          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><Calculator size={18} /> ملخص التقدير</h2>
            <Info label="إجمالي قطع الغيار" value={`${Number(estimatedCost || 0).toFixed(3)} ر.ع`} />
            <Info label="أجور الإصلاح" value={`${claimExpensesTotal.toFixed(3)} ر.ع`} />
            <Info label="الإجمالي" value={`${Number(approvedAmount || estimatedCost || 0).toFixed(3)} ر.ع`} />
          </Card>
        </div>
      )}

      {claimViewIndex === 2 && (
        <div className="grid gap-4 xl:grid-cols-4 [&>div]:rounded-2xl [&>div]:border-slate-200 [&>div]:bg-white [&>div]:shadow-sm">
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><ShieldCheck size={18} /> اعتماد شركة التأمين</h2>
            <Badge className={status === "approved" ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"}>{status === "approved" ? "معتمد" : "بانتظار الاعتماد"}</Badge>
            <Info label="تاريخ الاعتماد" value={formatDateLatin(dateOnly((existing as any)?.approved_at) || estimateDate || new Date())} />
            <Info label="رقم اعتماد التأمين" value={lpoNumber || "—"} />
            {isAwaitingApproval && <Button onClick={handleApprove} className="w-full bg-emerald-600 hover:bg-emerald-700">اعتماد نهائي</Button>}
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><UserRound size={18} /> موظف التأمين المعتمد</h2>
            <Info label="الاسم" value={(existing as any)?.insurance_employee?.name || "—"} />
            <Info label="الجوال" value={(existing as any)?.insurance_employee?.phone || insuranceCo?.phone || "—"} />
            <Info label="البريد الإلكتروني" value={(existing as any)?.insurance_employee?.email || insuranceCo?.email || "—"} />
            <Button variant="outline" onClick={() => setShowSendEmail(true)}>تواصل مع موظف التأمين</Button>
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><Calculator size={18} /> المبالغ المعتمدة</h2>
            <Info label="إجمالي التقدير" value={`${Number(estimatedCost || 0).toFixed(3)} ر.ع`} />
            <Info label="الخصم / التحمل" value={`${Number((existing as any)?.deductible_amount || 0).toFixed(3)} ر.ع`} />
            <Info label="الإجمالي المعتمد" value={`${Number(approvedAmount || 0).toFixed(3)} ر.ع`} />
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><Wrench size={18} /> أمر العمل المرتبط</h2>
            <Info label="رقم أمر العمل" value={effectiveWorkOrderId || "—"} />
            <Info label="الحالة" value={linkedWorkOrderStatus} />
            {hasLinkedWorkOrder ? <Button onClick={() => navigate(`/work-orders/${effectiveWorkOrderId}`)}>عرض أمر العمل</Button> : isApprovedClaim && <Button onClick={handleConvertToWorkOrder}>إنشاء أمر العمل</Button>}
          </Card>

          <Card className="p-5 space-y-4 xl:col-span-2">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><Settings size={18} /> تقدم إصلاح المركبة</h2>
            <div className="grid gap-3 md:grid-cols-6">
              {["تم الاستلام", "الفك والتقييم", "الهيكل والسمكرة", "الدهان", "التجميع والفحص", "جاهزة للتسليم"].map((label, i) => (
                <div key={label} className="text-center">
                  <div className={`mx-auto mb-2 flex h-9 w-9 items-center justify-center rounded-full ${i <= currentClaimStepIndex + 1 ? "bg-emerald-600 text-white" : "bg-slate-100 text-slate-400"}`}>{i <= currentClaimStepIndex + 1 ? <CheckCircle2 size={16} /> : i + 1}</div>
                  <div className="text-xs font-semibold">{label}</div>
                  <div className="text-[10px] text-muted-foreground">{i <= currentClaimStepIndex + 1 ? "تم" : "في الانتظار"}</div>
                </div>
              ))}
            </div>
            <Button variant="outline" onClick={() => openStageDialog(vehicleProgress[2])}>تحديث مرحلة التنفيذ</Button>
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><CheckSquare size={18} /> ملخص البنود المعتمدة</h2>
            <Info label="قطع غيار" value={`${neededParts.length} بند`} />
            <Info label="أعمال إصلاح" value={`${uplItems.length} بند`} />
            <Info label="الإجمالي المعتمد" value={`${Number(approvedAmount || 0).toFixed(3)} ر.ع`} />
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><MessagesSquare size={18} /> التواصل والإشعارات</h2>
            <Button variant="outline" onClick={() => setShowSendEmail(true)}>إرسال تحديث</Button>
            <Button variant="outline" onClick={() => navigate(`/messages?claim_id=${existing?.id || ""}`)}>فتح مركز الرسائل</Button>
          </Card>
          <TimelineStrip claimAudit={claimAudit} className="xl:col-span-4" />
        </div>
      )}

      {claimViewIndex === 3 && (
        <div className="grid gap-4 xl:grid-cols-3 [&>div]:rounded-2xl [&>div]:border-slate-200 [&>div]:bg-white [&>div]:shadow-sm">
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><Receipt size={18} /> ملخص الفاتورة</h2>
            <Info label="رقم الفاتورة" value={(activeInvoice as any)?.invoice_number || "—"} />
            <Info label="إجمالي الفاتورة" value={`${invoiceTotal.toFixed(3)} ر.ع`} />
            <Info label="الضريبة" value={`${(invoiceTotal * 0.05).toFixed(3)} ر.ع`} />
            {activeInvoice ? <Button variant="outline" onClick={() => navigate("/insurance/accounting")}>عرض تفاصيل الفاتورة</Button> : <Button onClick={generateTaxInvoice} disabled={!canIssueTaxInvoice}>إنشاء فاتورة</Button>}
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><Wallet size={18} /> ملخص المدفوعات</h2>
            <div className="grid grid-cols-3 gap-3 text-center">
              <Info label="الإجمالي" value={`${invoiceTotal.toFixed(3)} ر.ع`} />
              <Info label="المدفوع" value={`${paidTotal.toFixed(3)} ر.ع`} />
              <Info label="المتبقي" value={`${paymentRemaining.toFixed(3)} ر.ع`} />
            </div>
            <Button className="w-full bg-emerald-600 hover:bg-emerald-700" onClick={() => navigate(`/insurance/payments?claim_id=${existing?.id || ""}`)}>إضافة دفعة</Button>
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><LinkIcon size={18} /> بوابة العميل</h2>
            <p className="text-sm text-muted-foreground">يمكن للعميل متابعة حالة المطالبة والفواتير والمدفوعات والوثائق عبر رابط واحد.</p>
            <Info label="حالة البوابة" value={hasLinkedWorkOrder ? "مفعلة" : "تحتاج أمر عمل مرتبط"} />
            <Button variant="outline" onClick={openUnifiedCustomerPortal} disabled={!hasLinkedWorkOrder}>بوابة العميل</Button>
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><PackageCheck size={18} /> التسليم والإغلاق</h2>
            <Info label="حالة التسليم" value={isDeliveredClaim ? "تم التسليم" : isReadyForDelivery ? "جاهز للتسليم" : "قيد التنفيذ"} />
            <Info label="تاريخ التسليم المتوقع" value={formatDateLatin(workCompletedAt || (existing as any)?.delivered_at || new Date())} />
            <Button variant="outline" onClick={() => openStageDialog(vehicleProgress[3])}>تحديث التسليم</Button>
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><FolderArchive size={18} /> مستندات التسليم</h2>
            {!isNew && id ? <ClaimDocumentsPanel claimId={id} /> : <p className="text-sm text-muted-foreground">احفظ المطالبة أولاً.</p>}
          </Card>
          <Card className="p-5 space-y-3">
            <h2 className="font-bold flex items-center gap-2 text-blue-700"><FileText size={18} /> ملاحظات نهائية</h2>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={5} />
            <Button variant="outline" onClick={handleSave}>تعديل الملاحظة</Button>
          </Card>
          <TimelineStrip claimAudit={claimAudit} className="xl:col-span-3" />
        </div>
      )}

      {false && (
      <div className="hidden">

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold flex items-center gap-2"><Building2 size={18} className="text-primary" /> بيانات شركة التأمين / الجهة الدافعة</h2>
          {!isNew && <Button size="sm" variant="outline" onClick={() => setEditInsuranceSection((v) => !v)}><Building2 size={14} className="ml-1" /> تعديل بيانات التأمين</Button>}
        </div>
        {isNew || editInsuranceSection ? (
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-1.5"><Label>شركة التأمين *</Label><InsuranceCompanyAutocomplete value={company} companyId={companyId} onChange={(name, cid) => { setCompany(name); setCompanyId(cid); setInsuranceEmployeeId(null); }} /></div>
            <div className="space-y-1.5"><Label>موظف التأمين</Label><InsuranceEmployeeSelect companyId={companyId} value={insuranceEmployeeId} onChange={setInsuranceEmployeeId} placeholder="الموظف المسؤول" /></div>
            <div className="space-y-1.5"><Label>رقم المطالبة *</Label><Input value={claimNumber} onChange={(e) => setClaimNumber(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>LPO</Label><Input value={lpoNumber} onChange={(e) => setLpoNumber(e.target.value)} /></div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <Info label="شركة التأمين" value={company} />
            <Info label="رقم المطالبة" value={claimNumber} />
            <Info label="موظف التأمين" value={(existing as any)?.insurance_employee?.name || "—"} />
            <Info label="البريد" value={insuranceCo?.email || "—"} />
            <Info label="الهاتف" value={insuranceCo?.phone || "—"} />
            <Info label="رقم المرجع / LPO" value={lpoNumber || "—"} />
          </div>
        )}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold flex items-center gap-2"><UserRound size={18} className="text-primary" /> بيانات العميل</h2>
            <div className="flex gap-2">
              {customerId && <Button size="sm" variant="outline" onClick={() => navigate(`/customers/${customerId}`)}>فتح العميل</Button>}
              <Button size="sm" variant="ghost" onClick={() => setShowSendEmail(true)} disabled={isNew}>إرسال رسالة</Button>
            </div>
          </div>
          {isNew ? (
            <div className="grid gap-3">
              <OwnerAutocomplete value={ownerName} onChange={setOwnerName} onSelect={(c) => { setCustomerId(c.id); setOwnerName(c.name); if (c.phone) setOwnerPhone(c.phone); setVehicleId(""); }} customers={customers || []} />
              <Input value={ownerPhone} onChange={(e) => setOwnerPhone(e.target.value)} placeholder="+968 ..." dir="ltr" />
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <Info label="الاسم" value={ownerName || customer?.name || "—"} />
              <Info label="الهاتف" value={ownerPhone || customer?.phone || "—"} />
              <Info label="البريد" value={(customer as any)?.email || "—"} />
            </div>
          )}
        </Card>

        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-bold flex items-center gap-2"><CarFront size={18} className="text-primary" /> بيانات السيارة</h2>
            <div className="flex gap-2">
              {!isNew && vehicleId && <Button size="sm" variant="outline" onClick={() => navigate(`/vehicles/${encodeURIComponent(vehicleId)}`)}>فتح المركبة</Button>}
              {!isNew && <Button size="sm" variant="outline" onClick={() => setEditVehicleSection((v) => !v)}><CarFront size={14} className="ml-1" /> تعديل بيانات المركبة</Button>}
            </div>
          </div>
          {isNew || editVehicleSection ? (
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
          ) : (
            <div className="flex gap-4">
              <VehicleAvatar imageUrl={(vehicle as any)?.vehicle_cover_image_url || (vehicle as any)?.vehicle_thumbnail_url} fallbackPhotos={damagePhotos} label={vehicleTitle} size="lg" />
              <div className="grid flex-1 gap-3 md:grid-cols-2 text-sm">
                <Info label="اللوحة" value={vehiclePlate || vehicle?.plate_number || "—"} />
                <Info label="الدولة" value={(vehicle as any)?.plate_country || "OM"} />
                <Info label="VIN" value={(vehicle as any)?.vin_number || vehicleVin || "—"} />
                <Info label="النوع/الموديل" value={`${vehicleTitle} ${vehicleYear || vehicle?.year || ""}`.trim()} />
                <Info label="اللون" value={vehicleColor || (vehicle as any)?.color || "—"} />
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold flex items-center gap-2"><ClipboardList size={18} className="text-primary" /> أمر العمل المرتبط</h2>
          {hasLinkedWorkOrder ? (
            <Button size="sm" variant="outline" onClick={() => navigate(`/work-orders/${effectiveWorkOrderId}`)}>فتح أمر العمل</Button>
          ) : (
            !isNew && isApprovedClaim && <Button size="sm" onClick={handleConvertToWorkOrder}>إنشاء أمر عمل</Button>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          <Info label="رقم أمر العمل" value={effectiveWorkOrderId || "—"} />
          <Info label="الحالة" value={linkedWorkOrderStatus} />
          <Info label="تاريخ الإنشاء" value={formatDateLatin((existing as any)?.job_order?.created_at || (existing as any)?.created_at || new Date())} />
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold flex items-center gap-2"><CheckSquare size={18} className="text-primary" /> البنود الموافق عليها</h2>
        {(uplItems?.length || neededParts?.length) ? (
          <div className="rounded-lg border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-secondary/30"><tr><th className="p-2 text-right">البند</th><th className="p-2">الكمية</th><th className="p-2">الحالة</th><th className="p-2 text-right">ملاحظات</th></tr></thead>
              <tbody>
                {[
                  ...(uplItems || []).map((i: any) => ({ name: i.description, quantity: i.quantity, status: "معتمد", notes: i.notes || "" })),
                  ...(neededParts || []).map((i: any) => ({ name: i.name, quantity: i.quantity, status: i.status || "مطلوب", notes: i.notes || "" })),
                ].map((item, idx) => (
                  <tr key={idx} className="border-t"><td className="p-2">{item.name || "—"}</td><td className="p-2 text-center">{item.quantity || 1}</td><td className="p-2 text-center"><Badge variant="outline">{item.status}</Badge></td><td className="p-2">{item.notes || "—"}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="text-sm text-muted-foreground">لا توجد بنود معتمدة بعد.</p>}
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><ShieldCheck size={18} className="text-primary" /> التقدير والموافقة</h2>
          <div className="grid gap-3 md:grid-cols-2 text-sm">
            <Info label="قيمة التقدير" value={`${Number(estimatedCost || 0).toFixed(3)} ر.ع`} />
            <Info label="قيمة الاعتماد" value={`${Number(approvedAmount || 0).toFixed(3)} ر.ع`} />
            <Info label="الضريبة" value={`${(Number(approvedAmount || estimatedCost || 0) * 0.05).toFixed(3)} ر.ع`} />
            <Info label="الإجمالي" value={`${(Number(approvedAmount || estimatedCost || 0) * 1.05).toFixed(3)} ر.ع`} />
            <Info label="LPO" value={lpoNumber || "—"} />
            <Info label="التحمل / الاهتلاك" value={`${(existing as any)?.deductible_amount || "—"} / ${(existing as any)?.depreciation_amount || "—"}`} />
          </div>
        </Card>

        <Card className="p-5 space-y-3">
          <h2 className="font-bold flex items-center gap-2"><Receipt size={18} className="text-primary" /> الفواتير والمدفوعات</h2>
          <div className="grid gap-3 md:grid-cols-3 text-sm">
            <Info label="رقم الفاتورة" value={(activeInvoice as any)?.invoice_number || "—"} />
            <Info label="الإجمالي" value={`${invoiceTotal.toFixed(3)} ر.ع`} />
            <Info label="المدفوع" value={`${paidTotal.toFixed(3)} ر.ع`} />
            <Info label="المتبقي" value={`${paymentRemaining.toFixed(3)} ر.ع`} />
            <Info label="حالة الدفع" value={paymentStatusLabel} />
          </div>
          <div className="flex flex-wrap gap-2">
            {activeInvoice && <Button size="sm" variant="outline" onClick={() => navigate("/insurance/accounting")}>فتح الفاتورة</Button>}
            {!isNew && <Button size="sm" variant="outline" onClick={() => navigate(`/insurance/payments?claim_id=${existing?.id || ""}`)}>إضافة دفعة</Button>}
            {paymentRemaining > 0 && <Button size="sm" variant="ghost" onClick={() => setShowSendEmail(true)}>تذكير دفع</Button>}
          </div>
        </Card>
      </div>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold flex items-center gap-2"><WalletCards size={18} className="text-primary" /> المصروفات</h2>
        <div className="grid gap-3 md:grid-cols-4 text-sm">
          <Info label="قطع غيار" value={`${claimExpenses.filter((e: any) => String(e.category || "").includes("part")).reduce((s: number, e: any) => s + Number(e.amount || 0), 0).toFixed(3)} ر.ع`} />
          <Info label="عمالة" value={`${claimExpenses.filter((e: any) => String(e.category || "").includes("labor")).reduce((s: number, e: any) => s + Number(e.amount || 0), 0).toFixed(3)} ر.ع`} />
          <Info label="أخرى" value={`${claimExpenses.filter((e: any) => !String(e.category || "").includes("part") && !String(e.category || "").includes("labor")).reduce((s: number, e: any) => s + Number(e.amount || 0), 0).toFixed(3)} ر.ع`} />
          <Info label="الإجمالي" value={`${claimExpensesTotal.toFixed(3)} ر.ع`} />
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => navigate(`/accounting/expenses?claim_id=${existing?.id || ""}`)}>فتح المصروفات</Button>
          <Button size="sm" variant="outline" onClick={() => navigate(`/accounting/expenses?claim_id=${existing?.id || ""}&work_order_id=${effectiveWorkOrderId || ""}`)}>إضافة مصروف</Button>
        </div>
      </Card>

      <Card className="p-5 space-y-3">
        <h2 className="font-bold flex items-center gap-2"><ImagePlus size={18} className="text-primary" /> الصور والمستندات</h2>
        {!isNew && id ? (
          <ClaimDocumentsPanel claimId={id} />
        ) : (
          <p className="text-sm text-muted-foreground">احفظ المطالبة أولاً قبل رفع/عرض المستندات.</p>
        )}
      </Card>

      <Card className="p-5 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="font-bold flex items-center gap-2"><MessagesSquare size={18} className="text-primary" /> المراسلات</h2>
          <Button size="sm" variant="outline" onClick={() => navigate(`/messages?claim_id=${existing?.id || ""}`)}>فتح مركز الرسائل</Button>
        </div>
        <div className="grid gap-3 md:grid-cols-3 text-sm">
          <Info label="رسائل العميل" value="مربوطة بمركز الرسائل" />
          <Info label="رسائل شركة التأمين" value={insuranceCo?.email || "—"} />
          <Info label="سجل الاتصالات" value="Phone / WhatsApp / Email" />
        </div>
      </Card>

      {!isNew && (
        <Card className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-foreground flex items-center gap-2"><History size={18} className="text-primary" /> Timeline / Audit Log</h3>
              <p className="text-xs text-muted-foreground">سجل زمني من Supabase لكل إجراء على المطالبة.</p>
            </div>
            <Badge variant="outline">{claimAudit.length} إجراء</Badge>
          </div>
          <div className="space-y-2 max-h-80 overflow-y-auto">
            {claimAudit.length === 0 ? (
              <div className="text-sm text-muted-foreground border rounded-lg p-4 text-center">لا توجد أحداث مسجلة بعد</div>
            ) : claimAudit.map((item: any) => (
              <div key={item.id} className="flex items-start gap-3 rounded-lg border border-border bg-secondary/20 p-3">
                <div className="mt-1 h-2.5 w-2.5 rounded-full bg-primary shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-sm text-foreground">{item.action}</span>
                    <Badge variant="secondary" className="text-[10px]">{item.category || "audit"}</Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {formatDateLatin(item.created_at)} — المستخدم: {item.user_id || "—"}
                  </div>
                  {item.details && (
                    <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background/70 p-2 text-[11px] text-muted-foreground">
                      {JSON.stringify(item.details, null, 2)}
                    </pre>
                  )}
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      </div>
      )}

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

      <Dialog open={!!stageDialog} onOpenChange={(open) => !open && setStageDialog(null)}>
        <DialogContent dir="rtl" className="max-w-md">
          <DialogHeader>
            <DialogTitle>تأكيد تغيير مرحلة المركبة</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg border border-border bg-secondary/20 p-3">
                <div className="text-xs text-muted-foreground mb-1">المرحلة الحالية</div>
                <div className="font-semibold">
                  {vehicleProgress.find((step) => step.state === "current")?.label || "—"}
                </div>
              </div>
              <div className="rounded-lg border border-primary/30 bg-primary/10 p-3">
                <div className="text-xs text-muted-foreground mb-1">المرحلة الجديدة</div>
                <div className="font-semibold text-primary">{stageDialog?.label || "—"}</div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>تاريخ التغيير</Label>
              <Input type="date" value={stageDate} onChange={(e) => setStageDate(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>ملاحظة اختيارية</Label>
              <Textarea
                value={stageNote}
                onChange={(e) => setStageNote(e.target.value)}
                rows={3}
                placeholder="مثال: تم تحديث المرحلة بعد اتصال شركة التأمين"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setStageDialog(null)} disabled={savingStage}>
                إلغاء
              </Button>
              <Button onClick={handleConfirmStageChange} disabled={savingStage || !stageDate}>
                {savingStage ? "جاري الحفظ..." : "تأكيد"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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
function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-slate-50/70 p-3">
      <div className="mb-1 text-[11px] font-medium text-slate-500">{label}</div>
      <div className="font-semibold text-foreground break-words">{value || "—"}</div>
    </div>
  );
}

// Owner autocomplete — searches the tenant customers list and lets the
// user keep typing a brand-new name (which will be auto-created on save).
// ════════════════════════════════════════════════════════════════════════
function HeaderMetric({
  label,
  value,
  sub,
  icon,
  strong,
  badgeClass,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  strong?: boolean;
  badgeClass?: string;
}) {
  return (
    <div className="flex min-h-[92px] items-center justify-center gap-3 px-4 py-4 text-center">
      {icon && <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-blue-50">{icon}</div>}
      <div className="min-w-0 space-y-1">
        <div className="text-xs font-semibold text-slate-500">{label}</div>
        {badgeClass ? (
          <span className={`inline-flex max-w-full items-center justify-center rounded-full border px-3 py-1.5 text-xs font-bold shadow-sm ${badgeClass}`}>
            <span className="truncate">{value || "—"}</span>
          </span>
        ) : (
          <div className={`${strong ? "text-lg text-blue-700" : "text-sm text-slate-900"} truncate font-extrabold tracking-tight`}>
            {value || "—"}
          </div>
        )}
        {sub && <div className="text-[11px] font-medium text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

function ApprovedItemsTable({ uplItems, neededParts }: { uplItems: UplItem[]; neededParts: ClaimNeededPart[] }) {
  const rows = [
    ...(uplItems || []).map((item: any) => ({
      name: item.description || item.name || "—",
      quantity: item.quantity || 1,
      status: "معتمد",
      notes: item.notes || "—",
    })),
    ...(neededParts || []).map((item: any) => ({
      name: item.name || "—",
      quantity: item.quantity || 1,
      status: item.status || "مطلوب",
      notes: item.notes || "—",
    })),
  ];
  if (rows.length === 0) return <p className="rounded-lg border border-dashed p-4 text-center text-sm text-muted-foreground">لا توجد بنود مسجلة بعد.</p>;
  return (
    <div className="overflow-hidden rounded-xl border">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 text-slate-500">
          <tr>
            <th className="p-2 text-right">اسم البند</th>
            <th className="p-2 text-center">الكمية</th>
            <th className="p-2 text-center">الحالة</th>
            <th className="p-2 text-right">ملاحظات</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={`${row.name}-${index}`} className="border-t">
              <td className="p-2">{row.name}</td>
              <td className="p-2 text-center">{row.quantity}</td>
              <td className="p-2 text-center"><Badge variant="outline">{row.status}</Badge></td>
              <td className="p-2 text-muted-foreground">{row.notes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TimelineStrip({ claimAudit, className = "" }: { claimAudit: any[]; className?: string }) {
  const items = (claimAudit || []).slice(0, 6);
  return (
    <Card className={`p-5 ${className}`}>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="font-bold flex items-center gap-2 text-blue-700"><History size={18} /> سجل الإجراءات (Timeline)</h2>
        <Badge variant="outline">{claimAudit.length} إجراء</Badge>
      </div>
      {items.length === 0 ? (
        <p className="text-center text-sm text-muted-foreground">لا توجد أحداث مسجلة بعد.</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-6">
          {items.map((item: any) => (
            <div key={item.id} className="text-center">
              <div className="mx-auto mb-2 flex h-10 w-10 items-center justify-center rounded-full border bg-white text-blue-700 shadow-sm"><Clock3 size={16} /></div>
              <div className="text-xs font-bold text-blue-700">{item.action}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{formatDateLatin(item.created_at)}</div>
              <div className="text-[10px] text-muted-foreground truncate">{item.user_id || "—"}</div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

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
