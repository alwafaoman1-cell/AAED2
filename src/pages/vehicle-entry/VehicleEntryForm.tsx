import {useTranslation} from "react-i18next";
import {useRef} from "react";
import {useFixedActionBarClearance} from "@/hooks/useFixedActionBarClearance";
import {ArrowLeft,ArrowRight,LoaderCircle,Save} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Card} from "@/components/ui/card";
import {useVehicleEntryEditor} from "@/hooks/useVehicleEntryEditor";
import {VehicleEntryStartChoices} from "@/components/vehicle-entry/VehicleEntryStartChoices";
import {VehicleEntryIdentityStep} from "@/components/vehicle-entry/VehicleEntryIdentityStep";
import {VehicleEntryConditionStep} from "@/components/vehicle-entry/VehicleEntryConditionStep";
import {VehicleEntryReviewStep} from "@/components/vehicle-entry/VehicleEntryReviewStep";
import {VehicleEntryExtraction} from "@/components/vehicle-entry/VehicleEntryExtraction";
import "@/lib/i18n/vehicleIntakeWizard";

export default function VehicleEntryForm() {
  const {t,i18n}=useTranslation();
  const actionBarRef=useRef<HTMLDivElement>(null);
  const editor=useVehicleEntryEditor();
  useFixedActionBarClearance(actionBarRef,!editor.isEdit || Boolean(editor.detail.data));
  const {form,step,setStep,goNext,channel,purpose,setChannel,setPurpose,detail,isEdit,saving,canSave,handleSave,navigate,visit}=editor;
  const stages=t("vehicleIntakeWizard.stages",{returnObjects:true}) as string[];
  const closed=["delivered","cancelled"].includes(visit.data?.operationalStage || "");
  if(isEdit && detail.isLoading) return <p role="status" className="p-8 text-center">{t("vehicleIntakeWizard.loading")}</p>;
  if(isEdit && (detail.error || !detail.data)) return <p role="alert" className="p-8 text-destructive">{t("vehicleIntakeWizard.saveFailed")}: {detail.error?.message}</p>;
  return <div className="space-y-5 pb-12" dir={i18n.language.startsWith("ar")?"rtl":"ltr"}>
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h1 className="text-xl font-bold sm:text-2xl">{t(isEdit?"vehicleIntakeWizard.editTitle":"vehicleIntakeWizard.title")}</h1>
        {form.entry_number && <p className="font-mono font-semibold" dir="ltr">{form.entry_number}</p>}
        <p className="mt-1 text-sm text-muted-foreground">{t("vehicleIntakeWizard.step",{current:step})}</p>
      </div>
      <Button type="button" variant="outline" onClick={()=>navigate("/vehicle-entry")}>{t("vehicleIntakeWizard.back")}</Button>
    </header>
    <nav aria-label={t("vehicleIntakeWizard.title")} className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {stages.map((label,index)=><Button key={label} type="button" variant={step===index+1?"default":"outline"} aria-current={step===index+1?"step":undefined} disabled={saving || index+1>step} onClick={()=>setStep(index+1)} className="h-auto min-h-12 justify-start gap-2 whitespace-normal text-start">
        <span className="rounded-full border border-current px-2 py-0.5 font-mono">{index+1}</span>{label}
      </Button>)}
    </nav>
    <Card className="flex flex-wrap items-center justify-between gap-3 p-3 text-sm">
      <span>{t("vehicleIntakeWizard.centerStatus")}: <strong>{visit.data ? t(`vehicleVisit.${visit.data.stage}`) : t(isEdit?"vehicleVisit.needs_review":"vehicleIntakeWizard.newStage")}</strong></span>
      <span>{t("vehicleIntakeWizard.location")}: <strong>{t(form.vehicle_location==="مع العميل"?"vehicleIntakeWizard.withCustomer":form.vehicle_location==="داخل الورشة"?"vehicleIntakeWizard.inside":"vehicleVisit.needs_review")}</strong></span>
      <p className="w-full text-xs text-muted-foreground">{t("vehicleIntakeWizard.statusHint")}</p>
    </Card>
    {closed && <p role="alert" className="rounded-lg border border-warning p-3 text-warning">{t("vehicleIntakeWizard.VEHICLE_INTAKE_CLOSED")}</p>}
    <fieldset disabled={saving || closed} className="min-w-0 space-y-4">
      {step===1 && <Card className="p-4"><VehicleEntryStartChoices channel={channel} purpose={purpose} channelLocked={!!(form.insurance_claim_id||form.work_order_id)} onChannelChange={setChannel} onPurposeChange={setPurpose}/></Card>}
      {step===2 && <><VehicleEntryExtraction editor={editor}/><VehicleEntryIdentityStep editor={editor}/></>}
      {step===3 && <VehicleEntryConditionStep editor={editor}/>}
      {step===4 && <VehicleEntryReviewStep editor={editor}/>}
    </fieldset>
    <div ref={actionBarRef} data-sticky-actions="vehicle-intake" className="sticky bottom-2 z-10 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border bg-background/95 p-3 shadow-lg backdrop-blur">
      <Button type="button" variant="outline" disabled={step===1 || saving} onClick={()=>setStep(step-1)}><ArrowRight className="me-2 h-4 w-4 ltr:rotate-180" aria-hidden="true"/>{t("vehicleIntakeWizard.previous")}</Button>
      {step<4 ? <Button type="button" disabled={saving || closed} onClick={goNext}>{t("vehicleIntakeWizard.next")}<ArrowLeft className="ms-2 h-4 w-4 ltr:rotate-180" aria-hidden="true"/></Button> :
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={saving || !canSave || closed} onClick={()=>void handleSave(form.status.startsWith("Converted")?form.status:"Draft")}>{t("vehicleIntakeWizard.draft")}</Button>
        <Button type="button" disabled={saving || !canSave || closed} onClick={()=>void handleSave(form.status.startsWith("Converted")?form.status:"Issued")}>
          {saving?<LoaderCircle className="me-2 h-4 w-4 animate-spin" aria-hidden="true"/>:<Save className="me-2 h-4 w-4" aria-hidden="true"/>}
          {t(saving?"vehicleIntakeWizard.saving":isEdit?"vehicleIntakeWizard.saveEdit":"vehicleIntakeWizard.save")}
        </Button>
      </div>}
    </div>
  </div>;
}
