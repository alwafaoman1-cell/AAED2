import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate,useParams,useSearchParams } from "react-router-dom";
import { useQuery,useQueryClient } from "@tanstack/react-query";
import { useInsuranceEmployees } from "@/hooks/useInsuranceEmployees";
import { useVehicleMakes } from "@/hooks/useVehicleMakesModels";
import { useAuth } from "@/contexts/AuthContext";
import {queryKeys} from "@/lib/queryKeys";
import {defaultVehicleEntryForm,formFromVehicleEntry,getVehicleEntry,saveVehicleEntry,saveVehicleEntrySignature,searchVehicleEntryCustomers,searchVehicleEntryVehicles,uploadVehicleEntryFiles,type VehicleEntryDamageMark,type VehicleEntryFormState} from "@/lib/vehicleEntryService";
import {toast} from "sonner";
import {useTranslation} from "react-i18next";
import {isValidE164,toE164} from "@/lib/phoneUtils";
import {initialTechnicalDeclarationForm,validateTechnicalDeclarationForm,type VehicleTechnicalDeclarationForm} from "@/lib/vehicleTechnicalDeclaration";
import {getVehicleVisitDetail} from "@/lib/vehicleVisitLifecycle";
import "@/lib/i18n/vehicleIntakeWizard";
import {markDirty,markClean} from "@/lib/unsavedWork";
export const ENTRY_PHOTO_SLOTS= [
  { key: "front_view", ar: "الواجهة الأمامية", en: "Front View" },
  { key: "rear_view", ar: "الواجهة الخلفية", en: "Rear View" },
  { key: "right_side", ar: "الجهة اليمنى", en: "Right Side" },
  { key: "left_side", ar: "الجهة اليسرى", en: "Left Side" },
  { key: "plate_number", ar: "رقم اللوحة", en: "Plate No." },
  { key: "odometer", ar: "قراءة العداد", en: "Odometer" },
  { key: "vin", ar: "رقم الهيكل", en: "VIN" },
  { key: "main_damage", ar: "الضرر الرئيسي", en: "Main Damage" },
] as const;

type PendingEntryPhoto = {
  category: (typeof ENTRY_PHOTO_SLOTS)[number]["key"];
  file: File;
  previewUrl: string;
};


export function useVehicleEntryEditor() {  const { id } = useParams();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();

  const selectedPurpose = searchParams.get("purpose") === "inspection" ? "inspection" : searchParams.get("purpose") === "workshop" ? "workshop" : null;
  const [channel,setChannelState]=useState<"cash"|"insurance"|null>(searchParams.get("channel")==="insurance"?"insurance":searchParams.get("channel")==="cash"?"cash":null);
  const [purpose,setPurposeState]=useState<"workshop"|"inspection"|null>(selectedPurpose);
  const [step,setStep]=useState(1);
  const hydratedId=useRef<string|null>(null);
  const hydratedData=useRef<unknown>(null);
  const savingRef=useRef(false);
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { user, profile } = useAuth();
  const isEdit = !!id;
  const [form, setForm] = useState<VehicleEntryFormState>(() => {
    const initial = defaultVehicleEntryForm();
    return { ...initial, insurance:{...initial.insurance,is_insurance_related:searchParams.get("channel")==="insurance"}, condition: { ...initial.condition, visit_purpose: selectedPurpose || undefined }, received_by_name: profile?.full_name || "" };
  });
  const [saving, setSaving] = useState(false);
  const savedFormBaseline=useRef(JSON.stringify(form));
  const [uploading, setUploading] = useState(false);
  const [customerSearch, setCustomerSearch] = useState("");
  const [vehicleSearch, setVehicleSearch] = useState("");
  const [deliveryDataSource, setDeliveryDataSource] = useState<"manual" | "owner" | "customer">("manual");
  const [pendingDocumentFileId, setPendingDocumentFileId] = useState<string | null>(null);
  const [pendingPhotos, setPendingPhotos] = useState<PendingEntryPhoto[]>([]);
  const [activePhotoCategory, setActivePhotoCategory] = useState<PendingEntryPhoto["category"]>("front_view");
  const pendingPhotosRef = useRef<PendingEntryPhoto[]>([]);
  const photoInputRef = useRef<HTMLInputElement>(null);
  const documentInputRef = useRef<HTMLInputElement>(null);
  const { data: insuranceEmployees = [] } = useInsuranceEmployees(form.insurance_company_id || undefined);
  const { data: vehicleMakes = [] } = useVehicleMakes();

  const detail = useQuery({
    queryKey: queryKeys.vehicleEntries.detail(id),
    queryFn: () => getVehicleEntry(id!),
    enabled: isEdit,
    staleTime: 60_000,
  });

  useEffect(() => {
    const pristine=JSON.stringify(form)===savedFormBaseline.current && !pendingPhotos.length && !pendingDocumentFileId;
    if (detail.data && (hydratedId.current!==id || (hydratedData.current!==detail.data && pristine))) {
      const hydrated=formFromVehicleEntry(detail.data);
      savedFormBaseline.current=JSON.stringify(hydrated);
      setForm(hydrated);
      setPurposeState(detail.data.vehicle_condition?.visit_purpose || null);
      setChannelState(detail.data.insurance_claim_id || detail.data.insurance_snapshot?.is_insurance_related || detail.data.insurance_company_id ? "insurance":"cash");
      hydratedId.current=id!;
      hydratedData.current=detail.data;
    }
  }, [detail.data,id,form,pendingPhotos.length,pendingDocumentFileId]);

  useEffect(() => {
    pendingPhotosRef.current = pendingPhotos;
  }, [pendingPhotos]);

  useEffect(() => () => {
    pendingPhotosRef.current.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
  }, []);

  useEffect(()=>{
    const scope=`vehicle-intake:${id || "new"}`;
    if(JSON.stringify(form)!==savedFormBaseline.current || pendingPhotos.length || pendingDocumentFileId) markDirty(scope);
    else markClean(scope);
    return ()=>markClean(scope);
  },[form,id,pendingPhotos.length,pendingDocumentFileId]);

  const visit=useQuery({queryKey:["vehicle_visit","intake_stage",profile?.tenant_id,id],queryFn:()=>getVehicleVisitDetail(id!,{includeOperationalFile:false}),enabled:isEdit && Boolean(profile?.tenant_id),staleTime:30_000});
  const customerResults = useQuery({
    queryKey: ["vehicle_entry_customer_search", profile?.tenant_id, customerSearch],
    queryFn: () => searchVehicleEntryCustomers(customerSearch),
    enabled: Boolean(profile?.tenant_id) && customerSearch.trim().length >= 2,
    staleTime: 30_000,
  });

  const vehicleResults = useQuery({
    queryKey: ["vehicle_entry_vehicle_search", profile?.tenant_id, vehicleSearch],
    queryFn: () => searchVehicleEntryVehicles(vehicleSearch),
    enabled: Boolean(profile?.tenant_id) && vehicleSearch.trim().length >= 2,
    staleTime: 30_000,
  });
  const supplementalEntryMedia = (((detail.data as any)?.vehicle_media || []) as any[]).filter(
    (media) => media.media_type !== "image" || !ENTRY_PHOTO_SLOTS.some((slot) => slot.key === media.category),
  );

  const patch = (next: Partial<VehicleEntryFormState>) => setForm((prev) => ({ ...prev, ...next }));
  const patchCustomer = (next: Partial<VehicleEntryFormState["customer"]>) => setForm((prev) => {
    const customer = { ...prev.customer, ...next };
    // On a new visit, changing the phone selects a different visitor. Never
    // update the previously selected person's registry record implicitly.
    const visitorChanged = !prev.id && next.phone !== undefined &&
      toE164(next.phone) !== toE164(prev.customer.phone);
    if (visitorChanged) customer.customer_code = "";
    const deliveredBy = prev.delivered_by.delivery_type === "owner" ? {
      ...prev.delivered_by,
      full_name: customer.name,
      phone: customer.phone,
      id_number: customer.id_number,
      relation: "مالك المركبة",
    } : prev.delivered_by;
    return { ...prev, ...(visitorChanged ? { customer_id: null, customer_phone_before_edit: undefined } : {}), customer, delivered_by: deliveredBy };
  });
  const patchVehicle = (next: Partial<VehicleEntryFormState["vehicle"]>) => setForm((prev) => {
    const vehicle = { ...prev.vehicle, ...next };
    // PlateInput reports its parsed value on mount as well as user edits.
    // Vehicle identity must never rewrite the person handing over this visit
    // or create a false dirty draft that blocks canonical realtime refresh.
    return { ...prev, vehicle };
  });
  const patchInsurance = (next: Partial<VehicleEntryFormState["insurance"]>) => setForm((prev) => ({ ...prev, insurance: { ...prev.insurance, ...next } }));
  const patchDeliveredBy = (next: Partial<VehicleEntryFormState["delivered_by"]>) => setForm((prev) => ({ ...prev, delivered_by: { ...prev.delivered_by, ...next } }));
  const patchCondition = (next: Partial<VehicleEntryFormState["condition"]>) => setForm((prev) => ({ ...prev, condition: { ...prev.condition, ...next } }));
  const patchContents = (next: Partial<VehicleEntryFormState["contents"]>) => setForm((prev) => ({ ...prev, contents: { ...prev.contents, ...next } }));

  const canSave = useMemo(() => {
    return !!channel && !!purpose && !!form.arrival_date && !!form.arrival_time && !!form.delivered_by.full_name.trim() && (!!form.customer_id || !!form.customer.customer_code || isValidE164(toE164(form.customer.phone))) && (!!form.vehicle_id || (!!form.vehicle.plate_number.trim() && !!form.vehicle.make.trim()));
  }, [form,channel,purpose]);

  function chooseDeliveredBy(type: VehicleEntryFormState["delivered_by"]["delivery_type"]) {
    if (type === "owner") {
      setDeliveryDataSource("owner");
      patch({ arrival_method: "العميل أحضر المركبة" });
      patchDeliveredBy({
        delivery_type: type,
        full_name: form.customer.name,
        phone: form.customer.phone,
        id_number: form.customer.id_number,
        relation: "العميل/مالك المركبة",
        towing_company: "",
        towing_plate: "",
      });
      return;
    }
    if (type === "tow") {
      setDeliveryDataSource("manual");
      patch({ arrival_method: "وصلت بواسطة رافعة" });
      patchDeliveredBy({
        delivery_type: type,
        full_name: form.delivered_by.delivery_type === "owner" ? "" : form.delivered_by.full_name,
        phone: form.delivered_by.delivery_type === "owner" ? "" : form.delivered_by.phone,
        id_number: form.delivered_by.delivery_type === "owner" ? "" : form.delivered_by.id_number,
        relation: "سائق رافعة",
      });
      return;
    }
    setDeliveryDataSource("manual");
    patch({ arrival_method: "سائق أحضر المركبة" });
    patchDeliveredBy({
      delivery_type: type,
      full_name: form.delivered_by.delivery_type === "owner" ? "" : form.delivered_by.full_name,
      phone: form.delivered_by.delivery_type === "owner" ? "" : form.delivered_by.phone,
      id_number: form.delivered_by.delivery_type === "owner" ? "" : form.delivered_by.id_number,
      relation: "سائق",
      towing_company: "",
      towing_plate: "",
    });
  }

  function stageEntryPhoto(category: PendingEntryPhoto["category"], file?: File | null) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error(t("vehicleIntakeWizard.invalidImage"));
      return;
    }
    const previewUrl = URL.createObjectURL(file);
    setPendingPhotos((previous) => {
      const replaced = previous.find((photo) => photo.category === category);
      if (replaced) URL.revokeObjectURL(replaced.previewUrl);
      return [...previous.filter((photo) => photo.category !== category), { category, file, previewUrl }];
    });
  }

  function removePendingPhoto(category: PendingEntryPhoto["category"]) {
    setPendingPhotos((previous) => {
      const removed = previous.find((photo) => photo.category === category);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return previous.filter((photo) => photo.category !== category);
    });
  }

  const initialTechnical=initialTechnicalDeclarationForm({vehicle_snapshot:form.vehicle,insurance_snapshot:form.insurance},profile?.full_name || "");
  const technicalDraft=form.technical_declaration?.form || initialTechnical;
  const technicalIdentityChanged=["claim_number","registration_number","make_model"].some(key=>technicalDraft[key as keyof VehicleTechnicalDeclarationForm]!==initialTechnical[key as keyof VehicleTechnicalDeclarationForm]);
  // A new intake has one identity source. A saved declaration is historical and
  // is not silently rewritten merely because another page changed a plate/name.
  const technicalForm=form.id ? technicalDraft : {...technicalDraft,claim_number:initialTechnical.claim_number,registration_number:initialTechnical.registration_number,make_model:initialTechnical.make_model,
    signature_data_url:technicalIdentityChanged?"":technicalDraft.signature_data_url};
  function setTechnicalForm(next:VehicleTechnicalDeclarationForm) {
    patch({technical_declaration:{form:next,revision:form.technical_declaration?.revision ?? null}});
  }
  function setChannel(next:"cash"|"insurance") {
    if (form.insurance_claim_id || form.work_order_id) return;
    setChannelState(next);
    patch({insurance_company_id:next==="cash"?null:form.insurance_company_id,insurance:next==="cash"?defaultVehicleEntryForm().insurance:{...form.insurance,is_insurance_related:true}});
  }
  function setPurpose(next:"workshop"|"inspection") {
    setPurposeState(next); patchCondition({visit_purpose:next});
  }
  function goNext() {
    if ((step===1 && (!channel||!purpose)) || (step===2 && !canSave)) {toast.error(t("vehicleIntakeWizard.required"));return;}
    try {if(step===3) validateTechnicalDeclarationForm(technicalForm);}catch(error){toast.error((error as Error).message);return;}
    setStep(Math.min(4,step+1));
  }
  async function handleSave(status = form.status) {
    if(savingRef.current) return;
    if (!canSave) {
      toast.error(t("vehicleIntakeWizard.required"));
      return;
    }
    savingRef.current=true;
    setSaving(true);
    try {
      const customerPhoneWasEdited = form.customer_id &&
        form.customer_phone_before_edit !== undefined &&
        form.customer.phone.trim() !== (form.customer_phone_before_edit || "").trim();
      const saved = await saveVehicleEntry({ ...form, status, technical_declaration:{form:technicalForm,revision:form.technical_declaration?.revision ?? null} }, user?.id);
      // Retain the committed identity even when a later attachment/read-back fails.
      const savedState=formFromVehicleEntry({...saved,damage_marks:form.damage_marks});
      savedFormBaseline.current=JSON.stringify(savedState);
      setForm(savedState);
      let documentLinkWarning = Boolean(pendingDocumentFileId && !profile?.tenant_id);
      const savedDocumentFileId = pendingDocumentFileId;
      if (savedDocumentFileId && profile?.tenant_id) {
        try {
          const { linkDocumentFile } = await import("@/lib/documentExtraction/persistence");
          await linkDocumentFile({ tenantId: profile.tenant_id, fileId: savedDocumentFileId, entityType: "vehicle_entry", entityId: saved.id });
          setPendingDocumentFileId(null);
        } catch {
          documentLinkWarning = true;
        }
      }
      if (pendingPhotos.length) {
        try {
          for (const photo of pendingPhotos) {
            await uploadVehicleEntryFiles({
              entryId: saved.id,
              files: [photo.file],
              kind: "entry_photo",
              category: photo.category,
              uploadedBy: user?.id,
            });
            setPendingPhotos(previous=>previous.filter(item=>item!==photo));
            URL.revokeObjectURL(photo.previewUrl);
          }
          pendingPhotos.forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
          setPendingPhotos([]);
        } catch (uploadError: any) {
          setForm(savedState);
          qc.setQueryData(queryKeys.vehicleEntries.detail(saved.id), saved);
          await qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
          toast.error(`${t("vehicleIntakeWizard.partialPhotos")}: ${uploadError?.message || uploadError}`);
          return;
        }
      }
      const refreshed = await getVehicleEntry(saved.id);
      if(!refreshed) throw new Error(t("vehicleIntakeWizard.saveFailed"));
      qc.setQueryData(queryKeys.vehicleEntries.detail(saved.id), refreshed || saved);
      await qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
      if (!form.customer_id || customerPhoneWasEdited) {
        void Promise.allSettled([
          qc.invalidateQueries({ queryKey: queryKeys.customers.all }),
          qc.invalidateQueries({ queryKey: queryKeys.vehicles.all }),
          qc.invalidateQueries({ queryKey: queryKeys.vehicle360.all }),
        ]);
      }
      toast.success(t(status === "Issued" ? "vehicleIntakeWizard.saved" : "vehicleIntakeWizard.draftSaved"));
      if (documentLinkWarning && savedDocumentFileId) toast.warning(
        `${t("vehicleIntakeWizard.documentNotLinked")} ${savedDocumentFileId}`,
        { duration: Infinity, action: { label: t("vehicleIntakeWizard.linkRetry"), onClick: () => {
          if (!profile?.tenant_id) { toast.error(t("vehicleIntakeWizard.tenantMissing")); return; }
          void import("@/lib/documentExtraction/persistence").then(({ linkDocumentFile }) =>
            linkDocumentFile({ tenantId: profile.tenant_id, fileId: savedDocumentFileId, entityType: "vehicle_entry", entityId: saved.id }))
            .then(() => toast.success(t("vehicleIntakeWizard.documentLinked")))
            .catch(() => toast.error(t("vehicleIntakeWizard.documentNotLinked")));
        } } },
      );
      navigate(`/vehicle-entry/${saved.id}`, { replace: true });
    } catch (error: any) {
      if (error?.savedEntry?.id) {
        const savedEntry = error.savedEntry;
        patch({
          id: savedEntry.id,
          entry_number: savedEntry.entry_number,
          customer_id: savedEntry.customer_id,
          vehicle_id: savedEntry.vehicle_id,
        });
        qc.setQueryData(queryKeys.vehicleEntries.detail(savedEntry.id), savedEntry);
        void qc.invalidateQueries({ queryKey: queryKeys.vehicleEntries.all });
      }
      const message = String(error?.message || error);
      if (String(error?.code || "").match(/^VEHICLE_INTAKE_(CUSTOMER|PHONE)_/)) setStep(2);
      toast.error(`${t("vehicleIntakeWizard.saveFailed")}: ${message}`);
    } finally {
      savingRef.current=false;
      setSaving(false);
    }
  }

  function selectCustomer(customer: any) {
    patch({
      customer_id: customer.id,
      customer_phone_before_edit: customer.phone ?? null,
      customer: {
        ...form.customer,
        customer_code: customer.customer_code || "",
        name: customer.name || "",
        phone: customer.phone || "",
        email: customer.email || "",
        address: customer.address || "",
        id_number: customer.id_number || "",
      },
      delivered_by: form.delivered_by.delivery_type === "owner" ? {
        ...form.delivered_by,
        full_name: customer.name || "",
        phone: customer.phone || "",
        id_number: customer.id_number || "",
        relation: "العميل/مالك المركبة",
      } : form.delivered_by,
    });
    setCustomerSearch("");
    toast.success(t("vehicleIntakeWizard.customerSelected"));
  }

  function selectVehicle(vehicle: any) {
    patch({
      vehicle_id: vehicle.id,
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
    });
    setVehicleSearch("");
    toast.success(t("vehicleIntakeWizard.vehicleSelected"));
  }

  function addDamageMark() {
    const next: VehicleEntryDamageMark = {
      mark_number: form.damage_marks.length + 1,
      damage_type: t("vehicleIntakeWizard.damageDefault"),
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
          damage_type: t("vehicleIntakeWizard.visibleDamageDefault"),
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
      toast.error(t("vehicleIntakeWizard.saveBeforeFiles"));
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
      toast.success(t("vehicleIntakeWizard.filesSaved"));
    } catch (error: any) {
      toast.error(error?.message || t("vehicleIntakeWizard.filesFailed"));
    } finally {
      setUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = "";
      if (documentInputRef.current) documentInputRef.current.value = "";
    }
  }

  async function handleSignature(role: "delivered_by" | "receiver", dataUrl: string) {
    if (!form.id) {
      toast.error(t("vehicleIntakeWizard.saveBeforeSignature"));
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
      toast.success(t("vehicleIntakeWizard.signatureSaved"));
    } catch (error: any) {
      toast.error(error?.message || t("vehicleIntakeWizard.signatureFailed"));
    }
  }


return {channel,purpose,step,setStep,setChannel,setPurpose,goNext,technicalForm,setTechnicalForm,visit,form,patch,patchCustomer,patchVehicle,patchInsurance,patchDeliveredBy,patchCondition,patchContents,chooseDeliveredBy,deliveryDataSource,setDeliveryDataSource,customerSearch,setCustomerSearch,vehicleSearch,setVehicleSearch,customerResults,vehicleResults,selectCustomer,selectVehicle,insuranceEmployees,vehicleMakes,detail,pendingPhotos,photoInputRef,documentInputRef,stageEntryPhoto,activePhotoCategory,setActivePhotoCategory,removePendingPhoto,uploading,handleUpload,handleSignature,supplementalEntryMedia,addDamageAt,addDamageMark,updateDamageMark,removeDamageMark,setPendingDocumentFileId,saving,handleSave,canSave,isEdit,navigate,user,profile,setForm};
}
export type VehicleEntryEditor=ReturnType<typeof useVehicleEntryEditor>;

