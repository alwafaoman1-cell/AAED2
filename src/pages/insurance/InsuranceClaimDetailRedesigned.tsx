import { useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  AlertCircle,
  Building2,
  CalendarClock,
  Car,
  CheckCircle2,
  ClipboardCheck,
  FileText,
  History,
  Image,
  Mail,
  MapPin,
  Paperclip,
  Phone,
  Printer,
  Receipt,
  Save,
  Search,
  Send,
  ShieldCheck,
  Upload,
  User,
  Wrench,
} from "lucide-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useClaim } from "@/hooks/useInsuranceClaims";
import { useCreateInsuranceInvoice, useInsuranceInvoices } from "@/hooks/useInsuranceInvoices";
import { usePaymentsByClaim } from "@/hooks/useClaimPayments";
import { useClaimDocuments } from "@/hooks/useClaimDocuments";
import { displayCustomerCode } from "@/lib/customerCode";
import { parseMoneyInput } from "@/lib/formatters/numberFormat";
import { isUuid } from "@/lib/uuid";

const PRIMARY = "#0f2f57";
const GOLD = "#c69b43";
const VAT_RATE = 0.05;

type StageKey =
  | "received_at"
  | "claim_registered_at"
  | "inspection_at"
  | "insurance_approved_at"
  | "repair_started_at"
  | "quality_checked_at"
  | "delivered_at"
  | "invoice_collected_at";

const STAGES: Array<{ key: StageKey; label: string; icon: string }> = [
  { key: "received_at", label: "استلام المركبة", icon: "📥" },
  { key: "claim_registered_at", label: "تسجيل المطالبة", icon: "📄" },
  { key: "inspection_at", label: "المعاينة والتقدير", icon: "🔎" },
  { key: "insurance_approved_at", label: "موافقة التأمين", icon: "✅" },
  { key: "repair_started_at", label: "الإصلاح", icon: "🔧" },
  { key: "quality_checked_at", label: "فحص الجودة", icon: "🧪" },
  { key: "delivered_at", label: "التسليم", icon: "🚗" },
  { key: "invoice_collected_at", label: "الفاتورة والتحصيل", icon: "🧾" },
];

const LOCATION_OPTIONS = [
  "ساحة الانتظار",
  "منطقة الفحص",
  "قسم السمكرة والشاصي",
  "قسم الصبغ والفرن",
  "قسم الميكانيك",
  "قسم الكهرباء",
  "منطقة التسليم",
  "خارج الورشة — تم التسليم",
];

const EMAIL_TEMPLATES = [
  "تقرير الفحص",
  "طلب اعتماد المطالبة",
  "طلب إصدار LPO",
  "إرسال أوراق التسليم",
  "إرسال الفاتورة النهائية",
  "متابعة الدفع",
  "رسالة مخصصة",
];

const safe = (value: unknown, fallback = "—") => {
  if (value === null || value === undefined || value === "") return fallback;
  return String(value);
};

const dateOnly = (value?: string | null) => (value ? String(value).slice(0, 10) : "");

const omr = (value: number) =>
  new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 3,
    maximumFractionDigits: 3,
  }).format(Number.isFinite(value) ? value : 0) + " OMR";

const toIsoOrNull = (value: string) => (value ? new Date(value).toISOString() : null);

function extractLpoFromNotes(notes?: string | null) {
  const text = notes || "";
  return {
    number: text.match(/\[LPO:([^\]]+)\]/)?.[1]?.trim() || "",
    date: text.match(/\[LPO_DATE:([^\]]+)\]/)?.[1]?.trim() || "",
    amount: text.match(/\[LPO_AMOUNT:([^\]]+)\]/)?.[1]?.trim() || "",
    note: text.match(/\[LPO_NOTE:([^\]]+)\]/)?.[1]?.trim() || "",
    file: text.match(/\[LPO_FILE:([^\]]+)\]/)?.[1]?.trim() || "",
    fileName: text.match(/\[LPO_FILE_NAME:([^\]]+)\]/)?.[1]?.trim() || "",
    receivedAt: text.match(/\[LPO_RECEIVED_AT:([^\]]+)\]/)?.[1]?.trim() || "",
  };
}

function appendClaimNote(existing: string | null | undefined, markers: Record<string, unknown>) {
  const lines = Object.entries(markers)
    .filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "")
    .map(([key, value]) => `[${key}:${String(value).replace(/\]/g, ")")}]`);
  if (!lines.length) return existing || "";
  return [existing || "", ...lines].filter(Boolean).join("\n");
}

function getMissingColumn(error: any) {
  const text = [error?.message, error?.details, error?.hint, error?.code].filter(Boolean).join(" ");
  return text.match(/'([^']+)' column/)?.[1] || text.match(/column "([^"]+)"/)?.[1] || null;
}

async function insertTimeline(claim: any, action: string, details: Record<string, unknown>) {
  if (!claim?.id || !claim?.tenant_id) return;
  const payload: Record<string, unknown> = {
    tenant_id: claim.tenant_id,
    claim_id: claim.id,
    vehicle_id: claim.vehicle_id || null,
    action,
    category: "claim_detail",
    details,
  };
  const { error } = await supabase.from("claim_audit_logs").insert(payload as any);
  if (error) {
    // Timeline must not break the business action. Surface only in console.
    console.warn("[claim timeline] insert failed", error.message);
  }
}

async function updateClaimColumns(
  id: string,
  updates: Record<string, unknown>,
  fallback?: { existingNotes?: string | null; markers?: Record<string, unknown> },
) {
  let payload = { ...updates };
  const ignoredColumns: string[] = [];

  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (!Object.keys(payload).length) break;
    const { data, error } = await supabase
      .from("insurance_claims" as any)
      .update(payload)
      .eq("id", id)
      .select("*")
      .single();
    if (!error) {
      if (ignoredColumns.length && fallback?.markers) {
        await supabase
          .from("insurance_claims" as any)
          .update({ notes: appendClaimNote((data as any)?.notes ?? fallback.existingNotes, fallback.markers) })
          .eq("id", id);
      }
      return data as any;
    }

    const missingColumn = getMissingColumn(error);
    if (missingColumn && Object.prototype.hasOwnProperty.call(payload, missingColumn)) {
      ignoredColumns.push(missingColumn);
      const { [missingColumn]: _removed, ...rest } = payload;
      payload = rest;
      continue;
    }
    throw error;
  }

  if (fallback?.markers) {
    const { data, error } = await supabase
      .from("insurance_claims" as any)
      .update({ notes: appendClaimNote(fallback.existingNotes, fallback.markers) })
      .eq("id", id)
      .select("*")
      .single();
    if (error) throw error;
    return data as any;
  }

  if (ignoredColumns.length) {
    throw new Error(`Missing insurance_claims columns in schema cache: ${ignoredColumns.join(", ")}`);
  }
  return null;
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="mb-4 flex items-center gap-2 border-b pb-3" style={{ color: PRIMARY }}>
      {icon}
      <h2 className="text-base font-extrabold">{title}</h2>
    </div>
  );
}

function InfoField({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="rounded-xl border bg-slate-50/70 p-3">
      <div className="mb-1 text-[11px] font-extrabold text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-sm font-bold" : "text-sm font-bold text-slate-900"}>{value || "—"}</div>
    </div>
  );
}

export default function InsuranceClaimDetailRedesigned() {
  const { id, claimId } = useParams();
  const currentId = claimId || id;
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: claim, isLoading, error } = useClaim(currentId);
  const { data: documentsRows = [] } = useClaimDocuments(currentId);
  const { data: payments = [] } = usePaymentsByClaim(currentId);
  const { data: invoices = [] } = useInsuranceInvoices();
  const createInsuranceInvoice = useCreateInsuranceInvoice();
  const lpoFileRef = useRef<HTMLInputElement>(null);

  const [locationOpen, setLocationOpen] = useState(false);
  const [inspectionOpen, setInspectionOpen] = useState(false);
  const [emailOpen, setEmailOpen] = useState(false);
  const [stageSaving, setStageSaving] = useState<StageKey | null>(null);
  const [locationSection, setLocationSection] = useState("");
  const [locationBay, setLocationBay] = useState("");
  const [locationNote, setLocationNote] = useState("");
  const [inspectionSearch, setInspectionSearch] = useState("");
  const [emailTemplate, setEmailTemplate] = useState("طلب إصدار LPO");
  const [emailTo, setEmailTo] = useState("");
  const [emailCc, setEmailCc] = useState("");
  const [emailBody, setEmailBody] = useState("");
  const [lpoNumber, setLpoNumber] = useState("");
  const [lpoDate, setLpoDate] = useState("");
  const [lpoAmount, setLpoAmount] = useState("");

  const { data: timeline = [] } = useQuery({
    queryKey: ["claim_audit_logs", currentId],
    enabled: !!currentId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("claim_audit_logs")
        .select("id, action, category, details, created_at, user_id")
        .eq("claim_id", currentId!)
        .order("created_at", { ascending: false })
        .limit(60);
      if (error) throw error;
      return (data || []) as any[];
    },
  });

  const linkedInvoice = useMemo(
    () => invoices.find((invoice) => invoice.claim_id === currentId && invoice.status !== "cancelled"),
    [invoices, currentId],
  );

  const customer = (claim as any)?.customer || null;
  const vehicle = (claim as any)?.vehicle || null;
  const workOrder = (claim as any)?.job_order || null;
  const inlineVehicle = {
    make: (claim as any)?.vehicle_make,
    model: (claim as any)?.vehicle_model,
    plate: (claim as any)?.vehicle_plate,
    year: (claim as any)?.vehicle_year,
    color: (claim as any)?.vehicle_color,
    vin: (claim as any)?.vehicle_vin,
  };

  const vehicleName = [vehicle?.brand || inlineVehicle.make, vehicle?.model || inlineVehicle.model, vehicle?.year || inlineVehicle.year]
    .filter(Boolean)
    .join(" ");
  const plate = [vehicle?.plate_number || inlineVehicle.plate, vehicle?.plate_letters].filter(Boolean).join(" ");
  const cover = vehicle?.vehicle_cover_image_url || vehicle?.vehicle_thumbnail_url || "";
  const lpoFromNotes = extractLpoFromNotes(claim?.notes);
  const effectiveLpo = {
    number: (claim as any)?.lpo_number || lpoNumber || lpoFromNotes.number,
    date: dateOnly((claim as any)?.lpo_received_at) || dateOnly((claim as any)?.lpo_date) || lpoDate || lpoFromNotes.receivedAt || lpoFromNotes.date,
    amount: (claim as any)?.lpo_amount ? String((claim as any).lpo_amount) : lpoAmount || lpoFromNotes.amount,
    file: (claim as any)?.lpo_file_url || lpoFromNotes.file || "",
    fileName: (claim as any)?.lpo_file_name || lpoFromNotes.fileName || "",
  };
  const hasLpo = !!(effectiveLpo.number || effectiveLpo.file);

  const subtotal = parseMoneyInput(String(claim?.approved_amount ?? claim?.estimated_amount ?? 0)) || 0;
  const vat = Math.round(subtotal * VAT_RATE * 1000) / 1000;
  const total = Math.round((subtotal + vat) * 1000) / 1000;
  const paid = payments.reduce((sum: number, p: any) => sum + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, total - paid);
  const hasItemizedParts = Array.isArray(claim?.needed_parts) && claim!.needed_parts.some((p) => p.name?.trim());
  const laborCharges = 0;
  const partsCharges = 0;

  const missingDocs = [
    !hasLpo ? "LPO" : "",
    documentsRows.length === 0 && !claim?.documents?.length ? "المستندات" : "",
    !linkedInvoice ? "فاتورة التأمين" : "",
  ].filter(Boolean);

  const statusText = (() => {
    if (linkedInvoice && remaining <= 0) return "Closed";
    if (linkedInvoice) return "Invoice Issued - Payment Pending";
    if (hasLpo) return "LPO Received - Invoice Pending";
    if (dateOnly((claim as any)?.delivered_at)) return "Delivered - Waiting LPO";
    if (claim?.status === "approved") return "Repair In Progress";
    return safe(claim?.status, "Pending");
  })();

  const emailSubject = `Claim ${safe(claim?.claim_number)} | ${safe(workOrder?.order_number)} | Plate ${safe(plate)} | ${safe(vehicleName)}`;

  const refreshClaim = async () => {
    await queryClient.invalidateQueries({ queryKey: ["insurance_claims", currentId] });
    await queryClient.invalidateQueries({ queryKey: ["insurance_claims"] });
    await queryClient.invalidateQueries({ queryKey: ["claim_audit_logs", currentId] });
  };

  const saveStageDate = async (key: StageKey, value: string) => {
    if (!currentId || !claim) return;
    setStageSaving(key);
    try {
      await updateClaimColumns(currentId, { [key]: toIsoOrNull(value) });
      await insertTimeline(claim, "claim_stage_date_updated", { stage: key, date: value });
      await refreshClaim();
      toast.success("تم حفظ تاريخ المرحلة");
    } catch (e: any) {
      toast.error(e?.message || "فشل حفظ تاريخ المرحلة");
    } finally {
      setStageSaving(null);
    }
  };

  const saveVehicleLocation = async () => {
    if (!currentId || !claim) return;
    if (!locationSection) {
      toast.error("حدد موقع المركبة أولًا");
      return;
    }
    if (locationSection !== "خارج الورشة — تم التسليم" && !locationBay.trim()) {
      toast.error("رقم الموقف/العنبر مطلوب لهذا الموقع");
      return;
    }
    try {
      const { data: auth } = await supabase.auth.getUser();
      const updatedAt = new Date().toISOString();
      await updateClaimColumns(currentId, {
        vehicle_location_section: locationSection,
        vehicle_location_bay: locationBay.trim() || null,
        vehicle_location_note: locationNote.trim() || null,
        vehicle_location_updated_at: updatedAt,
        vehicle_location_updated_by: auth.user?.id || null,
      }, {
        existingNotes: claim.notes,
        markers: {
          VEHICLE_LOCATION_SECTION: locationSection,
          VEHICLE_LOCATION_BAY: locationBay.trim() || null,
          VEHICLE_LOCATION_NOTE: locationNote.trim() || null,
          VEHICLE_LOCATION_UPDATED_AT: updatedAt,
        },
      });
      await insertTimeline(claim, "vehicle_location_updated", {
        section: locationSection,
        bay: locationBay.trim() || null,
        note: locationNote.trim() || null,
      });
      await refreshClaim();
      setLocationOpen(false);
      toast.success("تم تحديث موقع المركبة");
    } catch (e: any) {
      toast.error(e?.message || "فشل تحديث موقع المركبة");
    }
  };

  const requestLpo = async () => {
    if (!currentId || !claim) return;
    try {
      const { data: auth } = await supabase.auth.getUser();
      const requestedAt = new Date().toISOString();
      await updateClaimColumns(currentId, {
        lpo_requested_at: requestedAt,
        lpo_requested_by: auth.user?.id || null,
        lpo_followup_method: "manual",
        lpo_followup_note: "LPO requested from claim detail page",
      }, {
        existingNotes: claim.notes,
        markers: {
          LPO_REQUESTED_AT: requestedAt,
          LPO_FOLLOWUP_METHOD: "manual",
          LPO_NOTE: "LPO requested from claim detail page",
        },
      });
      await insertTimeline(claim, "lpo_requested", { claim_number: claim.claim_number, requested_at: requestedAt });
      await refreshClaim();
      toast.success("تم تسجيل طلب إصدار LPO");
    } catch (e: any) {
      toast.error(e?.message || "فشل تسجيل طلب LPO");
    }
  };

  const uploadLpo = async (file: File | null) => {
    if (!file || !currentId || !claim) return;
    if (!effectiveLpo.number && !lpoNumber.trim()) {
      toast.error("اكتب رقم LPO قبل الرفع");
      return;
    }
    try {
      const ext = file.name.split(".").pop() || "bin";
      const path = `claims/${currentId}/docs/lpo-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage.from("insurance-docs").upload(path, file, {
        contentType: file.type || "application/octet-stream",
      });
      if (uploadError) throw uploadError;
      const { data } = await supabase.storage.from("insurance-docs").createSignedUrl(path, 60 * 60 * 24 * 7);
      const docs = [...(claim.documents || []), { name: file.name, type: "lpo", url: data?.signedUrl || path }];
      const receivedAt = lpoDate ? new Date(lpoDate).toISOString() : new Date().toISOString();
      await updateClaimColumns(currentId, {
        lpo_number: lpoNumber.trim() || effectiveLpo.number,
        lpo_date: lpoDate || effectiveLpo.date || null,
        lpo_received_at: receivedAt,
        lpo_amount: parseMoneyInput(lpoAmount || effectiveLpo.amount) || null,
        lpo_file_url: data?.signedUrl || path,
        lpo_file_name: file.name,
        documents: docs,
      }, {
        existingNotes: claim.notes,
        markers: {
          LPO: lpoNumber.trim() || effectiveLpo.number,
          LPO_RECEIVED_AT: receivedAt,
          LPO_DATE: lpoDate || effectiveLpo.date || "",
          LPO_AMOUNT: parseMoneyInput(lpoAmount || effectiveLpo.amount) || "",
          LPO_FILE: data?.signedUrl || path,
          LPO_FILE_NAME: file.name,
        },
      });
      await insertTimeline(claim, "lpo_uploaded", { file: file.name, lpo_number: lpoNumber || effectiveLpo.number });
      await refreshClaim();
      toast.success("تم رفع LPO وحفظ بياناته");
    } catch (e: any) {
      toast.error(e?.message || "فشل رفع LPO");
    }
  };

  const issueInsuranceInvoice = async () => {
    if (!claim || !currentId) return;
    if (!hasLpo) {
      toast.error("لا يمكن إصدار فاتورة التأمين قبل تسجيل/إرفاق LPO");
      return;
    }
    if (linkedInvoice) {
      toast.info("توجد فاتورة تأمين نشطة لهذه المطالبة");
      return;
    }
    try {
      const invoice = await createInsuranceInvoice.mutateAsync({
        tenant_id: claim.tenant_id,
        claim_id: currentId,
        insurance_company_id: claim.insurance_company_id || null,
        insurance_company_name: claim.insurance_company || "Insurance Company",
        vehicle_make: vehicle?.brand || inlineVehicle.make || null,
        vehicle_model: vehicle?.model || inlineVehicle.model || null,
        vehicle_plate: plate || null,
        subtotal,
        vat,
        total,
        paid_amount: 0,
        status: "issued",
        lpo_number: effectiveLpo.number || null,
        notes: "Created from insurance claim detail page",
        items: [{ description: `Insurance repair claim ${claim.claim_number}`, quantity: 1, unit_price: subtotal }],
        idempotency_key: `claim:${currentId}:insurance-invoice`,
      });
      await insertTimeline(claim, "insurance_invoice_created", { invoice_id: invoice.id, total });
      await refreshClaim();
      toast.success("تم إصدار فاتورة التأمين");
    } catch (e: any) {
      toast.error(e?.message || "فشل إصدار فاتورة التأمين");
    }
  };

  const saveEmailDraft = async () => {
    if (!claim) return;
    await insertTimeline(claim, "insurance_email_draft_saved", {
      template: emailTemplate,
      to: emailTo,
      cc: emailCc,
      subject: emailSubject,
    });
    await queryClient.invalidateQueries({ queryKey: ["claim_audit_logs", currentId] });
    setEmailOpen(false);
    toast.success("تم حفظ مسودة البريد في سجل المطالبة");
  };

  if (isLoading) {
    return <div className="p-8 text-center text-muted-foreground">جاري تحميل تفاصيل المطالبة...</div>;
  }
  if (error || !claim) {
    return (
      <div className="p-8">
        <Card className="border-red-200 bg-red-50 p-6 text-red-700">
          تعذر تحميل المطالبة. {String((error as any)?.message || "")}
        </Card>
      </div>
    );
  }

  return (
    <div dir="rtl" className="min-h-screen bg-[#f5f7fb] pb-24">
      <div className="mx-auto max-w-[1560px] space-y-4 p-3 md:p-5">
        <Card className="rounded-2xl border bg-white p-4 shadow-[0_10px_30px_rgba(15,47,87,.07)]">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex items-center gap-4">
              <div className="grid h-[72px] w-[72px] place-items-center overflow-hidden rounded-full border-4 border-white bg-blue-50 shadow ring-1 ring-slate-200">
                {cover ? <img src={cover} className="h-full w-full object-cover" /> : <Car className="h-9 w-9 text-[#0f2f57]" />}
              </div>
              <div>
                <h1 className="text-xl font-extrabold text-[#0f2f57] md:text-2xl">المطالبة {safe(claim.claim_number)}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {safe(vehicleName)} — اللوحة {safe(plate)} — {safe(claim.insurance_company)}
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge className="bg-amber-100 text-amber-800 hover:bg-amber-100">{statusText}</Badge>
                  <Badge variant="outline">{safe(workOrder?.order_number, "لا يوجد أمر عمل")}</Badge>
                  <Badge variant="outline">Customer Code: {displayCustomerCode(customer || { id: claim.customer_id })}</Badge>
                  <Badge variant="outline">المسؤول: {safe((claim as any).adjuster_name || (claim as any).created_by_name)}</Badge>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={() => workOrder?.order_number ? navigate(`/work-orders/${workOrder.order_number}`) : toast.info("لا يوجد أمر عمل مرتبط")}>
                <Wrench className="ml-2 h-4 w-4" /> فتح أمر العمل
              </Button>
              <Button variant="outline" onClick={() => setLocationOpen(true)}>
                <MapPin className="ml-2 h-4 w-4" /> موقع المركبة
              </Button>
              <Button variant="outline" onClick={() => window.print()}>
                <Printer className="ml-2 h-4 w-4" /> طباعة / PDF
              </Button>
              <Button variant="outline" onClick={() => setInspectionOpen(true)}>
                <ClipboardCheck className="ml-2 h-4 w-4" /> نموذج الفحص
              </Button>
              <Button style={{ background: GOLD, color: "white" }} onClick={() => setEmailOpen(true)}>
                <Send className="ml-2 h-4 w-4" /> إرسال تقرير التأمين
              </Button>
              <Button variant="secondary" onClick={requestLpo}>طلب إصدار LPO</Button>
              <Button style={{ background: PRIMARY, color: "white" }} onClick={() => toast.info("الحقول المعروضة محفوظة من إجراءاتها المباشرة")}>
                <Save className="ml-2 h-4 w-4" /> حفظ
              </Button>
            </div>
          </div>
        </Card>

        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
          {[
            ["الحالة الحالية", statusText, hasLpo ? "LPO مسجل" : "بانتظار LPO"],
            ["مدة المركبة في الورشة", `${Math.max(0, Math.ceil((Date.now() - new Date((claim as any).received_at || claim.workshop_arrival_date || claim.created_at).getTime()) / 86400000))} يوم`, "من تاريخ الاستلام"],
            ["المستندات الناقصة", `${missingDocs.length}`, missingDocs.join("، ") || "مكتملة"],
            ["نموذج الفحص", (claim as any).inspection_id ? "مرفق" : "غير مرفق", "يمكن ربطه من البحث"],
            ["المبلغ المعتمد", omr(subtotal), "قبل الضريبة"],
            ["الإجراء التالي", hasLpo ? (linkedInvoice ? "متابعة التحصيل" : "إصدار الفاتورة") : "طلب / إرفاق LPO", "حسب سير المطالبة"],
          ].map(([label, value, note]) => (
            <Card key={label} className="rounded-2xl border bg-white p-4">
              <div className="text-[11px] font-extrabold text-muted-foreground">{label}</div>
              <div className="mt-2 text-base font-extrabold text-[#0f2f57]">{value}</div>
              <div className="mt-1 text-[11px] text-muted-foreground">{note}</div>
            </Card>
          ))}
        </div>

        <Card className="grid gap-2 rounded-2xl border bg-white p-3 md:grid-cols-4 xl:grid-cols-8">
          {STAGES.map((stage, index) => {
            const value = dateOnly((claim as any)[stage.key]);
            const done = !!value;
            const active = !done && STAGES.findIndex((s) => !dateOnly((claim as any)[s.key])) === index;
            return (
              <div
                key={stage.key}
                className={`rounded-xl border p-2 text-center text-xs font-extrabold ${
                  done ? "border-emerald-200 bg-emerald-50 text-emerald-700" : active ? "border-sky-300 bg-sky-50 text-[#0f2f57] ring-2 ring-sky-300" : "bg-white text-muted-foreground"
                }`}
              >
                <div className="text-xl">{stage.icon}</div>
                <div className="min-h-[32px]">{stage.label}</div>
                <Input
                  type="date"
                  defaultValue={value}
                  disabled={stageSaving === stage.key}
                  className="mt-2 h-8 text-center text-[11px]"
                  onBlur={(event) => {
                    if (event.currentTarget.value !== value) void saveStageDate(stage.key, event.currentTarget.value);
                  }}
                />
              </div>
            );
          })}
        </Card>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2.1fr)_minmax(320px,.9fr)]">
          <main className="space-y-4">
            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<ShieldCheck className="h-5 w-5" />} title="التأمين والتكلفة" />
              {!hasLpo && dateOnly((claim as any).delivered_at) && (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
                  تم التسليم، لكن لا يمكن إصدار فاتورة التأمين أو إغلاق المطالبة ماليًا قبل تسجيل/إرفاق LPO.
                </div>
              )}
              <div className="grid gap-3 md:grid-cols-3">
                <InfoField label="Insurance Company" value={claim.insurance_company} />
                <InfoField label="Claim Number" value={claim.claim_number} mono />
                <InfoField label="Claim Status" value={statusText} />
              </div>
              <div className="mt-4 grid gap-2">
                {[
                  ["Insurance Approved Amount", subtotal],
                  ["Subtotal before VAT", subtotal],
                  ["VAT 5%", vat],
                  ["Labor Charges", laborCharges],
                  ["Parts", partsCharges],
                ].map(([label, value]) => (
                  <div key={label as string} className="flex items-center justify-between rounded-xl border bg-slate-50 px-4 py-3 text-sm">
                    <span>{label}</span>
                    <strong dir="ltr">{omr(value as number)}</strong>
                  </div>
                ))}
                <div className="flex items-center justify-between rounded-xl px-4 py-3 text-sm text-white" style={{ background: PRIMARY }}>
                  <span>Total Including VAT</span>
                  <strong dir="ltr">{omr(total)}</strong>
                </div>
              </div>
              {!hasItemizedParts && (
                <div className="mt-3 rounded-xl border border-sky-200 bg-sky-50 p-3 text-xs font-bold text-sky-800">
                  Lump Sum approval, not itemized. Approved Amount مستقل ولا يدخل تلقائيًا في Labor أو Parts.
                </div>
              )}
              <div className="mt-5 grid gap-3 md:grid-cols-3">
                <div>
                  <Label>رقم LPO</Label>
                  <Input value={lpoNumber || effectiveLpo.number} onChange={(e) => setLpoNumber(e.target.value)} placeholder="LPO-0001" />
                </div>
                <div>
                  <Label>تاريخ LPO</Label>
                  <Input type="date" value={lpoDate || effectiveLpo.date} onChange={(e) => setLpoDate(e.target.value)} />
                </div>
                <div>
                  <Label>مبلغ LPO</Label>
                  <Input value={lpoAmount || effectiveLpo.amount} onChange={(e) => setLpoAmount(e.target.value)} placeholder="0.000" />
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button variant="secondary" onClick={requestLpo}>تسجيل طلب LPO</Button>
                <input ref={lpoFileRef} type="file" hidden accept=".pdf,image/*" onChange={(e) => void uploadLpo(e.target.files?.[0] || null)} />
                <Button variant="outline" onClick={() => lpoFileRef.current?.click()}>
                  <Upload className="ml-2 h-4 w-4" /> إرفاق LPO
                </Button>
                <Button disabled={!hasLpo || !!linkedInvoice || createInsuranceInvoice.isPending} onClick={issueInsuranceInvoice} className="bg-emerald-600 hover:bg-emerald-700">
                  <Receipt className="ml-2 h-4 w-4" /> إصدار فاتورة تأمينية
                </Button>
              </div>
            </Card>

            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<User className="h-5 w-5" />} title="العميل والمركبة وأمر العمل" />
              <div className="grid gap-3 md:grid-cols-3">
                <InfoField label="Customer Code" value={displayCustomerCode(customer || { id: claim.customer_id })} mono />
                <InfoField label="اسم العميل" value={customer?.name || claim.vehicle_owner_name} />
                <InfoField label="الهاتف" value={customer?.phone || claim.vehicle_owner_phone} />
                <InfoField label="المركبة" value={vehicleName} />
                <InfoField label="رقم اللوحة" value={plate} mono />
                <InfoField label="VIN" value={vehicle?.vin_number || inlineVehicle.vin} mono />
                <InfoField label="رقم أمر العمل" value={workOrder?.order_number} mono />
                <InfoField label="حالة أمر العمل" value={workOrder?.status} />
                <InfoField label="موقع المركبة" value={[(claim as any).vehicle_location_section, (claim as any).vehicle_location_bay].filter(Boolean).join(" — ")} />
              </div>
            </Card>

            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<ClipboardCheck className="h-5 w-5" />} title="نموذج الفحص من خلال البحث" />
              <div className="grid gap-3 md:grid-cols-[1fr_auto]">
                <Input value={inspectionSearch} onChange={(e) => setInspectionSearch(e.target.value)} placeholder="ابحث برقم أمر العمل / اللوحة / المطالبة / العميل" />
                <Button onClick={() => setInspectionOpen(true)} style={{ background: PRIMARY, color: "white" }}>
                  <Search className="ml-2 h-4 w-4" /> إضافة نموذج فحص من البحث
                </Button>
              </div>
              <div className="mt-3 rounded-xl border bg-slate-50 p-3 text-sm text-muted-foreground">
                {claim.inspection_id ? `نموذج الفحص المرتبط: ${claim.inspection_id}` : "لا يوجد نموذج فحص مرتبط بعد."}
              </div>
            </Card>

            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<Paperclip className="h-5 w-5" />} title="المستندات" />
              <div className="grid gap-2">
                {[...(claim.documents || []), ...documentsRows.map((d: any) => ({ name: d.name || d.file_name, type: d.type || d.document_type, url: d.url || d.file_url }))].length ? (
                  [...(claim.documents || []), ...documentsRows.map((d: any) => ({ name: d.name || d.file_name, type: d.type || d.document_type, url: d.url || d.file_url }))].map((doc: any, index) => (
                    <div key={`${doc.url}-${index}`} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3">
                      <div className="flex items-center gap-2">
                        <FileText className="h-5 w-5 text-sky-700" />
                        <div>
                          <div className="text-sm font-bold">{safe(doc.name, "مستند")}</div>
                          <div className="text-xs text-muted-foreground">{safe(doc.type)}</div>
                        </div>
                      </div>
                      {doc.url && <Button size="sm" variant="outline" onClick={() => window.open(doc.url, "_blank")}>عرض</Button>}
                    </div>
                  ))
                ) : (
                  <div className="rounded-xl border border-dashed p-5 text-center text-sm text-muted-foreground">لا توجد مستندات محفوظة لهذه المطالبة.</div>
                )}
              </div>
            </Card>

            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<Mail className="h-5 w-5" />} title="مراسلات التأمين" />
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setEmailOpen(true)} style={{ background: GOLD, color: "white" }}>
                  <Mail className="ml-2 h-4 w-4" /> فتح مركز إرسال تقرير التأمين
                </Button>
                <Button variant="outline" onClick={saveEmailDraft}>حفظ مسودة متابعة LPO</Button>
              </div>
              <div className="mt-3 text-sm text-muted-foreground">
                إذا لم يكن مزود البريد مهيأ، يتم حفظ المسودة ولا يتم إرسال Email فعليًا.
              </div>
            </Card>
          </main>

          <aside className="space-y-4">
            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<Building2 className="h-5 w-5" />} title="ملخص جانبي" />
              <div className="space-y-3">
                <InfoField label="شركة التأمين" value={claim.insurance_company} />
                <InfoField label="رقم المطالبة" value={claim.claim_number} mono />
                <InfoField label="الموقع الحالي" value={[(claim as any).vehicle_location_section, (claim as any).vehicle_location_bay].filter(Boolean).join(" — ")} />
                <InfoField label="Paid Amount" value={omr(paid)} mono />
                <InfoField label="Remaining Amount" value={omr(remaining)} mono />
              </div>
            </Card>
            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<History className="h-5 w-5" />} title="سجل الإجراءات" />
              <div className="space-y-3">
                {timeline.length ? timeline.map((item: any) => (
                  <div key={item.id} className="border-r-4 border-sky-500 pr-3">
                    <div className="text-sm font-bold text-[#0f2f57]">{safe(item.action)}</div>
                    <div className="text-xs text-muted-foreground">{safe(new Date(item.created_at).toLocaleString("en-GB"))}</div>
                  </div>
                )) : (
                  <div className="text-sm text-muted-foreground">لا توجد أحداث مسجلة بعد.</div>
                )}
              </div>
            </Card>
            <Card className="rounded-2xl bg-white p-5">
              <SectionTitle icon={<Image className="h-5 w-5" />} title="صور المطالبة" />
              <div className="grid grid-cols-2 gap-2">
                {(claim.damage_photos || []).slice(0, 6).map((url, index) => (
                  <button key={url} className="overflow-hidden rounded-xl border" onClick={() => window.open(url, "_blank")}>
                    <img src={url} alt={`damage-${index + 1}`} className="h-24 w-full object-cover" />
                  </button>
                ))}
              </div>
              {!claim.damage_photos?.length && <div className="text-sm text-muted-foreground">لا توجد صور مرفوعة.</div>}
            </Card>
          </aside>
        </div>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-white/95 px-4 py-3 shadow-lg backdrop-blur">
        <div className="mx-auto flex max-w-[1560px] flex-wrap items-center justify-between gap-2">
          <div className="text-xs font-bold text-muted-foreground">Claim {safe(claim.claim_number)} — {statusText}</div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setEmailOpen(true)}><Mail className="ml-2 h-4 w-4" /> بريد التأمين</Button>
            <Button variant="outline" onClick={() => window.print()}><Printer className="ml-2 h-4 w-4" /> طباعة</Button>
            <Button style={{ background: PRIMARY, color: "white" }} onClick={() => navigate("/insurance/claims")}>رجوع للقائمة</Button>
          </div>
        </div>
      </div>

      <Dialog open={locationOpen} onOpenChange={setLocationOpen}>
        <DialogContent dir="rtl" className="max-w-2xl">
          <DialogHeader><DialogTitle>تحديث موقع المركبة</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <Label>القسم الحالي</Label>
              <Select value={locationSection || (claim as any).vehicle_location_section || ""} onValueChange={setLocationSection}>
                <SelectTrigger><SelectValue placeholder="اختر الموقع" /></SelectTrigger>
                <SelectContent>
                  {LOCATION_OPTIONS.map((loc) => <SelectItem key={loc} value={loc}>{loc}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>رقم الموقف / العنبر</Label>
              <Input value={locationBay || (claim as any).vehicle_location_bay || ""} onChange={(e) => setLocationBay(e.target.value)} placeholder="مثال: D-03" />
            </div>
            <div className="md:col-span-2">
              <Label>ملاحظة الموقع</Label>
              <Textarea value={locationNote || (claim as any).vehicle_location_note || ""} onChange={(e) => setLocationNote(e.target.value)} />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setLocationOpen(false)}>إلغاء</Button>
            <Button onClick={saveVehicleLocation} style={{ background: PRIMARY, color: "white" }}>حفظ الموقع</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={inspectionOpen} onOpenChange={setInspectionOpen}>
        <DialogContent dir="rtl" className="max-w-4xl">
          <DialogHeader><DialogTitle>نموذج الفحص من خلال البحث</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <Input value={inspectionSearch} onChange={(e) => setInspectionSearch(e.target.value)} placeholder="رقم أمر العمل / اللوحة / المطالبة / العميل" />
            <Button style={{ background: PRIMARY, color: "white" }} onClick={() => toast.info("البحث المتقدم سيربط بسجلات الفحص الموجودة. لا توجد نتيجة محفوظة تلقائيًا بدون اختيار.")}>
              <Search className="ml-2 h-4 w-4" /> بحث
            </Button>
          </div>
          <div className="rounded-xl border bg-slate-50 p-4 text-sm">
            <strong>{safe(workOrder?.order_number)} — {safe(vehicleName)}</strong>
            <div className="mt-1 text-muted-foreground">Claim: {safe(claim.claim_number)} — Plate: {safe(plate)} — Customer: {safe(customer?.name || claim.vehicle_owner_name)}</div>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <InfoField label="رقم المطالبة" value={claim.claim_number} mono />
            <InfoField label="رقم أمر العمل" value={workOrder?.order_number} mono />
            <InfoField label="تاريخ الفحص" value={dateOnly((claim as any).inspection_at) || "—"} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setInspectionOpen(false)}>إلغاء</Button>
            <Button onClick={async () => {
              await insertTimeline(claim, "inspection_report_link_requested", { search: inspectionSearch || claim.claim_number });
              await queryClient.invalidateQueries({ queryKey: ["claim_audit_logs", currentId] });
              setInspectionOpen(false);
              toast.success("تم تسجيل طلب ربط/إنشاء نموذج الفحص في السجل");
            }} style={{ background: PRIMARY, color: "white" }}>حفظ وربط بالمطالبة</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent dir="rtl" className="max-w-4xl">
          <DialogHeader><DialogTitle>إرسال تقرير التأمين بالبريد</DialogTitle></DialogHeader>
          <div className="grid gap-3 md:grid-cols-3">
            <div>
              <Label>القالب</Label>
              <Select value={emailTemplate} onValueChange={setEmailTemplate}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{EMAIL_TEMPLATES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>إلى</Label>
              <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="insurance@example.com" />
            </div>
            <div>
              <Label>CC</Label>
              <Input value={emailCc} onChange={(e) => setEmailCc(e.target.value)} />
            </div>
          </div>
          <div>
            <Label>عنوان البريد</Label>
            <Input value={emailSubject} readOnly dir="ltr" />
          </div>
          <div>
            <Label>نص الرسالة</Label>
            <Textarea className="min-h-40" value={emailBody || `Dear Sir,\n\nPlease review claim ${claim.claim_number} for ${safe(vehicleName)} plate ${safe(plate)}.\n\nRegards,`} onChange={(e) => setEmailBody(e.target.value)} />
          </div>
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm font-bold text-amber-800">
            إذا لم يكن Email Provider مهيأ، لن يتم الإرسال الفعلي. سيتم حفظ المسودة في سجل المطالبة فقط.
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setEmailOpen(false)}>إلغاء</Button>
            <Button variant="secondary" onClick={saveEmailDraft}>حفظ كمسودة</Button>
            <Button onClick={() => toast.error("Email provider is not configured")} style={{ background: PRIMARY, color: "white" }}>
              <Phone className="ml-2 h-4 w-4" /> إرسال Email
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
