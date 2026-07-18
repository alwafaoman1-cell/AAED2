import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, Upload, X, Loader2, PackageCheck, FileSignature, FileCheck2 } from "lucide-react";
import { toast } from "sonner";
import VehicleDeliveryReceiptDialog from "@/components/workorders/VehicleDeliveryReceiptDialog";
import type { WorkOrder } from "@/lib/workOrdersStore";
import { getWorkOrderById, refreshWorkOrdersFromCloud } from "@/lib/workOrdersStore";
import AiExtractButton from "@/components/ai/AiExtractButton";

interface Props {
  claimId: string;
  workOrderId?: string;
  vehicleId?: string | null;
  initial?: {
    delivery_photos?: string[];
    satisfaction_photos?: string[];
    receiver_id_photo?: string | null;
    receiver_name?: string | null;
    receiver_id_number?: string | null;
    delivered_at?: string | null;
    delivery_notes?: string | null;
  };
  onSaved?: () => void;
}

type SlotKey = "delivery_photos" | "satisfaction_photos" | "receiver_id_photo";

const SUPA_STATUS_TO_AR: Record<string, string> = {
  received: "تحت الفحص",
  diagnosing: "تحت الفحص",
  awaiting_parts: "بانتظار قطع الغيار",
  in_progress: "تحت الإصلاح",
  quality_check: "ضبط الجودة",
  ready: "جاهز للتسليم",
  delivered: "تم التسليم",
  closed: "مغلق",
};

async function insertClaimAuditWithVehicle(payload: Record<string, unknown>) {
  const { error } = await supabase.from("claim_audit_logs").insert(payload as any);
  if (!error) return;
  const message = String(error.message || "");
  if ("vehicle_id" in payload && /vehicle_id|schema cache|column/i.test(message)) {
    const { vehicle_id: _vehicleId, ...fallback } = payload;
    const retry = await supabase.from("claim_audit_logs").insert(fallback as any);
    if (retry.error) throw retry.error;
    return;
  }
  throw error;
}

export default function ClaimDeliverySection({ claimId, workOrderId, vehicleId, initial, onSaved }: Props) {
  const [deliveryPhotos, setDeliveryPhotos] = useState<string[]>(initial?.delivery_photos ?? []);
  const [satisfactionPhotos, setSatisfactionPhotos] = useState<string[]>(initial?.satisfaction_photos ?? []);
  const [receiverIdPhoto, setReceiverIdPhoto] = useState<string | null>(initial?.receiver_id_photo ?? null);
  const [receiverName, setReceiverName] = useState(initial?.receiver_name ?? "");
  const [receiverIdNumber, setReceiverIdNumber] = useState(initial?.receiver_id_number ?? "");
  const [notes, setNotes] = useState(initial?.delivery_notes ?? "");
  const [deliveryDate, setDeliveryDate] = useState<string>(
    initial?.delivered_at ? new Date(initial.delivered_at).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [uploading, setUploading] = useState<SlotKey | null>(null);
  const [saving, setSaving] = useState(false);

  const [receiptOpen, setReceiptOpen] = useState(false);
  const [woForDialog, setWoForDialog] = useState<WorkOrder | null>(null);
  const [loadingWo, setLoadingWo] = useState(false);

  /** Fetch linked job order from Supabase and adapt to local WorkOrder shape. */
  async function ensureWorkOrder(): Promise<WorkOrder | null> {
    if (!workOrderId) {
      toast.error("لا يوجد أمر عمل مرتبط بهذه المطالبة");
      return null;
    }
    const local = getWorkOrderById(workOrderId);
    if (local) return local;
    setLoadingWo(true);
    try {
      const { data, error } = await supabase
        .from("job_orders")
        .select(`
          id, order_number, status, description, diagnosis,
          labor_cost, parts_cost, final_total, created_at,
          insurance_claim_number, insurance_approved,
          customer:customers(name, phone),
          vehicle:vehicles(brand, model, plate_number, year, color, vin_number)
        `)
        .eq("id", workOrderId)
        .maybeSingle();
      if (error || !data) {
        toast.error("تعذر تحميل أمر العمل");
        return null;
      }
      const v: any = (data as any).vehicle || {};
      const c: any = (data as any).customer || {};
      const labor = Number((data as any).labor_cost) || 0;
      const parts = Number((data as any).parts_cost) || 0;
      const total = Number((data as any).final_total) || labor + parts;
      const adapted: WorkOrder = {
        id: (data as any).id,
        customer: c.name || "—",
        phone: c.phone || "",
        plate: v.plate_number || "—",
        vehicleType: v.brand || "",
        model: v.model || "",
        year: v.year ? String(v.year) : "",
        vin: v.vin_number || "",
        color: v.color || "",
        mileage: "",
        insurance: (data as any).insurance_approved ? "تأمين" : "-",
        claimNumber: (data as any).insurance_claim_number || "-",
        entryDate: ((data as any).created_at || "").slice(0, 10),
        technician: "",
        serviceType: (data as any).insurance_claim_number ? "حادث" : "صيانة",
        status: SUPA_STATUS_TO_AR[(data as any).status] || "تحت الفحص",
        totalCost: total,
        laborCost: labor,
        partsCost: parts,
        diagnosis: (data as any).diagnosis || (data as any).description || "",
        description: (data as any).description || "",
        photos: [],
        partsNeeded: [],
        displayNumber: (data as any).order_number || undefined,
      };
      await refreshWorkOrdersFromCloud().catch(() => {});
      return adapted;
    } finally {
      setLoadingWo(false);
    }
  }

  async function openReceiptDialog() {
    const wo = await ensureWorkOrder();
    if (!wo) return;
    setWoForDialog(wo);
    setReceiptOpen(true);
  }

  const upload = async (file: File, category: "delivery" | "satisfaction" | "receiver_id"): Promise<string | null> => {
    const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
    let toUpload: File = file;
    let ext = (file.name.split(".").pop() || "bin").toLowerCase();
    if (!isPdf && file.type.startsWith("image/")) {
      const { convertImageToWebp } = await import("@/lib/imageToWebp");
      toUpload = await convertImageToWebp(file);
      ext = toUpload.name.split(".").pop() || "webp";
    }
    const path = `claims/${claimId}/${category}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
    const { error } = await supabase.storage.from("insurance-docs").upload(path, toUpload, { contentType: toUpload.type });
    if (error) {
      toast.error("فشل الرفع: " + error.message);
      return null;
    }
    const { data: tenant } = await supabase.rpc("get_user_tenant_id");
    if (tenant) {
      await insertClaimAuditWithVehicle({
        tenant_id: tenant as string,
        claim_id: claimId,
        vehicle_id: vehicleId || null,
        action: "upload_photo",
        category,
        file_path: path,
        details: { name: file.name, size: file.size, kind: isPdf ? "pdf" : "image" },
      } as any);
    }
    const { data: signed } = await supabase.storage.from("insurance-docs").createSignedUrl(path, 60 * 60 * 24 * 7);
    return signed?.signedUrl ?? "";
  };

  const handleMulti = async (slot: "delivery_photos" | "satisfaction_photos", files: FileList | null) => {
    if (!files?.length) return;
    setUploading(slot);
    const category = slot === "delivery_photos" ? "delivery" : "satisfaction";
    const urls: string[] = [];
    for (const f of Array.from(files)) {
      const u = await upload(f, category);
      if (u) urls.push(u);
    }
    if (slot === "delivery_photos") setDeliveryPhotos((p) => [...p, ...urls]);
    else setSatisfactionPhotos((p) => [...p, ...urls]);
    setUploading(null);
  };

  const handleSingle = async (file: File | undefined) => {
    if (!file) return;
    setUploading("receiver_id_photo");
    const u = await upload(file, "receiver_id");
    if (u) setReceiverIdPhoto(u);
    setUploading(null);
  };

  async function handleSave(markDelivered: boolean) {
    setSaving(true);
    // Use the chosen delivery date (at noon local) when marking delivered, otherwise persist date if it was changed.
    const deliveredAtIso = (() => {
      if (!deliveryDate) return null;
      const d = new Date(deliveryDate + "T12:00:00");
      return isNaN(d.getTime()) ? null : d.toISOString();
    })();
    const payload: Record<string, unknown> = {
      delivery_photos: deliveryPhotos,
      satisfaction_photos: satisfactionPhotos,
      receiver_id_photo: receiverIdPhoto,
      receiver_name: receiverName || null,
      receiver_id_number: receiverIdNumber || null,
      delivery_notes: notes || null,
    };
    if (markDelivered) {
      payload.delivered_at = deliveredAtIso ?? new Date().toISOString();
    } else if (initial?.delivered_at && deliveredAtIso) {
      // allow editing the existing delivered_at without re-marking
      payload.delivered_at = deliveredAtIso;
    }
    const { error } = await supabase
      .from("insurance_claims")
      .update(payload as never)
      .eq("id", claimId);
    setSaving(false);
    if (error) {
      toast.error("فشل الحفظ: " + error.message);
      return;
    }
    const { data: tenant } = await supabase.rpc("get_user_tenant_id");
    if (tenant) {
      await insertClaimAuditWithVehicle({
        tenant_id: tenant as string,
        claim_id: claimId,
        vehicle_id: vehicleId || null,
        action: markDelivered ? "delivery_confirmed" : "delivery_saved",
        category: "delivery",
        details: {
          delivered_at: payload.delivered_at || deliveredAtIso,
          receiver_name: receiverName || null,
          receiver_id_number: receiverIdNumber || null,
          delivery_photos_count: deliveryPhotos.length,
          satisfaction_photos_count: satisfactionPhotos.length,
          has_receiver_id: !!receiverIdPhoto,
        },
      } as any);
    }
    toast.success(markDelivered ? "تم تسجيل التسليم" : "تم حفظ بيانات التسليم");
    onSaved?.();
  }

  const isPdfUrl = (u: string) => /\.pdf(\?|$)/i.test(u);
  const PhotoGrid = ({ urls, onRemove }: { urls: string[]; onRemove: (i: number) => void }) => (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-2 mt-2">
      {urls.map((u, i) => (
        <div key={i} className="relative group aspect-square rounded-lg overflow-hidden border border-border bg-muted">
          {isPdfUrl(u) ? (
            <a href={u} target="_blank" rel="noreferrer" className="w-full h-full flex flex-col items-center justify-center text-xs gap-1 p-2 text-center">
              <span className="text-2xl">📄</span>
              <span className="truncate w-full">PDF</span>
            </a>
          ) : (
            <img src={u} alt="" className="w-full h-full object-cover" />
          )}
          <button
            type="button"
            onClick={() => onRemove(i)}
            className="absolute top-1 left-1 p-1 rounded-full bg-destructive/90 text-destructive-foreground opacity-0 group-hover:opacity-100 transition"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      ))}
    </div>
  );

  return (
    <Card className="border-emerald-500/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <PackageCheck className="w-5 h-5 text-emerald-600" />
          تسليم المركبة
          {initial?.delivered_at && (
            <span className="text-xs font-normal text-emerald-600 mr-2">
              (تم التسليم: {new Date(initial.delivered_at).toLocaleString("ar")})
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5" dir="rtl">
        {/* Quick actions: delivery receipt + delivery documents for insurer */}
        <div className="grid sm:grid-cols-2 gap-2 p-3 rounded-lg bg-emerald-500/5 border border-emerald-500/30">
          <Button
            type="button"
            onClick={openReceiptDialog}
            disabled={loadingWo || !workOrderId}
            className="gap-2 bg-emerald-600 hover:bg-emerald-700 text-white"
          >
            {loadingWo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileSignature className="w-4 h-4" />}
            إقرار استلام السيارة من الورشة
          </Button>
          <Button
            type="button"
            onClick={openReceiptDialog}
            disabled={loadingWo || !workOrderId}
            variant="outline"
            className="gap-2"
          >
            {loadingWo ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileCheck2 className="w-4 h-4" />}
            تجهيز أوراق التسليم للتأمين
          </Button>
          {!workOrderId && (
            <p className="text-xs text-muted-foreground sm:col-span-2">
              يلزم وجود أمر عمل مرتبط بالمطالبة لإصدار إقرار التسليم وتجهيز أوراق التسليم.
            </p>
          )}
        </div>

        <div className="p-3 rounded-lg border border-primary/30 bg-primary/5">
          <AiExtractButton
            schema="delivery_receipt"
            label="استخراج بيانات التسليم بالذكاء"
            hint="ارفع صورة الهوية أو إقرار التسليم — سيتم تعبئة اسم المستلم ورقم الهوية وتاريخ التسليم تلقائياً."
            onExtracted={(data) => {
              if (data.receiver_name) setReceiverName(data.receiver_name);
              if (data.receiver_id_number) setReceiverIdNumber(data.receiver_id_number);
              if (data.delivered_at && /^\d{4}-\d{2}-\d{2}$/.test(data.delivered_at)) {
                setDeliveryDate(data.delivered_at);
              }
              if (data.delivery_notes) {
                setNotes((prev) => (prev ? prev + "\n" : "") + data.delivery_notes);
              }
            }}
          />
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <Label>تاريخ التسليم</Label>
            <Input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} />
          </div>
          <div>
            <Label>اسم المستلم</Label>
            <Input value={receiverName} onChange={(e) => setReceiverName(e.target.value)} placeholder="الاسم الكامل" />
          </div>
          <div className="sm:col-span-2">
            <Label>رقم هوية المستلم</Label>
            <Input
              dir="ltr"
              value={receiverIdNumber}
              onChange={(e) => setReceiverIdNumber(e.target.value)}
              placeholder="00000000"
            />
          </div>
        </div>

        {/* Delivery photos */}
        <div>
          <Label>صور التسليم (المركبة بعد التسليم)</Label>
          <input
            id="del-photos"
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => handleMulti("delivery_photos", e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => document.getElementById("del-photos")?.click()}
            disabled={uploading === "delivery_photos"}
          >
            {uploading === "delivery_photos" ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Upload className="w-4 h-4 ml-2" />}
            رفع صور / PDF
          </Button>
          <PhotoGrid urls={deliveryPhotos} onRemove={(i) => setDeliveryPhotos((p) => p.filter((_, x) => x !== i))} />
        </div>

        {/* Satisfaction photos */}
        <div>
          <Label>صور إقرار رضا العميل</Label>
          <input
            id="sat-photos"
            type="file"
            multiple
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => handleMulti("satisfaction_photos", e.target.files)}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => document.getElementById("sat-photos")?.click()}
            disabled={uploading === "satisfaction_photos"}
          >
            {uploading === "satisfaction_photos" ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Upload className="w-4 h-4 ml-2" />}
            رفع صور / PDF
          </Button>
          <PhotoGrid urls={satisfactionPhotos} onRemove={(i) => setSatisfactionPhotos((p) => p.filter((_, x) => x !== i))} />
        </div>

        {/* Receiver ID */}
        <div>
          <Label>صورة هوية المستلم</Label>
          <input
            id="id-photo"
            type="file"
            accept="image/*,application/pdf"
            className="hidden"
            onChange={(e) => handleSingle(e.target.files?.[0])}
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1"
            onClick={() => document.getElementById("id-photo")?.click()}
            disabled={uploading === "receiver_id_photo"}
          >
            {uploading === "receiver_id_photo" ? <Loader2 className="w-4 h-4 animate-spin ml-2" /> : <Upload className="w-4 h-4 ml-2" />}
            رفع صورة / PDF
          </Button>
          {receiverIdPhoto && (
            <div className="relative mt-2 inline-block">
              {isPdfUrl(receiverIdPhoto) ? (
                <a href={receiverIdPhoto} target="_blank" rel="noreferrer" className="flex h-32 w-32 flex-col items-center justify-center rounded-lg border border-border bg-muted text-sm">
                  <span className="text-3xl">📄</span>
                  PDF
                </a>
              ) : (
                <img src={receiverIdPhoto} alt="" className="h-32 rounded-lg border border-border" />
              )}
              <button
                type="button"
                onClick={() => setReceiverIdPhoto(null)}
                className="absolute top-1 left-1 p-1 rounded-full bg-destructive text-destructive-foreground"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        <div>
          <Label>ملاحظات التسليم</Label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>

        <div className="flex gap-2 pt-2 border-t">
          <Button variant="outline" onClick={() => handleSave(false)} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 animate-spin ml-2" />}
            حفظ المسودة
          </Button>
          <Button onClick={() => handleSave(true)} disabled={saving} className="bg-emerald-600 hover:bg-emerald-700">
            <CheckCircle2 className="w-4 h-4 ml-2" />
            تأكيد التسليم
          </Button>
        </div>
      </CardContent>

      {woForDialog && (
        <VehicleDeliveryReceiptDialog
          open={receiptOpen}
          onOpenChange={setReceiptOpen}
          order={woForDialog}
          deliveryDraft={{
            date: deliveryDate,
            receiverName,
            receiverIdNumber,
            satisfactionNotes: notes,
            idPhotoDataUrl: receiverIdPhoto,
          }}
        />
      )}
    </Card>
  );
}
