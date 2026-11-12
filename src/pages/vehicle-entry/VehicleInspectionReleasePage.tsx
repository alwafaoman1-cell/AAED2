import {lazy,Suspense,useEffect,useRef,useState} from 'react';
import {useNavigate,useParams} from 'react-router-dom';
import {useMutation,useQuery,useQueryClient} from '@tanstack/react-query';
import {useTranslation} from 'react-i18next';
import {ArrowRight,Copy,Download,Link2,Loader2,MessageCircle,Printer,RefreshCw} from 'lucide-react';
import {toast} from 'sonner';
import {useAuth} from '@/contexts/AuthContext';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {Input} from '@/components/ui/input';
import {Checkbox} from '@/components/ui/checkbox';
import {Textarea} from '@/components/ui/textarea';
import {AlertDialog,AlertDialogAction,AlertDialogCancel,AlertDialogContent,AlertDialogDescription,AlertDialogHeader,AlertDialogTitle,AlertDialogFooter} from '@/components/ui/alert-dialog';
import {ConfirmUnsavedVisitDialog} from '@/components/vehicle-entry/ConfirmUnsavedVisitDialog';
import {InspectionReleaseChoiceField} from '@/components/vehicle-entry/InspectionReleaseChoiceField';
import {queryKeys} from '@/lib/queryKeys';
import {markClean,markDirty} from '@/lib/unsavedWork';
import {vehicleVisitActionTime} from '@/lib/vehicleVisitIntake';
import {getVehicleEntry,getVehicleEntryPresence} from '@/lib/vehicleEntryService';
import {getTemplateSettingsAsync} from '@/lib/pdfGenerator';
import {openAndPrintWindow,openSanitizedPdfWindow} from '@/lib/safePdfWindow';
import {openWhatsAppDraft} from '@/lib/messaging/messagingService';
import {prepareVehicleVisitMessage,type VehicleVisitMessageDraft} from '@/lib/messaging/vehicleVisitMessages';
import {buildInspectionReleaseHtml,downloadInspectionReleasePdf,emptyInspectionReleaseForm,getInspectionRelease,inspectionReleaseInitialForm,inspectionReleaseMissingFields,listInspectionReleases,markInspectionVehicleReturned,reopenInspectionRelease,saveInspectionRelease,type InspectionReleaseForm,type InspectionReleaseRecord} from '@/lib/vehicleInspectionRelease';
import '@/lib/i18n/inspectionRelease';
import {finalizeInspectionReleasePaper,inspectionReleaseSignatureMethod} from '@/lib/vehicleInspectionRelease';

const Messages=lazy(()=>import('@/components/supervisor/SupervisorVisitMessages'));
type Action='save'|'link'|'reopen'|'return'|'refresh'|'paper';
export default function VehicleInspectionReleasePage({workspace,entryId,onClose,onDirtyChange,onBusyChange,onReleased}:{workspace?:'supervisor';entryId?:string;onClose?:()=>void;onDirtyChange?:(value:boolean)=>void;onBusyChange?:(value:boolean)=>void;onReleased?:()=>void}={}){
  const {id:routeId}=useParams<{id:string}>(),id=entryId||routeId;
  const {profile,user}=useAuth(),{t,i18n}=useTranslation('inspectionRelease'),qc=useQueryClient(),navigate=useNavigate();
  const language=i18n.language.startsWith('en')?'en':'ar';
  const scope=JSON.stringify([profile?.tenant_id,user?.id,id]),currentScope=useRef(scope);currentScope.current=scope;
  useEffect(()=>()=>{currentScope.current='';},[]);
  const [form,setForm]=useState<InspectionReleaseForm>(emptyInspectionReleaseForm),[initializedFor,setInitializedFor]=useState<string|null>(null);
  const [dirty,setDirty]=useState(false),[newDraftMode,setNewDraftMode]=useState(false),[editRecipient,setEditRecipient]=useState(false);
  const [discardAction,setDiscardAction]=useState<'back'|'refresh'|null>(null),[returnOpen,setReturnOpen]=useState(false),[busyPdf,setBusyPdf]=useState(false);
  const [messageOpen,setMessageOpen]=useState(false),[messageDraft,setMessageDraft]=useState<VehicleVisitMessageDraft|null>(null),[confirmation,setConfirmation]=useState('');
  const lock=useRef(false);
  const [signatureMethod,setSignatureMethod]=useState<'electronic'|'paper'>('electronic'),[paperConfirmed,setPaperConfirmed]=useState(false);
  const [releasedAt,setReleasedAt]=useState(()=>new Date(Date.now()-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16));
  const initialReleaseTime=useRef(releasedAt),observedRelease=useRef<string|null>(null);
  const key=['vehicle_inspection_releases',profile?.tenant_id,id];
  const entryQuery=useQuery({queryKey:[...queryKeys.vehicleEntries.detail(id),profile?.tenant_id],queryFn:()=>getVehicleEntry(id!),enabled:!!id&&!!profile?.tenant_id,staleTime:30000});
  const releaseQuery=useQuery({queryKey:key,queryFn:()=>getInspectionRelease(id!),enabled:!!id&&!!profile?.tenant_id,staleTime:10000,refetchInterval:query=>query.state.data?.status==='awaiting_signature'?20000:false});
  const historyQuery=useQuery({queryKey:['vehicle_inspection_release_history',profile?.tenant_id,id],queryFn:()=>listInspectionReleases(id!),enabled:!!id&&!!profile?.tenant_id,staleTime:30000});
  const entry=entryQuery.data,release=newDraftMode?null:releaseQuery.data;
  useEffect(()=>{
    if(release?.status!=='signed'||release.returned_at||observedRelease.current===release.id)return;
    observedRelease.current=release.id;
    void qc.invalidateQueries({queryKey:queryKeys.vehicleEntries.all});
    void qc.invalidateQueries({queryKey:['vehicle_visit']});
    void qc.invalidateQueries({queryKey:queryKeys.insuranceClaims.all});
    void qc.invalidateQueries({queryKey:queryKeys.jobOrders.all});
    onReleased?.();
  },[release?.id,release?.status,release?.returned_at,qc,onReleased]);
  const initial=(record?:InspectionReleaseRecord|null)=>record?{...emptyInspectionReleaseForm,...record.form_data}:{...inspectionReleaseInitialForm(entry,language),staff_name:profile?.full_name||entry?.received_by_name||''};
  useEffect(()=>{
    if(!entry||!entryQuery.isSuccess||!releaseQuery.isSuccess||initializedFor===scope||entry.tenant_id!==profile?.tenant_id)return;
    setForm(releaseQuery.data?{...emptyInspectionReleaseForm,...releaseQuery.data.form_data}:{...inspectionReleaseInitialForm(entry,language),staff_name:profile?.full_name||entry.received_by_name||''});
    setInitializedFor(scope);setDirty(false);setMessageDraft(null);setMessageOpen(false);setConfirmation('');setNewDraftMode(false);setEditRecipient(false);
  },[scope,initializedFor,entry,entryQuery.isSuccess,releaseQuery.isSuccess,releaseQuery.data,profile?.tenant_id,profile?.full_name,language]);
  useEffect(()=>{onDirtyChange?.(dirty);return()=>onDirtyChange?.(false);},[dirty,onDirtyChange]);
  useEffect(()=>{const name=`vehicle-inspection-release:${id}`;if(dirty)markDirty(name);else markClean(name);return()=>markClean(name);},[id,dirty]);
  const refreshRelated=async()=>Promise.all([qc.invalidateQueries({queryKey:['vehicle_visit']}),qc.invalidateQueries({queryKey:queryKeys.vehicleEntries.all}),qc.invalidateQueries({queryKey:queryKeys.insuranceClaims.all}),qc.invalidateQueries({queryKey:queryKeys.jobOrders.all}),qc.invalidateQueries({queryKey:['vehicle_inspection_release_history']})]);
  const operation=useMutation({mutationFn:async(action:Action)=>{
    if(lock.current||!id||!entry||entry.tenant_id!==profile?.tenant_id||initializedFor!==scope)throw new Error(t('failed'));
    lock.current=true;const same=()=>currentScope.current===scope;
    try{
      let record=release;
      if(action==='paper'&&!paperConfirmed)throw new Error(t('paperRequired'));
      if(action==='save'||((action==='link'||action==='paper')&&(!record||record.status==='draft'))){
        record=await saveInspectionRelease(id,{...form});
        if(!same())throw new Error('SESSION_CHANGED_BEFORE_SAVE');
        qc.setQueryData(key,record);setForm({...emptyInspectionReleaseForm,...record.form_data});setNewDraftMode(false);setDirty(false);setConfirmation(`${t('saved')} · ${record.release_number}`);setMessageDraft(null);
      }
      if(action==='paper'){
        if(!record?.updated_at)throw new Error(t('failed'));
        record=await finalizeInspectionReleasePaper(record.id,record.updated_at,vehicleVisitActionTime(releasedAt,initialReleaseTime.current),paperConfirmed);
        const fresh=await entryQuery.refetch();
        if(fresh.error||!fresh.data||getVehicleEntryPresence(fresh.data)!=='with_customer')throw fresh.error||new Error(t('failed'));
        if(!same())throw new Error('SESSION_CHANGED_BEFORE_SAVE');
        qc.setQueryData(key,record);setPaperConfirmed(false);setConfirmation(`${t('paperSigned')} · ${record.release_number}`);
      }else if(action==='link'){
        if(!record)throw new Error(t('failed'));
        const draft=await prepareVehicleVisitMessage({entryId:id},record.status==='signed'?'temporary_release':'temporary_release_signature',language,profile!.tenant_id);
        if(!same())throw new Error('SESSION_CHANGED_BEFORE_SAVE');
        const fresh=await getInspectionRelease(id);
        if(!fresh||fresh.id!==record.id)throw new Error(t('failed'));
        qc.setQueryData(key,fresh);setMessageDraft(draft);setMessageOpen(true);setConfirmation(`${t('created')} · ${fresh.release_number}`);
      }else if(action==='reopen'){
        if(!record)throw new Error(t('failed'));
        record=await reopenInspectionRelease(record.id);
        if(!same())throw new Error('SESSION_CHANGED_BEFORE_SAVE');
        qc.setQueryData(key,record);setForm({...emptyInspectionReleaseForm,...record.form_data});setMessageDraft(null);setDirty(false);setConfirmation('');
      }else if(action==='return'){
        if(!record)throw new Error(t('failed'));
        record=await markInspectionVehicleReturned(record.id);
        const fresh=await entryQuery.refetch();
        if(fresh.error||!fresh.data||getVehicleEntryPresence(fresh.data)!=='in_workshop')throw fresh.error||new Error(t('failed'));
        if(!same())throw new Error('SESSION_CHANGED_BEFORE_SAVE');
        qc.setQueryData(key,record);setReturnOpen(false);setMessageDraft(null);setConfirmation(t('returned'));
      }else if(action==='refresh'){
        const [freshEntry,freshRelease]=await Promise.all([entryQuery.refetch(),releaseQuery.refetch()]);
        if(freshEntry.error||freshRelease.error||!freshEntry.data)throw freshEntry.error||freshRelease.error||new Error(t('failed'));
        if(!same())throw new Error('SESSION_CHANGED_BEFORE_SAVE');
        setInitializedFor(null);setDirty(false);setMessageDraft(null);
      }
      if(same())await refreshRelated();
      return {scope,action};
    }finally{lock.current=false;}
  },onSuccess:result=>{if(currentScope.current===result.scope)toast.success(t(result.action==='paper'?'paperSigned':result.action==='link'?'created':result.action==='return'?'returned':result.action==='refresh'?'refreshed':result.action==='reopen'?'reopened':'saved'));},onError:(error:Error)=>{if(currentScope.current===scope){toast.error(error.message||t('failed'));void releaseQuery.refetch();}}});
  const busy=operation.isPending||busyPdf;
  useEffect(()=>{onBusyChange?.(busy);return()=>onBusyChange?.(false);},[busy,onBusyChange]);
  function change(field:keyof InspectionReleaseForm,value:string){setForm(previous=>({...previous,[field]:value}));setDirty(true);setMessageDraft(null);setConfirmation('');}
  const leave=()=>onClose?onClose():navigate(workspace==='supervisor'?`/supervisor/entry/${id}/complete`:`/vehicle-entry/${id}`);
  const requestBack=()=>{if(busy)return;if(dirty)setDiscardAction('back');else leave();};
  async function pdf(action:'preview'|'print'|'download',record=release){
    if(!record||busy||dirty)return;
    const tab=action==='preview'?window.open('','_blank'):null;if(action==='preview'&&!tab){toast.error(t('failed'));return;}
    setBusyPdf(true);
    try{await getTemplateSettingsAsync();const fresh=await entryQuery.refetch();if(fresh.error||!fresh.data)throw fresh.error||new Error(t('failed'));
      const html=buildInspectionReleaseHtml(record,fresh.data.vehicle_media||[],language);
      if(action==='preview')openSanitizedPdfWindow(html,tab);else if(action==='print')await openAndPrintWindow(html);else await downloadInspectionReleasePdf(html,record.release_number);
    }catch(error){tab?.close();toast.error(error instanceof Error?error.message:t('failed'));}finally{setBusyPdf(false);}
  }
  if(entryQuery.isError||releaseQuery.isError)return <div role="alert" className="space-y-3 p-4 text-destructive"><p>{t('failed')}</p><Button variant="outline" onClick={()=>{void entryQuery.refetch();void releaseQuery.refetch();}}>{t('retry')}</Button></div>;
  if(!entry||initializedFor!==scope||entry.tenant_id!==profile?.tenant_id)return <p role="status" className="flex items-center gap-2 p-6"><Loader2 className="h-5 w-5 animate-spin"/>{t('loading')}</p>;
  const locked=!!release&&release.status!=='draft',missing=inspectionReleaseMissingFields(form);
  const entryCanRelease=['Received','Issued','Converted to Claim','Converted to Work Order'].includes(entry.status);
  const customer={...entry.customer,...entry.customer_snapshot},vehicle={...entry.vehicle,...entry.vehicle_snapshot};
  const identityMissing=['recipient_name','recipient_id_number','recipient_phone'].some(key=>!form[key as keyof InspectionReleaseForm].trim());
  const link=messageDraft?.url;
  const choice=(field:keyof InspectionReleaseForm,required=false,multiple=false)=><InspectionReleaseChoiceField field={field} value={form[field]} disabled={locked||busy} required={required} multiple={multiple} onChange={value=>change(field,value)}/>;
  return <div className="mx-auto max-w-5xl space-y-4 p-3 md:p-4" dir={i18n.dir()}>
    <header className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Button size="icon" variant="ghost" disabled={busy} aria-label={t('back')} onClick={requestBack}><ArrowRight className="h-5 w-5 ltr:rotate-180"/></Button><div><h1 className="text-xl font-bold">{t('title')}</h1><bdi className="text-sm text-muted-foreground">{release?.release_number||entry.entry_number}</bdi></div></div>
      <div className="flex flex-wrap gap-2">{(['preview','print','download'] as const).map(action=><Button key={action} variant="outline" disabled={!release||busy||dirty} onClick={()=>void pdf(action)}>{action==='print'?<Printer className="me-2 h-4 w-4"/>:action==='download'?<Download className="me-2 h-4 w-4"/>:null}{t(action)}</Button>)}</div>
    </header>
    <Card className="space-y-2 p-4 text-sm"><strong>{t('source')}: <bdi>{entry.entry_number}</bdi></strong><p>{t('customer')}: {customer.name||'—'} · {t('vehicle')}: {[vehicle.make||vehicle.brand,vehicle.model,vehicle.plate_letters,vehicle.plate_number].filter(Boolean).join(' ')}</p><p className="text-muted-foreground">{t('scopeHint')}</p><p>{t(getVehicleEntryPresence(entry)==='in_workshop'?'inside':getVehicleEntryPresence(entry)==='with_customer'?'withCustomer':'locationReview')}</p>{!entryCanRelease&&<p role="alert" className="text-destructive">{t('draftRequired')}</p>}</Card>
    <Card className="space-y-5 p-4"><div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">{t('findings')}</h2><span className="text-sm text-muted-foreground">{t(release?.status==='signed'?'signed':release?.status==='awaiting_signature'?'awaiting':'draft')}</span></div>{choice('inspection_summary',true)}{choice('pending_action',true)}{choice('exit_condition',true)}</Card>
    <Card className="space-y-3 p-4"><div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold">{t('recipient')}</h2><Button variant="outline" disabled={busy||locked} onClick={()=>setEditRecipient(!editRecipient)} aria-expanded={editRecipient||identityMissing}>{t('editRecipient')}</Button></div>
      <p className="text-sm">{form.recipient_name||t('required')} · <bdi>{form.recipient_phone||t('required')}</bdi> · {t('fields.recipient_id_number')}: <bdi>{form.recipient_id_number||t('required')}</bdi></p>
      {(editRecipient||identityMissing)&&<div className="grid gap-3 sm:grid-cols-2">{(['recipient_name','recipient_id_number','recipient_phone','staff_name'] as const).map(field=><label key={field} className="block space-y-1 text-sm">{t(`fields.${field}`)}<Input aria-label={t(`fields.${field}`)} value={form[field]} maxLength={field==='recipient_id_number'||field==='recipient_phone'?80:160} disabled={busy||locked} onChange={event=>change(field,event.target.value)}/></label>)}</div>}
      {choice('recipient_relation')}
      <fieldset disabled={busy||locked} className="space-y-2"><legend className="text-sm font-semibold">{t('keys')}</legend><div className="flex flex-wrap gap-2">{['0','1','2','3'].map(value=><Button key={value} type="button" variant={form.keys_handed_over===value?'default':'outline'} aria-pressed={form.keys_handed_over===value} disabled={busy||locked} onClick={()=>change('keys_handed_over',value)}>{value}</Button>)}<Input aria-label={t('keys')} className="w-24" value={form.keys_handed_over} maxLength={100} disabled={busy||locked} onChange={event=>change('keys_handed_over',event.target.value)}/></div></fieldset>
    </Card>
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">{t('more')}</summary><div className="mt-4 space-y-5">{choice('inspected_items',false,true)}{choice('uninspected_items',false,true)}{choice('visible_damage')}{(['contents_handed_over','notes'] as const).map(field=><label key={field} className="block space-y-1 text-sm">{t(`fields.${field}`)}<Textarea aria-label={t(`fields.${field}`)} rows={2} disabled={locked||busy} maxLength={field==='notes'?1500:1000} value={form[field]} onChange={event=>change(field,event.target.value)}/></label>)}</div></details>
    <Card className="space-y-3 p-4"><p className="text-sm text-muted-foreground">{t('linkHint')}</p>{missing.length>0&&<p role="status" className="text-sm text-warning">{t('missing')} {missing.map(field=>t(`fields.${field}`)).join(' · ')}</p>}
      {!locked&&<fieldset className="space-y-3" disabled={busy}>
        <legend className="mb-2 text-sm font-semibold">{t('signatureMethod')}</legend>
        <div className="flex flex-wrap gap-2">{(['electronic','paper'] as const).map(method=><Button key={method} type="button" variant={signatureMethod===method?'default':'outline'} aria-pressed={signatureMethod===method} onClick={()=>{setSignatureMethod(method);setPaperConfirmed(false);}}>{t(method)}</Button>)}</div>
        {signatureMethod==='paper'&&<div className="space-y-3 rounded-lg border border-border p-3">
          <p className="text-sm text-muted-foreground">{t('paperHint')}</p>
          <label className="block space-y-1 text-sm">{t('releasedAt')}<Input type="datetime-local" value={releasedAt} onChange={e=>setReleasedAt(e.target.value)}/></label>
          <label className="flex items-start gap-2 text-sm"><Checkbox checked={paperConfirmed} onCheckedChange={value=>setPaperConfirmed(value===true)}/>{t('paperConfirm')}</label>
        </div>}
      </fieldset>}
      <div className="flex flex-wrap gap-2">{!locked&&<Button variant="outline" disabled={busy||!entryCanRelease} onClick={()=>operation.mutate('save')}>{t('save')}</Button>}
        {signatureMethod==='paper'&&!locked?<Button className="h-auto min-h-11 whitespace-normal" disabled={busy||!entryCanRelease||missing.length>0||!paperConfirmed||!form.staff_name.trim()||!!release?.returned_at} onClick={()=>operation.mutate('paper')}>{operation.isPending&&<Loader2 className="me-2 h-4 w-4 animate-spin"/>}{t('paperFinalize')}</Button>:<Button className="h-auto min-h-11 whitespace-normal" disabled={busy||!entryCanRelease||missing.length>0||!!release?.returned_at} onClick={()=>operation.mutate('link')}>{operation.isPending?<Loader2 className="me-2 h-4 w-4 animate-spin"/>:<Link2 className="me-2 h-4 w-4"/>}{t(release?.status==='signed'?'viewLink':release?.status==='awaiting_signature'?'regenerate':release?'createLink':'saveAndLink')}</Button>}
        {release?.status==='awaiting_signature'&&<Button variant="outline" disabled={busy} onClick={()=>operation.mutate('reopen')}>{t('reopen')}</Button>}
        <Button variant="outline" disabled={busy} onClick={()=>{if(dirty)setDiscardAction('refresh');else operation.mutate('refresh');}}><RefreshCw className="me-2 h-4 w-4"/>{t('retry')}</Button>
        <Button variant="outline" disabled={busy||dirty||!release} onClick={()=>setMessageOpen(!messageOpen)} aria-expanded={messageOpen}><MessageCircle className="me-2 h-4 w-4"/>{t('messages')}</Button>
      </div>
      {confirmation&&<p role="status" className="rounded-lg border border-success/30 bg-success/5 p-3 text-sm text-success">{confirmation}</p>}{dirty&&<p className="text-sm text-warning">{t('unsaved')}</p>}
      {link&&<div className="space-y-2"><p className="break-all rounded-lg bg-muted p-2 text-sm" dir="ltr">{link}</p><div className="flex flex-wrap gap-2"><Button variant="outline" onClick={async()=>{try{await navigator.clipboard.writeText(link);toast.success(t('copied'));}catch{toast.error(t('failed'));}}}><Copy className="me-2 h-4 w-4"/>{t('copy')}</Button><Button variant="outline" onClick={()=>{if(messageDraft)openWhatsAppDraft({phone:messageDraft.recipientPhone,text:messageDraft.body});}}>{t('external')}</Button></div><p className="text-sm text-muted-foreground">{t('externalHint')}</p></div>}
    </Card>
    {messageOpen&&!dirty&&release&&<Card className="p-4"><Suspense fallback={<p role="status">{t('loading')}</p>}><Messages key={messageDraft?.idempotencyKey||`${scope}:${release.id}:${release.status}`} entryId={id} initialDraft={messageDraft} initialKind={release.status==='signed'?'temporary_release':'temporary_release_signature'}/></Suspense></Card>}
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">{t('signature')}</summary><p className="mt-3 whitespace-pre-wrap text-sm">{(language==='en'?release?.declaration_en:release?.declaration_ar)||t('noSignature')}</p>{release?.signature_data_url&&<img src={release.signature_data_url} alt={t('signature')} className="mt-2 h-16 object-contain"/>}</details>
    {release?.status==='signed'&&<Card className="space-y-3 p-4"><p className="text-sm">{t(inspectionReleaseSignatureMethod(release)==='paper'?'paperSigned':'signed')} · {release.signer_name} · <time dateTime={release.signed_at||undefined}>{release.signed_at?new Date(release.signed_at).toLocaleString(language==='en'?'en-GB':'ar-OM'):''}</time></p>{release.returned_at?<Button variant="outline" disabled={busy} onClick={()=>{setForm(initial());setNewDraftMode(true);setDirty(true);setMessageDraft(null);setConfirmation('');setPaperConfirmed(false);}}>{t('newReport')}</Button>:<Button variant="outline" disabled={busy} onClick={()=>setReturnOpen(true)}>{t('return')}</Button>}</Card>}
    <details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">{t('evidence')} ({entry.vehicle_media?.length||0})</summary><p className="mt-2 text-sm text-muted-foreground">{t('samePhotos')}</p>{entry.damage_marks?.map((mark:any)=><p key={mark.mark_number} className="text-sm">#{mark.mark_number} · {mark.vehicle_part} · {mark.description||mark.notes}</p>)}<div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">{(entry.vehicle_media||[]).filter((photo:any)=>photo.media_type==='image'&&(!release||release.photo_media_ids?.includes(photo.id))).map((photo:any)=><img key={photo.id} loading="lazy" src={photo.url||photo.public_url} alt={photo.category||photo.file_name||t('evidence')} className="aspect-[4/3] w-full rounded-lg border border-border object-contain"/>)}</div></details>
    {!!historyQuery.data?.length&&<details className="rounded-xl border border-border p-4"><summary className="cursor-pointer font-semibold">{t('history')} ({historyQuery.data.length})</summary>{historyQuery.data.map(record=><div key={record.id} className="mt-3 flex flex-wrap items-center justify-between gap-2 text-sm"><bdi>{record.release_number}</bdi><span>{t(record.status==='signed'?'signed':record.status==='awaiting_signature'?'awaiting':'draft')}</span><Button variant="outline" disabled={busy||dirty} onClick={()=>void pdf('preview',record)}>{t('view')}</Button></div>)}</details>}
    <ConfirmUnsavedVisitDialog open={!!discardAction} onOpenChange={open=>{if(!open)setDiscardAction(null);}} onConfirm={()=>{const action=discardAction;setDiscardAction(null);if(action==='back')leave();else operation.mutate('refresh');}}/>
    <AlertDialog open={returnOpen} onOpenChange={open=>{if(!busy)setReturnOpen(open);}}><AlertDialogContent dir={i18n.dir()}><AlertDialogHeader><AlertDialogTitle>{t('confirmReturn')}</AlertDialogTitle><AlertDialogDescription>{t('returnHint')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={busy}>{t('back')}</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={event=>{event.preventDefault();operation.mutate('return');}}>{t('return')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
