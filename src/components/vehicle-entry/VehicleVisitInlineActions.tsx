import { isVehicleReviewVisit } from "@/lib/vehicleReviewVisit";
import {forwardRef,lazy,Suspense,useImperativeHandle,useRef,useState} from 'react';
import {useTranslation} from 'react-i18next';
import {useMutation} from '@tanstack/react-query';
import {Loader2,ShieldCheck,XCircle,Wrench} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/contexts/AuthContext';
import {useWorkflowRequirements} from '@/hooks/useWorkflowRequirements';
import {useUpdateClaimStatus} from '@/hooks/useInsuranceClaims';
import {SupervisorClaimApproval} from '@/components/supervisor/SupervisorClaimApproval';
import {Button} from '@/components/ui/button';
import {Textarea} from '@/components/ui/textarea';
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from '@/components/ui/dialog';
import {convertVehicleEntryToClaim,createWorkOrderFromVehicleEntry,getVehicleVisitBillingKind} from '@/lib/vehicleEntryService';
import {type WorkOrder} from '@/lib/workOrdersStore';
import {resolveWorkOrderListAction} from '@/lib/workOrderListActions';
import '@/lib/i18n/vehicleVisitWorkspace';

const StatusDialog=lazy(()=>import('@/components/workorders/WorkOrderStatusDialog'));
const DeliveryDialog=lazy(()=>import('@/components/workorders/VehicleDeliveryReceiptDialog'));

/** Reuses the approved source mutations; never duplicates approval, billing or
 * work-order creation rules, and never navigates away after a mutation. */
export type VehicleVisitInlineActionHandle={openOrderAction:(action:'status'|'delivery')=>void;openApproval:()=>void};
export const VehicleVisitInlineActions=forwardRef<VehicleVisitInlineActionHandle,{entry:any;onChanged:()=>Promise<unknown>|void;hideDeliveryAction?:boolean}>(function VehicleVisitInlineActions({entry,onChanged,hideDeliveryAction=false},ref){
  const {t}=useTranslation();
  const {hasRole,profile,user}=useAuth();
  const {requirementsEnabled}=useWorkflowRequirements();
  const [approvalOpen,setApprovalOpen]=useState(false),[cancelOpen,setCancelOpen]=useState(false);
  const [reason,setReason]=useState('');
  const [activeOrder,setActiveOrder]=useState<WorkOrder|null>(null);
  const [orderAction,setOrderAction]=useState<'status'|'delivery'|null>(null);
  const lock=useRef(false);
  const claim=entry?.claim||entry?.converted_claim,order=entry?.work_order||entry?.converted_work_order;
  const insurance=getVehicleVisitBillingKind(entry)==='insurance';
  const manager=hasRole('admin','manager');
  const canPrepare=hasRole('admin','manager','insurance','supervisor');
  const closed=['cancelled','rejected','paid'].includes(claim?.status)||entry?.status==='Cancelled';
  const update=useUpdateClaimStatus({notify:false});
  const operation=useMutation({
    mutationFn:async(action:'claim'|'order'|'cancel'|'status'|'delivery')=>{
      if(isVehicleReviewVisit(entry)) throw new Error(t('vehicleVisitWorkspace.readOnly'));
      if(lock.current) throw new Error(t('vehicleVisitWorkspace.failed'));
      lock.current=true;
      try{
        if(action==='cancel'){
          if(!manager||!claim||!['pending','approved'].includes(claim.status)||!reason.trim())throw new Error(t('vehicleVisitWorkspace.readOnly'));
          const saved:any=await update.mutateAsync({id:claim.id,status:'cancelled',rejection_reason:reason.trim(),expected_status:claim.status});
          if(saved.id!==claim.id||saved.tenant_id!==profile?.tenant_id||saved.status!=='cancelled')throw new Error(t('vehicleVisitWorkspace.failed'));
        }else if(action==='claim'||action==='order'){
          if(!canPrepare||entry?._claimOnly||closed)throw new Error(t('vehicleVisitWorkspace.readOnly'));
          if(action==='claim'){
            const saved=await convertVehicleEntryToClaim(entry.id,user?.id);
            if(!saved.claim_id)throw new Error(t('vehicleVisitWorkspace.failed'));
          }else{
            const saved=await createWorkOrderFromVehicleEntry(entry.id,user?.id);
            if(!saved.work_order_id)throw new Error(t('vehicleVisitWorkspace.failed'));
          }
        }else{
          if(!order?.id||!(action==='delivery'?hasRole('admin','manager','supervisor'):hasRole('admin','manager','supervisor','technician')))throw new Error(t('vehicleVisitWorkspace.readOnly'));
          if(requirementsEnabled&&action==='delivery'&&!['completed','delivered'].includes(order.status))throw new Error(t('vehicleVisitWorkspace.deliveryConflict'));
          const full=await resolveWorkOrderListAction(order.id,profile?.tenant_id||'');
          if(!full||full.cloudId!==order.id||full.vehicleId!==entry.vehicle_id)throw new Error(t('vehicleVisitWorkspace.failed'));
          setActiveOrder(full);setOrderAction(action);return;
        }
        await onChanged();
        setCancelOpen(false);setReason('');
        toast.success(t('vehicleVisitWorkspace.saved'));
      }finally{lock.current=false;}
    },
    onError:(error:Error)=>{toast.error(error.message);void onChanged();},
  });
  const {mutate:requestOrderAction}=operation;
  useImperativeHandle(ref,()=>({
    openOrderAction:action=>{if(!lock.current)requestOrderAction(action);},
    openApproval:()=>{if(manager&&claim?.status==='pending'&&!operation.isPending){setApprovalOpen(true);setCancelOpen(false);}},
  }),[requestOrderAction,manager,claim?.status,operation.isPending]);
  if (isVehicleReviewVisit(entry)) return null;
  return <section className="space-y-3" aria-label={t('vehicleVisitWorkspace.actions')}>
    {['cancelled','rejected'].includes(claim?.status)&&<p role="status" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">{t('vehicleVisitWorkspace.cancelled')} · {t('vehicleVisitWorkspace.cancelledHint')}</p>}
    <div className="flex flex-wrap gap-2">
      {!entry?._claimOnly&&!closed&&insurance&&!claim&&canPrepare&&<Button variant="outline" disabled={operation.isPending} onClick={()=>operation.mutate('claim')}><ShieldCheck className="me-2 h-4 w-4"/>{t('vehicleVisitWorkspace.createClaim')}</Button>}
      {claim?.status==='pending'&&manager&&<Button className="bg-success text-success-foreground hover:bg-success/90" aria-expanded={approvalOpen} disabled={operation.isPending} onClick={()=>{setApprovalOpen(!approvalOpen);setCancelOpen(false);}}><ShieldCheck className="me-2 h-4 w-4"/>{t('vehicleVisitWorkspace.approval')}</Button>}
      {!entry?._claimOnly&&!closed&&!order&&canPrepare&&(!insurance||(!requirementsEnabled&&claim?.id)||['approved','paid'].includes(claim?.status))&&<Button variant="outline" disabled={operation.isPending} onClick={()=>operation.mutate('order')}><Wrench className="me-2 h-4 w-4"/>{t('vehicleVisitWorkspace.createOrder')}</Button>}
      {order&&!closed&&hasRole('admin','manager','supervisor','technician')&&order.status!=='delivered'&&<Button variant="outline" disabled={operation.isPending} onClick={()=>operation.mutate('status')}>{t('vehicleVisitWorkspace.repairStatus')}</Button>}
      {!hideDeliveryAction&&order&&(!requirementsEnabled||['completed','delivered'].includes(order.status))&&hasRole('admin','manager','supervisor')&&<Button variant="outline" disabled={operation.isPending} onClick={()=>operation.mutate('delivery')}>{t('vehicleVisitWorkspace.delivery')}</Button>}
      {claim&&['pending','approved'].includes(claim.status)&&manager&&<Button variant="outline" className="text-destructive hover:text-destructive" aria-expanded={cancelOpen} disabled={operation.isPending} onClick={()=>{setCancelOpen(!cancelOpen);setApprovalOpen(false);}}><XCircle className="me-2 h-4 w-4"/>{t('vehicleVisitWorkspace.cancelClaim')}</Button>}
      {operation.isPending&&<Loader2 role="status" aria-label={t('vehicleVisitWorkspace.loading')} className="h-5 w-5 animate-spin"/>}
    </div>
    {approvalOpen&&claim?.status==='pending'&&<SupervisorClaimApproval claimId={claim.id} onApproved={()=>{setApprovalOpen(false);void onChanged();}}/>}
    {cancelOpen&&<form className="space-y-3 rounded-lg border border-destructive/30 p-3" onSubmit={e=>{e.preventDefault();if(!operation.isPending)operation.mutate('cancel');}}>
      <p className="text-sm text-muted-foreground">{t('vehicleVisitWorkspace.cancelHint')}</p>
      <label className="block space-y-2 text-sm">{t('vehicleVisitWorkspace.reason')}<Textarea required maxLength={1000} value={reason} onChange={e=>setReason(e.target.value)} disabled={operation.isPending}/></label>
      <Button type="submit" variant="destructive" disabled={operation.isPending||!reason.trim()}>{t('vehicleVisitWorkspace.confirmCancel')}</Button>
    </form>}
    <Suspense fallback={<p role="status">{t('vehicleVisitWorkspace.loading')}</p>}>
      {activeOrder&&orderAction==='status'&&<StatusDialog order={activeOrder} cloudJobOrderId={order.id} open onOpenChange={open=>{if(!open){setOrderAction(null);setActiveOrder(null);}}} onUpdated={()=>{setOrderAction(null);setActiveOrder(null);void onChanged();}} onRequestHandover={()=>setOrderAction('delivery')}/>}
      {activeOrder&&orderAction==='delivery'&&<Dialog open onOpenChange={open=>{if(!open){setOrderAction(null);setActiveOrder(null);}}}><DialogContent className="max-h-[92dvh] min-w-0 max-w-5xl overflow-y-auto">
        <DialogHeader className="sr-only"><DialogTitle>{t('vehicleVisitWorkspace.delivery')}</DialogTitle><DialogDescription>{t('vehicleVisitWorkspace.actions')}</DialogDescription></DialogHeader>
        <DeliveryDialog open presentation="page" order={activeOrder} onOpenChange={open=>{if(!open){setOrderAction(null);setActiveOrder(null);}}} onFinalized={()=>{setOrderAction(null);setActiveOrder(null);void onChanged();}}/>
      </DialogContent></Dialog>}
    </Suspense>
  </section>;
});
