import {forwardRef,lazy,Suspense,useImperativeHandle,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useMutation} from '@tanstack/react-query';
import {Loader2,LogIn,LogOut} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/contexts/AuthContext';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle} from '@/components/ui/dialog';
import {ConfirmUnsavedVisitDialog} from './ConfirmUnsavedVisitDialog';
import {getVehicleEntryPresence} from '@/lib/vehicleEntryService';
import {isVehicleVisitAwaitingArrival,vehicleVisitActionTime} from '@/lib/vehicleVisitIntake';
import {getVehicleVisitDetail,getVehicleCenterTab,registerVehicleVisitArrival,type VehicleVisitItem} from '@/lib/vehicleVisitLifecycle';
import {markInspectionVehicleReturned} from '@/lib/vehicleInspectionRelease';
import '@/lib/i18n/vehicleVisitWorkspace';

const ReleasePage=lazy(()=>import('@/pages/vehicle-entry/VehicleInspectionReleasePage'));
type Visit=VehicleVisitItem&{releases?:Array<{id:string;status:string;returned_at:string|null}>};
export type VehicleVisitLocationHandle={openArrival:()=>void};
export const VehicleVisitLocationPanel=forwardRef<VehicleVisitLocationHandle,{visit:Visit;onChanged:()=>Promise<unknown>|void;onManagerLocation?:(presence:'in_workshop'|'with_customer')=>void}>(function VehicleVisitLocationPanel({visit,onChanged,onManagerLocation},ref){
  const {t}=useTranslation(),{hasRole}=useAuth();
  const [confirmed,setConfirmed]=useState(false),[releaseOpen,setReleaseOpen]=useState(false),[entryOpen,setEntryOpen]=useState(false);
  const [releaseDirty,setReleaseDirty]=useState(false),[discardOpen,setDiscardOpen]=useState(false);
  const [releaseBusy,setReleaseBusy]=useState(false);
  const [occurredAt,setOccurredAt]=useState(()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
  const initialTime=useRef(occurredAt);
  const presence=getVehicleEntryPresence(visit.entry);
  const pending=isVehicleVisitAwaitingArrival(visit.entry);
  const release=visit.releases?.find(r=>r.status==='signed'&&!r.returned_at);
  const canManage=hasRole('admin','manager','insurance','supervisor');
  const terminal=['delivered','cancelled'].includes(visit.operationalStage);
  const managerOverride=Boolean(onManagerLocation)&&hasRole('admin','manager');
  // Confirming a prepared visit's real arrival may resolve the old claim's
  // inside/default marker. Never permit other link, identity or history conflicts.
  const arrivalBlocked=Boolean(visit.reviewReason&&!(pending&&visit.reviewReason==='custody_conflict'));
  const enter=useMutation({mutationFn:async()=>{
    if(!canManage||!confirmed||arrivalBlocked||terminal)throw new Error(t('vehicleVisitWorkspace.locationReview'));
    if(pending)await registerVehicleVisitArrival(visit.entry.id,visit.entry.updated_at,vehicleVisitActionTime(occurredAt,initialTime.current));
    else if(release){
      const fresh=await getVehicleVisitDetail(visit.entry.id,{includeOperationalFile:false});
      if(!fresh||fresh.reviewReason||getVehicleCenterTab({...fresh,hasSignedTemporaryRelease:true})!=='with_customer'
        ||!fresh.releases.some(r=>r.id===release.id&&r.status==='signed'&&!r.returned_at))throw new Error(t('vehicleVisitWorkspace.locationReview'));
      const saved=await markInspectionVehicleReturned(release.id);
      const readback=await getVehicleVisitDetail(visit.entry.id,{includeOperationalFile:false});
      if(!readback||getVehicleEntryPresence(readback.entry)!=='in_workshop'
        ||!readback.releases.some(r=>r.id===release.id&&r.returned_at===saved.returned_at))throw new Error(t('vehicleVisitWorkspace.failed'));
    }
    else throw new Error(t('vehicleVisitWorkspace.locationReview'));
    await onChanged();setConfirmed(false);setEntryOpen(false);
  },onSuccess:()=>toast.success(t('vehicleVisitWorkspace.saved')),onError:(e:Error)=>{toast.error(e.message);void onChanged();}});
  const canEnter=(presence==='with_customer'||pending)&&(pending||release)&&!terminal&&!arrivalBlocked&&canManage;
  const canExit=presence==='in_workshop'&&!terminal&&canManage&&!visit.reviewReason;
  useImperativeHandle(ref,()=>({openArrival:()=>{if(managerOverride){onManagerLocation?.('in_workshop');}else if(canEnter){setConfirmed(false);setEntryOpen(true);}}}),[canEnter,managerOverride,onManagerLocation]);
  const refreshAfterExit=()=>{setReleaseOpen(false);void Promise.resolve().then(onChanged).catch(()=>toast.error(t('vehicleVisitWorkspace.failed')));};
  return <section className="space-y-3 rounded-lg border border-border p-3" aria-label={t('vehicleVisitWorkspace.location')}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <strong className="text-sm">{t('vehicleVisitWorkspace.location')}: {t(presence==='in_workshop'?'vehicleEntry.workshopTab':presence==='with_customer'?'vehicleEntry.customerTab':'vehicleEntry.reviewLocation')}</strong>
    </div>
    {!terminal&&<div className="flex flex-wrap gap-2" role="group" aria-label={t('vehicleVisitWorkspace.chooseLocation')}>
      <Button size="sm" variant={presence==='in_workshop'?'default':'outline'} aria-pressed={presence==='in_workshop'} disabled={!managerOverride&&!canEnter} onClick={()=>{if(managerOverride)onManagerLocation?.('in_workshop');else{setConfirmed(false);setEntryOpen(true);}}}><LogIn className="me-2 h-4 w-4"/>{t('vehicleEntry.workshopTab')}</Button>
      <Button size="sm" variant={presence==='with_customer'?'default':'outline'} aria-label={!managerOverride&&canExit?t('vehicleVisitWorkspace.temporaryExit'):t('vehicleEntry.customerTab')} aria-pressed={presence==='with_customer'} disabled={!managerOverride&&!canExit} onClick={()=>{if(managerOverride)onManagerLocation?.('with_customer');else setReleaseOpen(true);}}><LogOut className="me-2 h-4 w-4"/>{t('vehicleEntry.customerTab')}{!managerOverride&&canExit?` · ${t('vehicleVisitWorkspace.temporaryExit')}`:''}</Button>
    </div>}
    {pending&&!terminal&&<p className="text-sm text-muted-foreground">{t('vehicleVisitWorkspace.arrivalPending')}</p>}
    <Dialog open={entryOpen} onOpenChange={open=>{if(!enter.isPending)setEntryOpen(open);}}><DialogContent><DialogHeader><DialogTitle>{t('vehicleVisitWorkspace.confirmEntry')}</DialogTitle><DialogDescription>{t('vehicleVisitWorkspace.location')}</DialogDescription></DialogHeader>
    {canEnter&&<div className="space-y-3">
      {pending&&<label className="block space-y-1 text-sm">{t('vehicleVisitWorkspace.arrivalTime')}<Input type="datetime-local" value={occurredAt} max={new Date(Date.now()+300000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16)} onChange={e=>setOccurredAt(e.target.value)} disabled={enter.isPending}/></label>}
      <label className="flex items-center gap-2 text-sm"><Checkbox checked={confirmed} disabled={enter.isPending} onCheckedChange={v=>setConfirmed(v===true)}/>{t('vehicleVisitWorkspace.confirmPresent')}</label>
      <Button className="bg-success text-success-foreground hover:bg-success/90" disabled={!confirmed||enter.isPending||!occurredAt} onClick={()=>enter.mutate()}>
        {enter.isPending?<Loader2 className="me-2 h-4 w-4 animate-spin"/>:<LogIn className="me-2 h-4 w-4"/>}{t('vehicleVisitWorkspace.register')}
      </Button>
    </div>}
    </DialogContent></Dialog>
    {visit.reviewReason&&<p className="text-sm text-warning">{t('vehicleVisitWorkspace.locationReview')}</p>}
    <Dialog open={releaseOpen} onOpenChange={open=>{if(releaseBusy)return;if(!open&&releaseDirty){setDiscardOpen(true);return;}setReleaseOpen(open);}}><DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto">
      <DialogHeader><DialogTitle>{t('vehicleVisitWorkspace.temporaryExit')}</DialogTitle><DialogDescription>{t('vehicleVisitWorkspace.actions')}</DialogDescription></DialogHeader>
      <Suspense fallback={<p role="status">{t('vehicleVisitWorkspace.loading')}</p>}><ReleasePage entryId={visit.entry.id} onBusyChange={setReleaseBusy} onDirtyChange={setReleaseDirty} onClose={refreshAfterExit} onReleased={refreshAfterExit}/></Suspense>
    </DialogContent></Dialog>
    <ConfirmUnsavedVisitDialog open={discardOpen} onOpenChange={setDiscardOpen} onConfirm={()=>{setDiscardOpen(false);setReleaseOpen(false);}}/>
  </section>;
});
