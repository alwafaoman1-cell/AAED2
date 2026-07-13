import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Plus, Search, Trash2, ArrowLeftRight, FileText, Edit3, CheckCircle2, Filter, Send, Printer, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ResponsiveDialog, ResponsiveDialogHeader, ResponsiveDialogTitle, ResponsiveDialogDescription } from "@/components/ui/responsive-dialog";
import StatCard from "@/components/StatCard";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import {
  useInsuranceEstimates,
  useCreateInsuranceEstimate,
  useUpdateInsuranceEstimate,
  useDeleteInsuranceEstimate,
  useConvertEstimateToClaim,
  type IndependentEstimate,
  type UplItem,
} from "@/hooks/useInsuranceEstimates";
import { useInsuranceCompanies } from "@/hooks/useInsuranceCompanies";
import { getInsuranceEstimateHtml } from "@/lib/pdfGenerator";
import { openSanitizedPdfWindow, openAndPrintWindow } from "@/lib/safePdfWindow";
import { generatePdfFromHtml } from "@/lib/htmlToPdf";
import PdfPreviewDialog from "@/components/PdfPreviewDialog";
import { toast } from "sonner";
import AiExtractButton from "@/components/ai/AiExtractButton";
import { findExistingVehicle } from "@/lib/vehicleIdentity";
import { supabase } from "@/integrations/supabase/client";

const STATUS_LABEL: Record<string, string> = {
  draft: "مسودة",
  sent: "مرسلة",
  approved: "معتمدة",
  converted: "محوّلة لمطالبة",
  cancelled: "ملغاة",
};
const STATUS_COLOR: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  sent: "bg-warning/15 text-warning",
  approved: "bg-success/15 text-success",
  converted: "bg-info/15 text-info",
  cancelled: "bg-destructive/15 text-destructive",
};

const emptyForm: Partial<IndependentEstimate> = {
  status: "draft",
  estimation_type: "lump_sum",
  lump_sum_amount: 0,
  upl_items: [],
  deductible_amount: 0,
  damage_photos: [],
};

export default function InsuranceIndependentEstimates() {
  const navigate = useNavigate();
  const { data: estimates = [], isLoading } = useInsuranceEstimates();
  const { data: companies = [] } = useInsuranceCompanies();
  const createMut = useCreateInsuranceEstimate();
  const updateMut = useUpdateInsuranceEstimate();
  const deleteMut = useDeleteInsuranceEstimate();
  const convertMut = useConvertEstimateToClaim();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IndependentEstimate | null>(null);
  const [form, setForm] = useState<Partial<IndependentEstimate>>(emptyForm);
  const [previewEstimate, setPreviewEstimate] = useState<IndependentEstimate | null>(null);
  const [sp, setSp] = useSearchParams();
  const [vehicleLookupPlate, setVehicleLookupPlate] = useState("");
  const [vehicleLookupBusy, setVehicleLookupBusy] = useState(false);

  useEffect(() => {
    const searchParam = sp.get("search");
    if (searchParam) setSearch(searchParam);
    if (sp.get("new") === "1") {
      setEditing(null);
      setForm(emptyForm);
      setDialogOpen(true);
      sp.delete("new");
      setSp(sp, { replace: true });
    }
  }, [sp, setSp]);

  const filtered = useMemo(() => {
    return estimates.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        e.estimate_number.toLowerCase().includes(s) ||
        (e.customer_name || "").toLowerCase().includes(s) ||
        (e.insurance_company || "").toLowerCase().includes(s) ||
        (e.vehicle_plate || "").toLowerCase().includes(s)
      );
    });
  }, [estimates, search, statusFilter]);

  const stats = useMemo(() => {
    const draft = estimates.filter((e) => e.status === "draft").length;
    const converted = estimates.filter((e) => e.status === "converted").length;
    const total = estimates.reduce((s, e) => {
      const v =
        e.estimation_type === "upl"
          ? (e.upl_items || []).reduce((a, it) => a + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)
          : Number(e.lump_sum_amount || 0);
      return s + v;
    }, 0);
    return { count: estimates.length, draft, converted, total };
  }, [estimates]);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setVehicleLookupPlate("");
    setDialogOpen(true);
  }
  function openEdit(e: IndependentEstimate) {
    setEditing(e);
    setForm({ ...e });
    setVehicleLookupPlate(e.vehicle_plate || "");
    setDialogOpen(true);
  }

  async function fillFromSavedVehicle() {
    const plate = (vehicleLookupPlate || form.vehicle_plate || "").trim();
    if (!plate) {
      toast.error("أدخل رقم اللوحة أولًا");
      return;
    }
    setVehicleLookupBusy(true);
    try {
      let match = await findExistingVehicle({ plate });
      if (!match) {
        const digits = plate.replace(/[^\d]/g, "");
        if (digits) {
          const { data: tenant } = await supabase.rpc("get_user_tenant_id");
          const { data: row } = await supabase
            .from("vehicles" as any)
            .select("id,customer_id,plate_number,plate_letters,plate_country,brand,model,year,color,vin,vin_number,customers(name,phone)")
            .eq("tenant_id", tenant as string)
            .eq("plate_number", digits)
            .limit(1)
            .maybeSingle();
          const vehicleRow = row as any;
          if (vehicleRow) {
            match = {
              id: vehicleRow.id,
              customer_id: vehicleRow.customer_id || null,
              plate_number: vehicleRow.plate_number || null,
              plate_letters: vehicleRow.plate_letters || null,
              plate_country: vehicleRow.plate_country || null,
              brand: vehicleRow.brand || null,
              model: vehicleRow.model || null,
              year: vehicleRow.year ?? null,
              color: vehicleRow.color || null,
              vin: vehicleRow.vin || null,
              vin_number: vehicleRow.vin_number || null,
              customer_name: vehicleRow.customers?.name || null,
              customer_phone: vehicleRow.customers?.phone || null,
              source: "plate",
            };
          }
        }
      }
      if (!match) {
        toast.error("لم يتم العثور على مركبة محفوظة بهذا الرقم");
        return;
      }
      const displayPlate = [match.plate_letters, match.plate_number].filter(Boolean).join(" ").trim() || plate;
      setForm((prev) => ({
        ...prev,
        customer_name: match.customer_name || prev.customer_name || "",
        customer_phone: match.customer_phone || prev.customer_phone || "",
        vehicle_plate: displayPlate,
        vehicle_make: match.brand || prev.vehicle_make || "",
        vehicle_model: match.model || prev.vehicle_model || "",
        vehicle_year: match.year ?? prev.vehicle_year ?? null,
        vehicle_color: match.color || prev.vehicle_color || "",
      }));
      setVehicleLookupPlate(displayPlate);
      toast.success("تم تعبئة بيانات المركبة من السجل المحفوظ");
    } catch (e: any) {
      toast.error(e?.message || "فشل جلب بيانات المركبة");
    } finally {
      setVehicleLookupBusy(false);
    }
  }

  function addUplItem() {
    const items = [...((form.upl_items as UplItem[]) || []), { description: "", quantity: 1, unit_price: 0 }];
    setForm({ ...form, upl_items: items });
  }
  function updateUpl(idx: number, patch: Partial<UplItem>) {
    const items = [...((form.upl_items as UplItem[]) || [])];
    items[idx] = { ...items[idx], ...patch };
    setForm({ ...form, upl_items: items });
  }
  function removeUpl(idx: number) {
    const items = [...((form.upl_items as UplItem[]) || [])];
    items.splice(idx, 1);
    setForm({ ...form, upl_items: items });
  }

  async function handleSave() {
    try {
      if (editing) {
        await updateMut.mutateAsync({ id: editing.id, patch: form });
        toast.success("تم التحديث");
      } else {
        await createMut.mutateAsync(form);
      }
      setDialogOpen(false);
    } catch {}
  }

  function buildEstimateHtml(e: IndependentEstimate) {
    const items =
      e.estimation_type === "upl" && (e.upl_items || []).length
        ? (e.upl_items || []).map((it) => ({
            description: it.description || "—",
            quantity: Number(it.quantity || 0),
            unitPrice: Number(it.unit_price || 0),
            discount: 0,
            tax: 0,
          }))
        : [{
            description: "تقدير إجمالي للإصلاح",
            quantity: 1,
            unitPrice: Number(e.lump_sum_amount || 0),
            discount: 0,
            tax: 0,
          }];
    const subtotal = items.reduce((s, it) => s + it.quantity * it.unitPrice, 0);
    return getInsuranceEstimateHtml({
      docType: "quote",
      template: "default",
      number: e.estimate_number,
      issueDate: new Date(e.created_at).toLocaleDateString("en-GB"),
      customerName: e.customer_name || "—",
      customFields: [],
      items,
      subtotal,
      discountTotal: 0,
      taxTotal: 0,
      total: subtotal,
      notes: e.notes || undefined,
      insuranceCompany: e.insurance_company || "—",
      claimNumber: e.claim_number || e.estimate_number,
      vehiclePlate: e.vehicle_plate || undefined,
      vehicleInfo: [e.vehicle_make, e.vehicle_model, e.vehicle_year].filter(Boolean).join(" "),
      incidentDate: e.incident_date || undefined,
      incidentDescription: e.incident_description || undefined,
      customTerms: e.terms_text || undefined,
    });
  }

  function handlePrint(e: IndependentEstimate) {
    const html = buildEstimateHtml(e);
    const win = openAndPrintWindow(html);
    if (!win) {
      toast.error("المتصفح منع فتح النافذة. اضغط 'تحميل PDF' بدلاً من ذلك.");
    }
  }

  async function handleDownloadPdf(e: IndependentEstimate) {
    try {
      toast.loading("جاري تحضير PDF...", { id: "pdf-est" });
      await generatePdfFromHtml({
        htmlContent: buildEstimateHtml(e),
        fileName: `Estimate-${e.estimate_number}`,
      });
      toast.success("تم تحميل PDF", { id: "pdf-est" });
    } catch (err: any) {
      toast.error(err?.message || "فشل توليد PDF", { id: "pdf-est" });
    }
  }

  async function handleConvert(e: IndependentEstimate) {
    if (e.status === "converted") {
      toast.error("هذا التقدير محوّل مسبقاً");
      if (e.converted_claim_id) navigate(`/insurance/${e.converted_claim_id}`);
      return;
    }
    const claim = await convertMut.mutateAsync(e);
    if (claim?.id) navigate(`/insurance/${claim.id}`);
  }

  return (
    <div className="space-y-4 md:space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
            <FileText className="text-primary" /> التقديرات المستقلة
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            تقديرات تأمين أولية يمكن تحويلها إلى مطالبة رسمية بضغطة واحدة
          </p>
        </div>
        <Button onClick={openCreate} className="gap-2">
          <Plus size={16} /> تقدير جديد
        </Button>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard title="إجمالي التقديرات" value={stats.count} icon={FileText} variant="info" />
        <StatCard title="مسودات" value={stats.draft} icon={Edit3} variant="warning" />
        <StatCard title="محوّلة لمطالبات" value={stats.converted} icon={CheckCircle2} variant="success" />
        <StatCard title="إجمالي المبلغ" value={`${stats.total.toLocaleString()} OMR`} icon={ArrowLeftRight} variant="gold" />
      </div>

      {/* Filters */}
      <Card className="p-3 flex flex-col md:flex-row gap-2">
        <div className="relative flex-1">
          <Search size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="بحث برقم التقدير، العميل، الشركة، اللوحة..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pr-10"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="md:w-48">
            <Filter size={14} className="ml-1" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">جميع الحالات</SelectItem>
            {Object.entries(STATUS_LABEL).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Card>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-8 text-muted-foreground">جاري التحميل...</div>
      ) : filtered.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          لا توجد تقديرات. ابدأ بإنشاء تقدير جديد.
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((e) => {
            const total =
              e.estimation_type === "upl"
                ? (e.upl_items || []).reduce((a, it) => a + Number(it.quantity || 0) * Number(it.unit_price || 0), 0)
                : Number(e.lump_sum_amount || 0);
            return (
              <Card key={e.id} className="p-4 hover:border-primary/40 transition cursor-pointer" onClick={() => setPreviewEstimate(e)}>
                <div className="flex items-start justify-between mb-2">
                  <span className="font-mono text-xs text-primary" dir="ltr">{e.estimate_number}</span>
                  <Badge className={`text-[10px] ${STATUS_COLOR[e.status]}`}>{STATUS_LABEL[e.status]}</Badge>
                </div>
                <div className="text-sm font-semibold truncate">{e.customer_name || "—"}</div>
                <div className="text-xs text-muted-foreground truncate">{e.insurance_company || "بدون شركة"}</div>
                <div className="text-xs text-muted-foreground truncate mt-1">
                  {e.vehicle_make} {e.vehicle_model} — {e.vehicle_plate}
                </div>
                <div className="text-sm font-mono mt-2" dir="ltr">{total.toLocaleString()} OMR</div>

                <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-border" onClick={(ev) => ev.stopPropagation()}>
                  <Button size="sm" variant="outline" onClick={() => openEdit(e)} className="gap-1 h-7 text-xs">
                    <Edit3 size={12} /> تعديل
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handlePrint(e)} className="gap-1 h-7 text-xs">
                    <Printer size={12} /> طباعة
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => handleDownloadPdf(e)} className="gap-1 h-7 text-xs">
                    <Download size={12} /> PDF
                  </Button>
                  {e.status !== "converted" && (
                    <Button
                      size="sm"
                      onClick={() => handleConvert(e)}
                      disabled={convertMut.isPending}
                      className="gap-1 h-7 text-xs"
                    >
                      <ArrowLeftRight size={12} /> تحويل لمطالبة
                    </Button>
                  )}
                  {e.status === "converted" && e.converted_claim_id && (
                    <Button size="sm" variant="secondary" onClick={() => navigate(`/insurance/${e.converted_claim_id}`)} className="gap-1 h-7 text-xs">
                      <Send size={12} /> فتح المطالبة
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (confirm("حذف هذا التقدير؟")) deleteMut.mutate(e.id);
                    }}
                    className="gap-1 h-7 text-xs text-destructive hover:text-destructive"
                  >
                    <Trash2 size={12} />
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create / Edit dialog */}
      <ResponsiveDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        className="max-w-3xl"
      >
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>{editing ? `تعديل ${editing.estimate_number}` : "تقدير مستقل جديد"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>بيانات تقدير أولية بدون مطالبة — يمكن تحويله لاحقاً</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">

          {/* AI auto-fill from document */}
          <div className="rounded-lg border-2 border-dashed border-primary/40 bg-primary/5 p-3 flex flex-col md:flex-row md:items-center justify-between gap-2">
            <div className="text-xs md:text-sm">
              <div className="font-semibold text-foreground">📄 تعبئة تلقائية من مستند</div>
              <div className="text-muted-foreground">ارفع صورة/PDF لتقدير أو تقرير حادث وسنملأ الحقول تلقائياً</div>
            </div>
            <AiExtractButton
              schema="insurance_claim"
              label="رفع مستند"
              onExtracted={(d) => {
                setForm((prev) => ({
                  ...prev,
                  customer_name: d.owner_name || prev.customer_name,
                  customer_phone: d.owner_phone || prev.customer_phone,
                  insurance_company: d.insurance_company || prev.insurance_company,
                  claim_number: d.claim_number || prev.claim_number,
                  vehicle_plate: d.plate || prev.vehicle_plate,
                  vehicle_make: d.make || prev.vehicle_make,
                  vehicle_model: d.model || prev.vehicle_model,
                  vehicle_year: d.year ? Number(d.year) : prev.vehicle_year,
                  vehicle_color: d.color || prev.vehicle_color,
                  incident_date: d.incident_date || prev.incident_date,
                  incident_description: d.damage_description || prev.incident_description,
                  lump_sum_amount: d.estimated_cost ? Number(String(d.estimated_cost).replace(/[^\d.]/g, "")) : prev.lump_sum_amount,
                }));
              }}
            />
          </div>


          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>اسم العميل</Label>
              <Input value={form.customer_name || ""} onChange={(e) => setForm({ ...form, customer_name: e.target.value })} placeholder="اختياري" />
            </div>
            <div>
              <Label>هاتف العميل</Label>
              <Input value={form.customer_phone || ""} onChange={(e) => setForm({ ...form, customer_phone: e.target.value })} />
            </div>
            <div>
              <Label>شركة التأمين</Label>
              <Select
                value={form.insurance_company_id || "none"}
                onValueChange={(v) => {
                  if (v === "none") setForm({ ...form, insurance_company_id: null, insurance_company: "" });
                  else {
                    const co = companies.find((c) => c.id === v);
                    setForm({ ...form, insurance_company_id: v, insurance_company: co?.name || "" });
                  }
                }}
              >
                <SelectTrigger><SelectValue placeholder="اختر شركة" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— بدون —</SelectItem>
                  {companies.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>تاريخ الحادث</Label>
              <Input type="date" value={form.incident_date || ""} onChange={(e) => setForm({ ...form, incident_date: e.target.value })} />
            </div>
            <div>
              <Label>رقم المطالبة / Claim No</Label>
              <Input
                value={form.claim_number || ""}
                onChange={(e) => setForm({ ...form, claim_number: e.target.value })}
                placeholder="اختياري — رقم مرجعي من شركة التأمين"
                dir="ltr"
              />
            </div>
          </div>

          <div className="rounded-lg border border-border bg-secondary/20 p-3 space-y-2">
            <div className="text-sm font-semibold">تعبئة من مركبة محفوظة</div>
            <div className="flex flex-col md:flex-row gap-2">
              <Input
                value={vehicleLookupPlate}
                onChange={(e) => setVehicleLookupPlate(e.target.value)}
                placeholder="أدخل رقم اللوحة مثل 5651 أو AA 5651"
                dir="ltr"
              />
              <Button
                type="button"
                variant="outline"
                onClick={fillFromSavedVehicle}
                disabled={vehicleLookupBusy}
                className="gap-2"
              >
                <Search size={14} />
                {vehicleLookupBusy ? "جاري البحث..." : "تعبئة من اللوحة"}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              يمكن ترك الحقول يدويًا كما هي، أو تعبئتها تلقائيًا من السجل المحفوظ للمركبة.
            </p>
          </div>

          <VehicleMakeModelPicker
            make={form.vehicle_make || ""}
            model={form.vehicle_model || ""}
            plate={form.vehicle_plate || ""}
            year={form.vehicle_year ? String(form.vehicle_year) : ""}
            color={form.vehicle_color || ""}
            onChange={(patch) =>
              setForm({
                ...form,
                ...(patch.make !== undefined ? { vehicle_make: patch.make } : {}),
                ...(patch.model !== undefined ? { vehicle_model: patch.model } : {}),
                ...(patch.plate !== undefined ? { vehicle_plate: patch.plate } : {}),
                ...(patch.color !== undefined ? { vehicle_color: patch.color } : {}),
                ...(patch.year !== undefined
                  ? { vehicle_year: patch.year ? Number(patch.year) : null }
                  : {}),
              })
            }
          />

          <div>
            <Label>نوع التقدير</Label>
            <Select
              value={form.estimation_type || "lump_sum"}
              onValueChange={(v: any) => setForm({ ...form, estimation_type: v })}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lump_sum">إجمالي (Lump Sum)</SelectItem>
                <SelectItem value="upl">بنود تفصيلية (UPL)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {form.estimation_type === "upl" ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>البنود</Label>
                <Button type="button" size="sm" variant="outline" onClick={addUplItem} className="gap-1 h-7">
                  <Plus size={12} /> بند
                </Button>
              </div>
              {((form.upl_items as UplItem[]) || []).map((it, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <Input
                    className="col-span-6"
                    placeholder="الوصف"
                    value={it.description}
                    onChange={(e) => updateUpl(idx, { description: e.target.value })}
                  />
                  <Input
                    className="col-span-2"
                    type="number"
                    placeholder="الكمية"
                    value={it.quantity}
                    onChange={(e) => updateUpl(idx, { quantity: Number(e.target.value) })}
                  />
                  <Input
                    className="col-span-3"
                    type="number"
                    placeholder="السعر"
                    value={it.unit_price}
                    onChange={(e) => updateUpl(idx, { unit_price: Number(e.target.value) })}
                  />
                  <Button type="button" size="icon" variant="ghost" onClick={() => removeUpl(idx)} className="col-span-1 h-9 text-destructive">
                    <Trash2 size={14} />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <div>
              <Label>المبلغ الإجمالي (OMR)</Label>
              <Input
                type="number"
                step="0.001"
                value={form.lump_sum_amount || 0}
                onChange={(e) => setForm({ ...form, lump_sum_amount: Number(e.target.value) })}
              />
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>التحمل (Deductible)</Label>
              <Input
                type="number"
                step="0.001"
                value={form.deductible_amount || 0}
                onChange={(e) => setForm({ ...form, deductible_amount: Number(e.target.value) })}
              />
            </div>
            <div>
              <Label>الحالة</Label>
              <Select value={form.status || "draft"} onValueChange={(v: any) => setForm({ ...form, status: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(STATUS_LABEL)
                    .filter(([k]) => k !== "converted")
                    .map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>وصف الحادث</Label>
            <Textarea
              value={form.incident_description || ""}
              onChange={(e) => setForm({ ...form, incident_description: e.target.value })}
              rows={2}
            />
          </div>
          <div>
            <Label>الشروط (Terms) — كل سطر يصبح بنداً منفصلاً</Label>
            <Textarea
              value={form.terms_text ?? ""}
              onChange={(e) => setForm({ ...form, terms_text: e.target.value })}
              rows={4}
              placeholder={"اتركه فارغاً لاستخدام الشروط الافتراضية، أو اكتب شروطك:\nهذا التقدير ساري 30 يوماً\nقد تتغير الأسعار حسب توفر القطع\nيبدأ العمل بعد اعتماد التأمين"}
            />
          </div>
          <div>
            <Label>ملاحظات</Label>
            <Textarea value={form.notes || ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
          </div>

          <div className="flex gap-2 justify-end pt-3 border-t border-border">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>إلغاء</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending}>
              {editing ? "حفظ التعديلات" : "حفظ التقدير"}
            </Button>
          </div>
        </div>
      </ResponsiveDialog>

      {previewEstimate && (
        <PdfPreviewDialog
          open={!!previewEstimate}
          onOpenChange={(o) => !o && setPreviewEstimate(null)}
          htmlContent={buildEstimateHtml(previewEstimate)}
          title={`تقدير ${previewEstimate.estimate_number}`}
          fileName={`Estimate-${previewEstimate.estimate_number}`}
        />
      )}
    </div>
  );
}
