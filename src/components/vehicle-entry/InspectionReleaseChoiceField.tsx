import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {inspectionReleaseChoices,inspectionReleaseChoiceId} from '@/lib/inspectionReleaseOptions';
import type {InspectionReleaseForm} from '@/lib/vehicleInspectionRelease';
import '@/lib/i18n/inspectionRelease';

export function InspectionReleaseChoiceField({field,value,disabled,required,onChange,multiple=false}:{field:keyof InspectionReleaseForm;value:string;disabled:boolean;required?:boolean;onChange:(value:string)=>void;multiple?:boolean}){
  const {t}=useTranslation('inspectionRelease');
  const selected=value.split('\n').map(line=>inspectionReleaseChoiceId(field,line)).filter(Boolean);
  const unrecognized=Boolean(value.trim()&&(!selected.length||(multiple&&value.split('\n').some(line=>line.trim()&&!inspectionReleaseChoiceId(field,line)))));
  const [custom,setCustom]=useState(false);
  const manual=custom||unrecognized;
  return <fieldset className="min-w-0 space-y-2" disabled={disabled}>
    <legend className="mb-2 text-sm font-semibold">{t(`fields.${field}`)}{required&&<span className="ms-1 text-destructive">*</span>}</legend>
    <div role="group" aria-label={t(`fields.${field}`)} className="flex flex-wrap gap-2">
      {inspectionReleaseChoices[field]?.map(option=><Button key={option.id} type="button" variant={!manual&&selected.includes(option.id)?'default':'outline'} aria-pressed={!manual&&selected.includes(option.id)} disabled={disabled} className="h-auto min-h-11 whitespace-normal px-3 py-2 text-start" onClick={()=>{
        setCustom(false);
        const next=multiple&&!unrecognized?(inspectionReleaseChoices[field]||[]).filter(item=>item.id===option.id?!selected.includes(item.id):selected.includes(item.id)).map(item=>item.en).join('\n'):option.en;
        onChange(next);
      }}>{t(`choices.${field}.${option.id}`)}</Button>)}
      <Button type="button" variant={manual?'secondary':'outline'} aria-pressed={manual} disabled={disabled} onClick={()=>setCustom(!custom)}>{t('other')}</Button>
    </div>
    {manual&&<label className="block space-y-1 text-sm"><span className="text-muted-foreground">{t('customHint')}</span><Textarea aria-label={t(`fields.${field}`)} value={value} disabled={disabled} maxLength={field==='pending_action'||field==='exit_condition'?1000:2000} rows={2} onChange={event=>onChange(event.target.value)}/></label>}
  </fieldset>;
}
