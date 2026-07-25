import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, FileScan, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import PlateInput from "@/components/vehicles/PlateInput";
import VehicleMakeModelPicker from "@/components/insurance/VehicleMakeModelPicker";
import AiExtractButton from "@/components/ai/AiExtractButton";
import { useAuth } from "@/contexts/AuthContext";
import { queryKeys } from "@/lib/queryKeys";
import {
  defaultVehicleEntryForm,
  formFromVehicleEntry,
  getVehicleEntry,
  saveVehicleEntry,
  saveVehicleEntrySignature,
  searchVehicleEntryCustomers,
  searchVehicleEntryVehicles,
  uploadVehicleEntryFiles,
  type VehicleEntryDamageMark,
  type VehicleEntryFormState,
} from "@/lib/vehicleEntryService";
import { toast } from "sonner";

const ARRIVAL_METHODS = [
  "العميل قاد المركبة",
  "مندوب أحضر المركبة",
  "رافعة شركة التأمين",
  "رافعة خاصة",
  "مركبة غير قابلة للقيادة",
  "أخرى",
];

const CONDITION_FLAGS = [
  "تعمل وتتحرك",
  "تعمل ولكن لا تتحرك",
  "لا تعمل",
  "وصلت بواسطة رافعة",
  "لا يمكن تشغيلها أو فحصها",
  "بها أعطال ميكانيكية",
  "بها أعطال كهربائية",
  "يوجد تسريب سوائل",
  "الوسائد الهوائية مفتوحة",
  "أجزاء مفكوكة داخل المركبة",
  "أضرار أسفل المركبة",
  "أضرار سابقة ظاهرة",
];

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label>{label}</Label>{children}</div>;
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <Card className="p-4 space-y-4">
      <div>
        <h2 className="font-bold text-lg">{title}</h2>
        {desc && <p className="text-xs text-muted-foreground mt-1">{desc}</p>}
      </div>
      {children}
    </Card>
  );
}

export default function VehicleEntryForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const isEdit = !!id;
  const [form, setForm] = useState<VehicleEntryFormState>(() => ({
    ...defaultVehicleEntryForm(),
    received_by_name: profile?.full_name || "",
  }));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);

  const detail = useQuery({
    queryKey: queryKeys.vehicleEntries.detail(id),
    queryFn: () => getVehicleEntry(id!),
    enabled: isEdit,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (detail.data) setForm(formFromVehicleEntry(detail.data));
  }, [detail.data]);

  const customerResults = useQuery({
    queryKey: ["vehicle_entry_customer_search", customerSearch],
    queryFn: () => searchVehicleEntryCustomers(customerSearch),
    enabled: customerSearch.trim().length >= 2,
    staleTime: 30_000,
  });

  const vehicleResults = useQuery({
    queryKey: ["vehicle_entry_vehicle_search", vehicleSearch],
    queryFn: () => searchVehicleEntryVehicles(vehicleSearch),
    enabled: vehicleSearch.trim().length >= 2,
    staleTime: 30_000,
  });

  const patch = (next: Partial<VehicleEntryFormState>) => setForm((prev) => ({ ...prev, ...next }));
  const patchCustomer = (next: Partial<VehicleEntryFormState["customer"]>) => setForm((prev) => ({ ...prev, customer: { ...prev.customer, ...next } }));
  const patchVehicle = (next: Partial<VehicleEntryFormState["vehicle"]>) => setForm((prev) => ({ ...prev, vehicle: { ...prev.vehicle, ...next } }));
  const patchInsurance = (next: Partial<VehicleEntryFormState["insurance"]>) => setForm((prev) => ({ ...prev, insurance: { ...prev.insurance, ...next } }));
  const patchDeliveredBy = (next: Partial<VehicleEntryFormState["delivered_by"]>) => setForm((prev) => ({ ...prev, delivered_by: { ...prev.delivered_by, ...next } }));
  const patchCondition = (next: Partial<VehicleEntryFormState["condition"]>) => setForm((prev) => ({ ...prev, condition: { ...prev.condition, ...next } }));
  const patchContents = (next: Partial<VehicleEntryFormState["contents"]>) => setForm((prev) => ({ ...prev, contents: { ...prev.contents, ...next } }));

  const canSave = useMemo(() => {
    return !!form.arrival_date && !!form.arrival_time && !!form.delivered_by.full_name.trim() && (!!form.customer_id || !!form.customer.name.trim() || !!form.customer.phone.trim()) && (!!form.vehicle_id || !!form.vehicle.plate_number.trim() || !!form.vehicle.vin.trim());
  }, [form]);

  async function handleSave(status = form.status) {
    if (!canSave) {
      toast.error("أدخل بيانات العميل أو اختره، وبيانات المركبة أو اخترها، واسم مسلّم المركبة.");
      return;
    }
    setSaving(true);
    try {
      const saved = await saveVehicleEntry({ ...form, status }, user?.id);
      qc.setQueryData(queryKeys.vehicleEntries.detail(saved.id), saved);
      await qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
      toast.success(status === "Issued" ? "تم حفظ وإصدار نموذج الدخول" : "تم حفظ مسودة نموذج الدخول");
      navigate(`/vehicle-entry/${saved.id}`, { replace: true });
    } catch (error: any) {
      toast.error(`تعذر حفظ نموذج الدخول: ${error.message || error}`);
    } finally {
      setSaving(false);
    }
  }

  function selectCustomer(customer: any) {
    patch({
      customer_id: customer.id,
      customer: {
        ...form.customer,
        name: customer.name || "",
        phone: customer.phone || "",
        email: customer.email || "",
        address: customer.address || "",
        id_number: customer.id_number || "",
      },
    });
    setCustomerSearch("");
    toast.success("تم اختيار العميل الموجود");
  }

  function selectVehicle(vehicle: any) {
    patch({
      vehicle_id: vehicle.id,
      customer_id: vehicle.customer_id || form.customer_id,
      vehicle: {
        ...form.vehicle,
        plate_number: vehicle.plate_number || "",
        plate_letters: vehicle.plate_letters || "",
        plate_country: vehicle.plate_country || "OM",
        make: vehicle.brand || "",
        model: vehicle.model || "",
        year: vehicle.year ? String(vehicle.year) : "",
        color: vehicle.color || "",
        vin: vehicle.vin_number || vehicle.vin || "",
        mileage: vehicle.mileage ? String(vehicle.mileage) : "",
        current_owner_name: vehicle.customers?.name || form.vehicle.current_owner_name,
      },
      customer: vehicle.customers ? {
        ...form.customer,
        name: vehicle.customers.name || form.customer.name,
        phone: vehicle.customers.phone || form.customer.phone,
      } : form.customer,
    });
    setVehicleSearch("");
    toast.success("تم اختيار المركبة الموجودة بدون تغيير مالكها");
  }

  function addDamageMark() {
    const next: VehicleEntryDamageMark = {
      mark_number: form.damage_marks.length + 1,
      damage_type: "صدمة",
      vehicle_part: "",
      description: "",
      related_to_incident: true,
      expected_action: "",
      notes: "",
    };
    patch({ damage_marks: [...form.damage_marks, next] });
  }

  function updateDamageMark(index: number, next: Partial<VehicleEntryDamageMark>) {
    patch({ damage_marks: form.damage_marks.map((mark, i) => (i === index ? { ...mark, ...next } : mark)) });
  }

  function removeDamageMark(index: number) {
    patch({ damage_marks: form.damage_marks.filter((_, i) => i !== index).map((m, i) => ({ ...m, mark_number: i + 1 })) });
  }

  function addDamageAt(x: number, y: number) {
    patch({
      damage_marks: [
        ...form.damage_marks,
        {
          mark_number: form.damage_marks.length + 1,
          damage_type: "ضرر ظاهر",
          vehicle_part: "",
          description: "",
          related_to_incident: true,
          expected_action: "",
          notes: "",
          x,
          y,
          color: "#dc2626",
        },
      ],
    });
  }

  async function handleUpload(files: FileList | null, kind: "entry_photo" | "damage_photo" | "document") {
    if (!files?.length) return;
    if (!form.id) {
      toast.error("احفظ نموذج الدخول أولًا قبل رفع الصور أو المستندات.");
      return;
    }
    setUploading(true);
    try {
      await uploadVehicleEntryFiles({
        entryId: form.id,
        files: Array.from(files),
        kind,
        category: kind === "document" ? "entry_document" : kind,
        uploadedBy: user?.id,
      });
      await qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.detail(form.id) });
      toast.success("تم رفع الملفات وربطها بنموذج الدخول");
    } catch (error: any) {
      toast.error(error?.message || "تعذر رفع الملفات");
    } finally {
      setUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  }

  async function handleSignature(role: "delivered_by" | "receiver", dataUrl: string) {
    if (!form.id) {
      toast.error("احفظ نموذج الدخول أولًا قبل حفظ التوقيع.");
      return;
    }
    try {
      await saveVehicleEntrySignature({
        entryId: form.id,
        role,
        signatureDataUrl: dataUrl,
        signerName: role === "delivered_by" ? form.delivered_by.full_name : form.received_by_name,
        signerPhone: role === "delivered_by" ? form.delivered_by.phone : "",
        signerTitle: role === "delivered_by" ? form.delivered_by.relation : "Receiver",
        userId: user?.id,
      });
      await qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.detail(form.id) });
      toast.success("تم حفظ التوقيع");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ التوقيع");
    }
  }

  if (detail.isLoading) return <div className="p-8 text-center text-muted-foreground">جاري تحميل نموذج الدخول...</div>;
  if (detail.error) return <div className="p-8 text-center text-destructive">تعذر تحميل نموذج الدخول: {(detail.error as Error).message}</div>;

  return (
    <div className="space-y-5 pb-10" dir="rtl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{isEdit ? "تعديل نموذج دخول مركبة" : "دخول واستلام مركبة"}</h1>
          <p className="text-sm text-muted-foreground">Vehicle Entry & Receipt</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => navigate("/vehicle-entry")} className="gap-2"><ArrowRight size={16} /> رجوع</Button>
          <Button variant="outline" type="button" className="gap-2" onClick={() => toast.info("ميزة AI مربوطة بزر الاستخراج داخل القسم؛ لا يتم الحفظ تلقائيًا.")}>
            <FileScan size={16} /> Upload & Extract with AI
          </Button>
          <Button variant="outline" disabled={saving} onClick={() => handleSave("Draft")} className="gap-2"><Save size={16} /> حفظ مسودة</Button>
          <Button disabled={saving} onClick={() => handleSave("Issued")} className="gap-2"><Save size={16} /> حفظ وإصدار</Button>
        </div>
      </div>

      <Section title="استخراج البيانات بالذكاء الاصطناعي" desc="لا يتم حفظ أي بيانات تلقائيًا. راجع البيانات ثم طبّقها على النموذج.">
        <AiExtractButton
          schema="insurance_claim"
          onExtracted={(data: any) => {
            patchCustomer({ name: data.owner_name || form.customer.name, phone: data.owner_phone || form.customer.phone, id_number: data.owner_id || form.customer.id_number });
            patchVehicle({
              plate_number: data.plate_number || form.vehicle.plate_number,
              plate_letters: data.plate_letters || form.vehicle.plate_letters,
              make: data.make || form.vehicle.make,
              model: data.model || form.vehicle.model,
              year: data.year ? String(data.year) : form.vehicle.year,
              color: data.color || form.vehicle.color,
              vin: data.vin || form.vehicle.vin,
            });
            patchInsurance({ company_name: data.insurance_company || form.insurance.company_name, claim_number: data.claim_number || form.insurance.claim_number, lpo_number: data.lpo_number || form.insurance.lpo_number });
            toast.success("تم تطبيق البيانات المستخرجة على النموذج فقط. راجعها ثم احفظ.");
          }}
        />
      </Section>

      <Section title="تاريخ ووقت الوصول إلى الورشة">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="تاريخ الوصول"><Input type="date" value={form.arrival_date} onChange={(e) => patch({ arrival_date: e.target.value })} /></Field>
          <Field label="وقت الوصول"><Input type="time" value={form.arrival_time} onChange={(e) => patch({ arrival_time: e.target.value })} /></Field>
          <Field label="طريقة الوصول">
            <Select value={form.arrival_method} onValueChange={(value) => patch({ arrival_method: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ARRIVAL_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          <Field label="الموظف المستلم"><Input value={form.received_by_name} onChange={(e) => patch({ received_by_name: e.target.value })} /></Field>
          <Field label="موقع المركبة"><Input value={form.vehicle_location} onChange={(e) => patch({ vehicle_location: e.target.value })} /></Field>
          <Field label="رقم الباي / الساحة"><Input value={form.vehicle_location_bay} onChange={(e) => patch({ vehicle_location_bay: e.target.value })} /></Field>
          <Field label="حالة النموذج">
            <Select value={form.status} onValueChange={(value) => patch({ status: value as any })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["Draft", "Received", "Issued", "Cancelled"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      <Section title="بيانات العميل / Customer Information" desc="ابحث أولًا لتجنب إنشاء عميل مكرر.">
        <div className="space-y-3">
          <Field label="البحث عن عميل موجود">
            <Input value={customerSearch} onChange={(e) => setCustomerSearch(e.target.value)} placeholder="اكتب رقم الهاتف أو الاسم أو Customer Code" />
          </Field>
          {!!customerResults.data?.length && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {customerResults.data.map((customer: any) => (
                <button type="button" key={customer.id} onClick={() => selectCustomer(customer)} className="rounded-lg border border-border p-3 text-right hover:bg-muted">
                  <div className="font-semibold">{customer.customer_code || "CUST"} · {customer.name}</div>
                  <div className="text-xs text-muted-foreground" dir="ltr">{customer.phone || ""}</div>
                </button>
              ))}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="اسم العميل الكامل"><Input value={form.customer.name} onChange={(e) => patchCustomer({ name: e.target.value })} /></Field>
            <Field label="رقم الهاتف"><Input dir="ltr" value={form.customer.phone} onChange={(e) => patchCustomer({ phone: e.target.value })} /></Field>
            <Field label="هاتف إضافي"><Input dir="ltr" value={form.customer.alternate_phone} onChange={(e) => patchCustomer({ alternate_phone: e.target.value })} /></Field>
            <Field label="رقم البطاقة"><Input dir="ltr" value={form.customer.id_number} onChange={(e) => patchCustomer({ id_number: e.target.value })} /></Field>
            <Field label="البريد الإلكتروني"><Input dir="ltr" value={form.customer.email} onChange={(e) => patchCustomer({ email: e.target.value })} /></Field>
            <Field label="نوع العميل">
              <Select value={form.customer.customer_type} onValueChange={(value) => patchCustomer({ customer_type: value as any })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="individual">فرد</SelectItem><SelectItem value="company">شركة</SelectItem></SelectContent>
              </Select>
            </Field>
            <Field label="العنوان"><Input value={form.customer.address} onChange={(e) => patchCustomer({ address: e.target.value })} /></Field>
            <div className="md:col-span-2"><Field label="ملاحظات"><Textarea value={form.customer.notes} onChange={(e) => patchCustomer({ notes: e.target.value })} rows={2} /></Field></div>
          </div>
        </div>
      </Section>

      <Section title="بيانات المركبة / Vehicle Information" desc="البحث يستخدم رقم اللوحة والحروف والدولة أو VIN.">
        <div className="space-y-3">
          <Field label="البحث عن مركبة موجودة">
            <Input value={vehicleSearch} onChange={(e) => setVehicleSearch(e.target.value)} placeholder="رقم اللوحة، الحروف، VIN، الماركة..." />
          </Field>
          {!!vehicleResults.data?.length && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {vehicleResults.data.map((vehicle: any) => (
                <button type="button" key={vehicle.id} onClick={() => selectVehicle(vehicle)} className="rounded-lg border border-border p-3 text-right hover:bg-muted">
                  <div className="font-semibold" dir="ltr">{[vehicle.plate_letters, vehicle.plate_number].filter(Boolean).join(" ")}</div>
                  <div className="text-xs text-muted-foreground">{[vehicle.brand, vehicle.model, vehicle.year].filter(Boolean).join(" ")} · {vehicle.customers?.name || "—"}</div>
                </button>
              ))}
            </div>
          )}
          <PlateInput
            value={[form.vehicle.plate_letters, form.vehicle.plate_number].filter(Boolean).join(" ")}
            onChange={() => undefined}
            onPartsChange={(parts) => patchVehicle({ plate_letters: parts.letters, plate_number: parts.digits, plate_country: parts.country })}
            showCountry
            checkDuplicate={!form.vehicle_id}
          />
          <VehicleMakeModelPicker
            make={form.vehicle.make}
            model={form.vehicle.model}
            plate={[form.vehicle.plate_letters, form.vehicle.plate_number].filter(Boolean).join(" ")}
            year={form.vehicle.year}
            color={form.vehicle.color}
            vin={form.vehicle.vin}
            hideFields={["plate"]}
            onChange={(next) => patchVehicle({
              make: next.make ?? form.vehicle.make,
              model: next.model ?? form.vehicle.model,
              year: next.year ?? form.vehicle.year,
              color: next.color ?? form.vehicle.color,
              vin: next.vin ?? form.vehicle.vin,
            })}
          />
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="قراءة العداد"><Input dir="ltr" value={form.vehicle.mileage} onChange={(e) => patchVehicle({ mileage: e.target.value })} /></Field>
            <Field label="نوع الوقود"><Input value={form.vehicle.fuel_type} onChange={(e) => patchVehicle({ fuel_type: e.target.value })} /></Field>
            <Field label="رقم المحرك"><Input dir="ltr" value={form.vehicle.engine_number} onChange={(e) => patchVehicle({ engine_number: e.target.value })} /></Field>
            <Field label="ناقل الحركة"><Input value={form.vehicle.transmission} onChange={(e) => patchVehicle({ transmission: e.target.value })} /></Field>
            <Field label="اسم المالك الحالي"><Input value={form.vehicle.current_owner_name} onChange={(e) => patchVehicle({ current_owner_name: e.target.value })} /></Field>
          </div>
        </div>
      </Section>

      <Section title="بيانات التأمين / Insurance Information">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="flex items-center gap-2 rounded-lg border border-border p-3"><Checkbox checked={form.insurance.is_insurance_related} onCheckedChange={(v) => patchInsurance({ is_insurance_related: !!v })} /> المركبة تابعة لمطالبة تأمين</label>
          <Field label="شركة التأمين"><Input value={form.insurance.company_name} onChange={(e) => patchInsurance({ company_name: e.target.value })} /></Field>
          <Field label="موظف التأمين"><Input value={form.insurance.employee_name} onChange={(e) => patchInsurance({ employee_name: e.target.value })} /></Field>
          <Field label="رقم المطالبة"><Input dir="ltr" value={form.insurance.claim_number} onChange={(e) => patchInsurance({ claim_number: e.target.value })} /></Field>
          <Field label="رقم الوثيقة"><Input dir="ltr" value={form.insurance.policy_number} onChange={(e) => patchInsurance({ policy_number: e.target.value })} /></Field>
          <Field label="رقم تقرير الشرطة"><Input dir="ltr" value={form.insurance.police_report_number} onChange={(e) => patchInsurance({ police_report_number: e.target.value })} /></Field>
          <Field label="رقم LPO / أمر الإصلاح"><Input dir="ltr" value={form.insurance.lpo_number} onChange={(e) => patchInsurance({ lpo_number: e.target.value })} /></Field>
          <Field label="اسم المعاين"><Input value={form.insurance.surveyor_name} onChange={(e) => patchInsurance({ surveyor_name: e.target.value })} /></Field>
          <Field label="هاتف المعاين"><Input dir="ltr" value={form.insurance.surveyor_phone} onChange={(e) => patchInsurance({ surveyor_phone: e.target.value })} /></Field>
          <div className="md:col-span-3"><Field label="ملاحظات التأمين"><Textarea rows={2} value={form.insurance.notes} onChange={(e) => patchInsurance({ notes: e.target.value })} /></Field></div>
        </div>
      </Section>

      <Section title="بيانات مسلّم المركبة / Vehicle Delivered By">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="الاسم الكامل *"><Input value={form.delivered_by.full_name} onChange={(e) => patchDeliveredBy({ full_name: e.target.value })} /></Field>
          <Field label="رقم الهاتف"><Input dir="ltr" value={form.delivered_by.phone} onChange={(e) => patchDeliveredBy({ phone: e.target.value })} /></Field>
          <Field label="رقم البطاقة"><Input dir="ltr" value={form.delivered_by.id_number} onChange={(e) => patchDeliveredBy({ id_number: e.target.value })} /></Field>
          <Field label="الصفة"><Input value={form.delivered_by.relation} onChange={(e) => patchDeliveredBy({ relation: e.target.value })} /></Field>
          <Field label="شركة الرافعة"><Input value={form.delivered_by.towing_company} onChange={(e) => patchDeliveredBy({ towing_company: e.target.value })} /></Field>
          <Field label="لوحة الرافعة"><Input dir="ltr" value={form.delivered_by.towing_plate} onChange={(e) => patchDeliveredBy({ towing_plate: e.target.value })} /></Field>
          <div className="md:col-span-3"><Field label="ملاحظات"><Textarea rows={2} value={form.delivered_by.notes} onChange={(e) => patchDeliveredBy({ notes: e.target.value })} /></Field></div>
        </div>
      </Section>

      <Section title="حالة المركبة عند الدخول / Vehicle Condition at Entry">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {CONDITION_FLAGS.map((flag) => (
            <label key={flag} className="flex items-center gap-2 rounded-lg border border-border p-2 text-sm">
              <Checkbox
                checked={form.condition.flags.includes(flag)}
                onCheckedChange={(checked) => patchCondition({ flags: checked ? [...form.condition.flags, flag] : form.condition.flags.filter((x) => x !== flag) })}
              />
              {flag}
            </label>
          ))}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="وصف حالة المركبة"><Textarea rows={2} value={form.condition.condition_description} onChange={(e) => patchCondition({ condition_description: e.target.value })} /></Field>
          <Field label="وصف الحادث / سبب الضرر"><Textarea rows={2} value={form.condition.incident_description} onChange={(e) => patchCondition({ incident_description: e.target.value })} /></Field>
          <Field label="الأضرار الظاهرة"><Textarea rows={2} value={form.condition.visible_damage} onChange={(e) => patchCondition({ visible_damage: e.target.value })} /></Field>
          <Field label="أضرار سابقة غير مرتبطة"><Textarea rows={2} value={form.condition.previous_damage} onChange={(e) => patchCondition({ previous_damage: e.target.value })} /></Field>
        </div>
      </Section>

      <Section title="خريطة الأضرار / Damage Map" desc="اضغط أو المس موضع الضرر على المركبة لإضافة علامة مرقمة، ثم أكمل تفاصيلها في الجدول.">
        <DamageMap marks={form.damage_marks} onAdd={addDamageAt} onClear={() => patch({ damage_marks: form.damage_marks.map((mark) => ({ ...mark, x: null, y: null })) })} />
      </Section>

      <Section title="تفاصيل الأضرار / Damage Details">
        <div className="flex justify-end"><Button type="button" variant="outline" onClick={addDamageMark} className="gap-2"><Plus size={16} /> إضافة ضرر</Button></div>
        <div className="space-y-2">
          {form.damage_marks.length === 0 ? <p className="text-sm text-muted-foreground text-center py-4">لا توجد أضرار مسجلة.</p> : form.damage_marks.map((mark, index) => (
            <div key={index} className="grid grid-cols-1 md:grid-cols-7 gap-2 rounded-lg border border-border p-3">
              <Input className="font-mono" value={mark.mark_number} onChange={(e) => updateDamageMark(index, { mark_number: Number(e.target.value) || index + 1 })} />
              <Input value={mark.damage_type} onChange={(e) => updateDamageMark(index, { damage_type: e.target.value })} placeholder="نوع الضرر" />
              <Input value={mark.vehicle_part} onChange={(e) => updateDamageMark(index, { vehicle_part: e.target.value })} placeholder="الجزء" />
              <Input className="md:col-span-2" value={mark.description} onChange={(e) => updateDamageMark(index, { description: e.target.value })} placeholder="الوصف" />
              <Input value={mark.expected_action} onChange={(e) => updateDamageMark(index, { expected_action: e.target.value })} placeholder="الإجراء" />
              <Button type="button" variant="ghost" size="icon" className="text-destructive" onClick={() => removeDamageMark(index)}><Trash2 size={16} /></Button>
            </div>
          ))}
        </div>
      </Section>

      <Section title="صور الدخول والمستندات / Entry Photos & Documents" desc="الصور والمستندات تحفظ في vehicle_media وتُربط بنفس vehicle_id وvehicle_entry_id دون نسخ.">
        <input ref={photoInputRef} type="file" multiple accept="image/*" className="hidden" onChange={(e) => void handleUpload(e.target.files, "entry_photo")} />
        <input ref={documentInputRef} type="file" multiple accept="image/*,application/pdf" className="hidden" onChange={(e) => void handleUpload(e.target.files, "document")} />
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={uploading || !form.id} onClick={() => photoInputRef.current?.click()}>رفع صور الدخول</Button>
          <Button type="button" variant="outline" disabled={uploading || !form.id} onClick={() => documentInputRef.current?.click()}>رفع مستند</Button>
          {!form.id && <span className="text-xs text-muted-foreground self-center">الحفظ مطلوب قبل الرفع حتى يتم منع التكرار وربط الملفات بالسجل الصحيح.</span>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {((detail.data as any)?.vehicle_media || []).length === 0 ? (
            <p className="text-sm text-muted-foreground md:col-span-3">لا توجد ملفات مرفوعة بعد.</p>
          ) : ((detail.data as any)?.vehicle_media || []).map((media: any) => (
            <div key={media.id} className="rounded-lg border border-border p-2 text-sm">
              <div className="font-semibold truncate">{media.file_name || media.storage_path}</div>
              <div className="text-xs text-muted-foreground">{media.media_type} • {media.category}</div>
              {media.public_url && media.media_type === "image" && <img src={media.public_url} alt="" className="mt-2 h-24 w-full object-cover rounded" />}
            </div>
          ))}
        </div>
      </Section>

      <Section title="التوقيعات / Signatures" desc="التوقيع يحفظ كسجل مستقل داخل vehicle_entry_signatures ولا يظهر كزر شكلي.">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <SignaturePad title="توقيع مسلّم المركبة" disabled={!form.id} onSave={(dataUrl) => void handleSignature("delivered_by", dataUrl)} />
          <SignaturePad title="توقيع موظف الاستلام" disabled={!form.id} onSave={(dataUrl) => void handleSignature("receiver", dataUrl)} />
        </div>
      </Section>

      <Section title="محتويات المركبة / Vehicle Contents">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <Field label="عدد المفاتيح"><Input dir="ltr" value={form.contents.keys_count} onChange={(e) => patchContents({ keys_count: e.target.value })} /></Field>
          <Field label="مستوى الوقود">
            <Select value={form.contents.fuel_level} onValueChange={(value) => patchContents({ fuel_level: value })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{["فارغ", "ربع", "نصف", "ثلاثة أرباع", "ممتلئ"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}</SelectContent>
            </Select>
          </Field>
          {[
            ["registration_card", "استمارة المركبة"],
            ["front_plate", "لوحة أمامية"],
            ["rear_plate", "لوحة خلفية"],
            ["spare_tire", "الإطار الاحتياطي"],
            ["tools_jack", "العدة والرافعة"],
            ["fire_extinguisher", "طفاية الحريق"],
            ["warning_triangle", "مثلث التحذير"],
            ["personal_items", "أغراض شخصية"],
            ["spare_parts_inside", "قطع غيار داخل المركبة"],
          ].map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 rounded-lg border border-border p-2">
              <Checkbox checked={(form.contents as any)[key]} onCheckedChange={(v) => patchContents({ [key]: !!v } as any)} /> {label}
            </label>
          ))}
          <div className="md:col-span-4"><Field label="ملاحظات المحتويات"><Textarea rows={2} value={form.contents.notes} onChange={(e) => patchContents({ notes: e.target.value })} /></Field></div>
        </div>
      </Section>

      <div className="sticky bottom-3 z-10 flex justify-end gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
        <Button variant="outline" onClick={() => navigate("/vehicle-entry")}>إلغاء</Button>
        <Button variant="outline" disabled={saving} onClick={() => handleSave("Draft")}>حفظ مسودة</Button>
        <Button disabled={saving} onClick={() => handleSave("Issued")}>حفظ وإصدار</Button>
      </div>
    </div>
  );
}

function DamageMap({
  marks,
  onAdd,
  onClear,
}: {
  marks: VehicleEntryDamageMark[];
  onAdd: (x: number, y: number) => void;
  onClear: () => void;
}) {
  function handlePointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(100, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(0, Math.min(100, ((event.clientY - rect.top) / rect.height) * 100));
    onAdd(Number(x.toFixed(2)), Number(y.toFixed(2)));
  }

  return (
    <div className="space-y-3">
      <div
        role="button"
        tabIndex={0}
        className="relative mx-auto h-[420px] max-w-[320px] rounded-[44px] border-2 border-dashed border-primary/50 bg-gradient-to-b from-muted to-background touch-none"
        onPointerDown={handlePointer}
        onKeyDown={(event) => {
          if (event.key === "Enter") onAdd(50, 50);
        }}
      >
        <div className="absolute left-1/2 top-6 h-16 w-32 -translate-x-1/2 rounded-t-full border border-border bg-background/80 text-center text-xs pt-5">Front</div>
        <div className="absolute left-1/2 top-28 h-44 w-44 -translate-x-1/2 rounded-[32px] border border-border bg-background/70" />
        <div className="absolute left-1/2 bottom-8 h-20 w-36 -translate-x-1/2 rounded-b-full border border-border bg-background/80 text-center text-xs pt-8">Rear</div>
        {marks.filter((mark) => mark.x != null && mark.y != null).map((mark) => (
          <div
            key={`${mark.mark_number}-${mark.x}-${mark.y}`}
            className="absolute flex h-7 w-7 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-destructive text-xs font-bold text-destructive-foreground shadow"
            style={{ left: `${mark.x}%`, top: `${mark.y}%` }}
            title={mark.description || mark.damage_type}
          >
            {mark.mark_number}
          </div>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>يدعم الماوس واللمس. الإحداثيات تحفظ كنسبة مئوية داخل damage_map.</span>
        <Button type="button" size="sm" variant="outline" onClick={onClear}>مسح مواقع العلامات فقط</Button>
      </div>
    </div>
  );
}

function SignaturePad({
  title,
  disabled,
  onSave,
}: {
  title: string;
  disabled?: boolean;
  onSave: (dataUrl: string) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasInk, setHasInk] = useState(false);

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function begin(event: React.PointerEvent<HTMLCanvasElement>) {
    if (disabled) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const p = point(event);
    canvas.setPointerCapture(event.pointerId);
    ctx.strokeStyle = "#0f2440";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    setDrawing(true);
    setHasInk(true);
  }

  function move(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing || disabled) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const p = point(event);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }

  function end() {
    setDrawing(false);
  }

  function clear() {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasInk(false);
  }

  return (
    <div className="rounded-xl border border-border p-3 space-y-2">
      <div className="flex items-center justify-between">
        <Label>{title}</Label>
        {disabled && <span className="text-xs text-muted-foreground">احفظ النموذج أولًا</span>}
      </div>
      <canvas
        ref={canvasRef}
        width={720}
        height={220}
        className="h-36 w-full rounded-lg border border-dashed border-border bg-white touch-none"
        onPointerDown={begin}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="outline" onClick={clear} disabled={disabled || !hasInk}>مسح</Button>
        <Button type="button" size="sm" disabled={disabled || !hasInk} onClick={() => {
          const dataUrl = canvasRef.current?.toDataURL("image/png");
          if (dataUrl) onSave(dataUrl);
        }}>حفظ التوقيع</Button>
      </div>
    </div>
  );
}
