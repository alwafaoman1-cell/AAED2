import { useTranslation } from 'react-i18next';
import { ClipboardCheck,ShieldCheck,Wallet,Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import '@/lib/i18n/vehicleIntakeWizard';

export interface VehicleEntryStartChoicesProps {
  channel:'cash'|'insurance'|null;
  purpose:'workshop'|'inspection'|null;
  channelLocked?:boolean;
  onChannelChange:(channel:'cash'|'insurance')=>void;
  onPurposeChange:(purpose:'workshop'|'inspection')=>void;
}
export function VehicleEntryStartChoices({channel,purpose,channelLocked=false,onChannelChange,onPurposeChange}:VehicleEntryStartChoicesProps){
  const {t}=useTranslation();
  return <section className="space-y-4" aria-label={t('vehicleIntakeWizard.channelTitle')}>
    <h2 className="text-lg font-semibold">{t('vehicleIntakeWizard.channelTitle')}</h2>
    <div className="grid grid-cols-2 gap-3">{(['insurance','cash'] as const).map(kind=>{
      const Icon=kind==='insurance'?ShieldCheck:Wallet;
      return <Button key={kind} type="button" disabled={channelLocked} variant={channel===kind?'default':'outline'} aria-pressed={channel===kind} className="h-auto min-h-24 flex-col gap-2 whitespace-normal p-4" onClick={()=>onChannelChange(kind)}><Icon className="h-7 w-7" aria-hidden="true"/>{t(`vehicleIntakeWizard.${kind}`)}</Button>;
    })}</div>
    <p className="text-sm text-muted-foreground">{t('vehicleIntakeWizard.channelHint')}</p>
    {channel&&<div className="space-y-3 border-t border-border pt-4">
      <h3 className="font-semibold">{t('vehicleIntakeWizard.purposeTitle')}</h3>
      <div className="grid gap-3 sm:grid-cols-2">{(['workshop','inspection'] as const).map(kind=>{
        const Icon=kind==='workshop'?Wrench:ClipboardCheck;
        return <Button key={kind} type="button" variant={purpose===kind?'default':'outline'} aria-pressed={purpose===kind} className="h-auto min-h-28 flex-col gap-2 whitespace-normal p-4" onClick={()=>onPurposeChange(kind)}><Icon className="h-6 w-6" aria-hidden="true"/><span>{t(`vehicleIntakeWizard.${kind}`)}</span><span className="text-xs font-normal">{t(`vehicleIntakeWizard.${kind}Hint`)}</span></Button>;
      })}</div>
    </div>}
  </section>;
}
