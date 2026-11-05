import {Link} from "react-router-dom";
import {useTranslation} from "react-i18next";
import {Plus,Trash2} from "lucide-react";
import {Button} from "@/components/ui/button";
import {Input} from "@/components/ui/input";
import {Checkbox} from "@/components/ui/checkbox";
import {Textarea} from "@/components/ui/textarea";
import {Select,SelectContent,SelectItem,SelectTrigger,SelectValue} from "@/components/ui/select";
import {Field,Section} from "./VehicleEntryFields";
import {DamageMap} from "./VehicleEntryDrawingTools";
import {VehicleTechnicalDeclarationFields} from "./VehicleTechnicalDeclarationFields";
import type {VehicleEntryEditor} from "@/hooks/useVehicleEntryEditor";
const contentsFields=[
  ["registration_card","registrationCard"],["front_plate","frontPlate"],["rear_plate","rearPlate"],
  ["spare_tire","spareTire"],["tools_jack","tools"],["fire_extinguisher","extinguisher"],
  ["warning_triangle","triangle"],["personal_items","personalItems"],["spare_parts_inside","partsInside"],
] as const;
const fuel=[["فارغ","0%"],["ربع","25%"],["نصف","50%"],["ثلاثة أرباع","75%"],["ممتلئ","100%"]] as const;
export function VehicleEntryConditionStep({editor}:{editor:VehicleEntryEditor}){
  const {t}=useTranslation();
  const {form,patch,patchContents,technicalForm,setTechnicalForm,profile,addDamageAt,addDamageMark,updateDamageMark,removeDamageMark}=editor;
  return <>
    <Section title={t("vehicleIntakeWizard.conditionTitle")} desc={t("vehicleIntakeWizard.conditionHint")}>
      {form.id && (editor.centerPath === "/supervisor" ? <div className="space-y-2"><Button variant="outline" disabled={editor.saving || editor.hasDraftChanges}
        onClick={()=>editor.navigate(`${editor.entryBasePath}/${form.id}/technical-declaration`)}>{t("vehicleIntakeWizard.technicalLink")}</Button>
        {editor.hasDraftChanges && <p className="text-sm text-muted-foreground">{t("vehicleIntakeWizard.saveBeforeTechnical")}</p>}</div>
        : <Button asChild variant="outline"><Link to={`/vehicle-entry/${form.id}/technical-declaration`} target="_blank" rel="noopener noreferrer">{t("vehicleIntakeWizard.technicalLink")}</Link></Button>)}
      <VehicleTechnicalDeclarationFields value={technicalForm} onChange={setTechnicalForm} identityReadOnly={!form.id} reportAuthorName={profile?.full_name || ""}/>
    </Section>
    <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer font-semibold">{t("vehicleIntakeWizard.damageMap")} ({form.damage_marks.length})</summary>
      <div className="mt-4 space-y-3"><p className="text-xs text-muted-foreground">{t("vehicleIntakeWizard.damageHint")}</p>
        <DamageMap marks={form.damage_marks} onAdd={addDamageAt} onClear={()=>patch({damage_marks:form.damage_marks.map(mark=>({...mark,x:null,y:null}))})}/>
        <Button type="button" variant="outline" onClick={addDamageMark}><Plus className="me-2 h-4 w-4" aria-hidden="true"/>{t("vehicleIntakeWizard.addDamage")}</Button>
        {form.damage_marks.map((mark,index)=><div key={index} className="grid gap-2 rounded-lg border border-border p-3 md:grid-cols-3">
          <Field label={t("vehicleIntakeWizard.damageNumber")}><Input type="number" min={1} value={mark.mark_number} onChange={e=>updateDamageMark(index,{mark_number:Number(e.target.value)||index+1})}/></Field>
          {(["damage_type","vehicle_part","description","expected_action"] as const).map((key,k)=><Field key={key} label={t(`vehicleIntakeWizard.${["damageType","part","description","action"][k]}`)}><Input value={mark[key]} onChange={e=>updateDamageMark(index,{[key]:e.target.value})}/></Field>)}
          <Button type="button" variant="outline" className="text-destructive" onClick={()=>removeDamageMark(index)}><Trash2 className="me-2 h-4 w-4" aria-hidden="true"/>{t("vehicleIntakeWizard.removeDamage")}</Button>
        </div>)}
      </div>
    </details>
    <details className="rounded-xl border border-border p-4">
      <summary className="cursor-pointer font-semibold">{t("vehicleIntakeWizard.contents")}</summary>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t("vehicleIntakeWizard.keys")}><Input value={form.contents.keys_count} onChange={e=>patchContents({keys_count:e.target.value})}/></Field>
        <Field label={t("vehicleIntakeWizard.fuelLevel")}><Select value={form.contents.fuel_level} onValueChange={value=>patchContents({fuel_level:value})}>
          <SelectTrigger aria-label={t("vehicleIntakeWizard.fuelLevel")}><SelectValue/></SelectTrigger>
          <SelectContent>{fuel.map(([value,label])=><SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent>
        </Select></Field>
        {contentsFields.map(([key,label])=><label key={key} className="flex min-h-11 items-center gap-2 rounded-lg border border-border p-2 text-sm">
          <Checkbox checked={form.contents[key]} onCheckedChange={value=>patchContents({[key]:value===true})}/>{t(`vehicleIntakeWizard.${label}`)}
        </label>)}
        <div className="sm:col-span-2 lg:col-span-3"><Field label={t("vehicleIntakeWizard.notes")}><Textarea rows={2} value={form.contents.notes} onChange={e=>patchContents({notes:e.target.value})}/></Field></div>
      </div>
    </details>
  </>;
}

