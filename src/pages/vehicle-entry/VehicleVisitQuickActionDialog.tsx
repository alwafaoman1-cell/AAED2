import {lazy,Suspense,useEffect,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useQuery,useQueryClient} from '@tanstack/react-query';
import {useAuth} from '@/contexts/AuthContext';
import {supabase} from '@/integrations/supabase/client';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {Button} from '@/components/ui/button';
import {VehicleVisitInlineActions} from '@/components/vehicle-entry/VehicleVisitInlineActions';
import {VehicleVisitControlPanel} from './VehicleVisitControlPanel';
import {ConfirmUnsavedVisitDialog} from '@/components/vehicle-entry/ConfirmUnsavedVisitDialog';
import '@/lib/i18n/vehicleVisitWorkspace';
import type {VehicleCenterActionRequest} from '@/lib/vehicleCenterPresentation';

const Intake=lazy(()=>import('./VehicleEntryForm'));
/** Exactly the same controller as the entry page, not a second stage machine. */
export function VehicleVisitQuickActionDialog({row,open,onOpenChange,workspace,onRequestHandover,onRequestWorkOrderStatus,onRequestClaimApproval,initialAction}: {
  row:any|null;open:boolean;onOpenChange:(value:boolean)=>void;workspace?:'supervisor';mode?:'location';onRequestHandover?:()=>void;onRequestWorkOrderStatus?:()=>void;onRequestClaimApproval?:()=>void;
  initialAction?:VehicleCenterActionRequest;
}){
  const {t,i18n}=useTranslation(),qc=useQueryClient();
  const {profile}=useAuth();
  const [savedEntryId,setSavedEntryId]=useState<string|null>(null),[intakeOpen,setIntakeOpen]=useState(false);
  const [dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[discardOpen,setDiscardOpen]=useState(false);
  useEffect(()=>{setSavedEntryId(null);setIntakeOpen(false);},[row?.id,open]);
  const entryId=savedEntryId||(!row?._claimOnly?row?.id:null);
  const claimQuery=useQuery({queryKey:['vehicle_visit','claim_actions',profile?.tenant_id,row?.claim?.id],enabled:open&&!entryId&&!!profile?.tenant_id&&!!row?.claim?.id,
    queryFn:async()=>{const {data,error}=await supabase.from('insurance_claims').select('id,tenant_id,vehicle_id,claim_number,status,estimated_amount,approved_amount').eq('tenant_id',profile!.tenant_id).eq('id',row.claim.id).is('deleted_at',null).single();if(error)throw error;return data;},staleTime:0,retry:false});
  const refresh=async()=>{await Promise.all([qc.invalidateQueries({queryKey:['vehicle_visit']}),qc.invalidateQueries({queryKey:['insurance_claims']})]);};
  return <Dialog open={open} onOpenChange={value=>{if(saving)return;if(!value&&dirty){setDiscardOpen(true);return;}onOpenChange(value);}}><DialogContent className="max-h-[92dvh] max-w-4xl overflow-y-auto" dir={i18n.dir()}>
    <DialogHeader><DialogTitle>{t('vehicleVisitWorkspace.workflow')} · <bdi>{row?.entry_number||row?.claim?.claim_number||'—'}</bdi></DialogTitle><DialogDescription>{t('vehicleVisitWorkspace.actions')}</DialogDescription></DialogHeader>
    {entryId?<VehicleVisitControlPanel key={entryId} entryId={entryId} compact initialAction={initialAction} supervisor={workspace==='supervisor'} onRequestHandover={onRequestHandover} onRequestWorkOrderStatus={onRequestWorkOrderStatus} onRequestClaimApproval={onRequestClaimApproval}/>:
      row&&<div className="space-y-3">
        <p className="text-sm text-muted-foreground">{t('vehicleVisitWorkspace.missingEntry')}</p>
        {claimQuery.isError?<p role="alert">{t('vehicleVisitWorkspace.failed')}</p>:claimQuery.data?<VehicleVisitInlineActions entry={{...row,claim:{...row.claim,...claimQuery.data}}} onChanged={refresh}/>:<p role="status">{t('vehicleVisitWorkspace.loading')}</p>}
        {!intakeOpen&&claimQuery.data&&!['cancelled','rejected'].includes(claimQuery.data.status)&&<Button variant="outline" onClick={()=>setIntakeOpen(true)}>{t('vehicleVisitWorkspace.prepareEntry')}</Button>}
        {intakeOpen&&<Suspense fallback={<p role="status">{t('vehicleVisitWorkspace.loading')}</p>}><Intake sourceClaimId={row.claim?.id} onDirtyChange={setDirty} onBusyChange={setSaving} onSaved={id=>{setDirty(false);setSavedEntryId(id);setIntakeOpen(false);void refresh();}}/></Suspense>}
      </div>}
    <ConfirmUnsavedVisitDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirm={()=>{setDiscardOpen(false);setDirty(false);onOpenChange(false);}}/>
  </DialogContent></Dialog>;
}
