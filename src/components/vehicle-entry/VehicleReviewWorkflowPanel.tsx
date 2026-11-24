import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import ElectronicSignaturePad from "@/components/ElectronicSignaturePad";
import VehicleIntakeReceiptCheck from "./VehicleIntakeReceiptCheck";
import { VehicleReviewReturnAction } from "./VehicleReviewReturnAction";
import { advanceVehicleVisit, getVehicleVisitDetail } from "@/lib/vehicleVisitLifecycle";
import { deliverReviewVisit, getReviewVisitContext, getReviewVisitIntakeSignatureState } from "@/lib/vehicleReviewVisit";
import { vehicleRunningStatusLabel } from "@/lib/vehicleRunningStatus";
import { formatWorkshopDateTimeInput, parseWorkshopDateTimeInput } from "@/lib/vehicleVisitManager";
import { VehicleVisitManagerControls } from "./VehicleVisitManagerControls";
import { useWorkflowRequirements } from "@/hooks/useWorkflowRequirements";

export function VehicleReviewWorkflowPanel({ visit, onChanged }: { visit: any; onChanged: () => Promise<unknown> }) {
  const { requirementsEnabled } = useWorkflowRequirements();
  const qc = useQueryClient();
  const { i18n } = useTranslation(); const { user, hasRole } = useAuth();
  const text = (ar: string, en: string) => i18n.language.startsWith("en") ? en : ar;
  const entry = visit.entry, meta = entry.vehicle_condition.review_return;
  const stage = visit.workflow?.stage || visit.stage;
  const context = useQuery({ queryKey: ["review-visit-context", entry.id], queryFn: () => getReviewVisitContext(entry.id) });
  const signatureState = useQuery({ queryKey: ["vehicle_entries", "review-intake-signature", entry.id, entry.intake_revision], queryFn: () => getReviewVisitIntakeSignatureState(entry.id), enabled: !["delivered", "cancelled"].includes(stage) });
  const hasCurrentSignature = Number.isSafeInteger(entry.intake_revision) && signatureState.data?.revision === entry.intake_revision && signatureState.data?.signed === true;
  const [notes, setNotes] = useState(""); const [busy, setBusy] = useState(false);
  const [delivery, setDelivery] = useState(false); const [recipient, setRecipient] = useState("");
  const [signature, setSignature] = useState(""); const [receipt, setReceipt] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false); const lock = useRef(false); const request = useRef(crypto.randomUUID());
  const [occurredAt, setOccurredAt] = useState(() => formatWorkshopDateTimeInput(new Date().toISOString()));
  const [deliveryAt, setDeliveryAt] = useState(() => formatWorkshopDateTimeInput(new Date().toISOString()));
  const initialOccurredAt = useRef(occurredAt), initialDeliveryAt = useRef(deliveryAt);
  useEffect(() => { if (context.data?.review_findings) setNotes(value => value || context.data?.review_findings || ""); }, [context.data?.review_findings]);
  useEffect(() => {
    const value = formatWorkshopDateTimeInput(new Date().toISOString());
    initialOccurredAt.current = value; initialDeliveryAt.current = value;
    setOccurredAt(value); setDeliveryAt(value); setSignature(""); setConfirmed(false); setDelivery(false);
  }, [entry.id, stage]);
  const canWork = hasRole("admin", "manager", "supervisor", "technician");
  const canDeliver = hasRole("admin", "manager", "supervisor");
  const next = ["arrived", "approved"].includes(stage) ? "in_progress" : stage === "in_progress" ? "ready" : null;
  const nextLabel = next === "in_progress" ? text("بدء مراجعة المركبة", "Start vehicle review") : text("إنهاء المراجعة وتجهيز التسليم", "Complete review and prepare delivery");
  const deliverLabel = text("إعادة تسليم المركبة", "Deliver vehicle after review");
  const stageLabel = stage === "delivered" ? text("تم التسليم بعد المراجعة", "Delivered after review") : stage === "ready" ? text("جاهزة لإعادة التسليم", "Ready for delivery after review") : stage === "in_progress" ? text("المراجعة جارية", "Review in progress") : stage === "cancelled" ? text("زيارة المراجعة ملغاة", "Review visit cancelled") : text("وصلت للمراجعة", "Arrived for review");
  async function save(deliver = false) {
    if (lock.current || !context.data) return;
    lock.current = true; setBusy(true);
    try {
      let expected = next;
      if (deliver) {
        if (requirementsEnabled && (!receipt || !signature || !confirmed || recipient.trim().length < 2 || notes.trim().length < 5)) return;
        await deliverReviewVisit({ entryId: entry.id, requestId: request.current, receiptId: receipt, recipient, signature, notes, occurredAt: deliveryAt === initialDeliveryAt.current ? new Date().toISOString() : parseWorkshopDateTimeInput(deliveryAt) }); expected = "delivered";
      } else {
        if (!next || !user) return;
        if (requirementsEnabled) {
          const freshSignature = await signatureState.refetch();
          if (freshSignature.error || freshSignature.data?.revision !== entry.intake_revision || freshSignature.data?.signed !== true) throw new Error("REVIEW_RETURN_SIGNATURE_REQUIRED");
        }
        await advanceVehicleVisit({ entryId: entry.id, revision: visit.workflow.revision, stage: next, occurredAt: occurredAt === initialOccurredAt.current ? new Date().toISOString() : parseWorkshopDateTimeInput(occurredAt), notes, reason: "", responsibleUserId: user.id, requirements: {} });
      }
      const saved = await getVehicleVisitDetail(entry.id, { includeOperationalFile: false });
      if (saved?.workflow?.stage !== expected || (expected === "delivered" && !saved.hasFinalHandover)) throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
      setDelivery(false);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["vehicle-intake-receipts", entry.id] }),
        qc.invalidateQueries({ queryKey: ["intake-receipt-history", entry.id] }),
        qc.invalidateQueries({ queryKey: ["review-visit-context", entry.id] }),
      ]);
      await onChanged();
      toast.success(text("حُفظت مرحلة المراجعة وتحققنا منها", "Review stage saved and verified"));
    } catch {
      toast.error(text("تعذر تأكيد الحفظ. حدّث الزيارة وتحقق من الوصل والمرحلة والصلاحيات ثم أعد المحاولة", "Could not confirm the save. Refresh the visit and check the receipt, stage and permissions before retrying"));
      await onChanged();
    } finally { lock.current = false; setBusy(false); }
  }
  return <Card className="space-y-4 p-4" dir={i18n.dir()}>
    <h2 className="text-lg font-semibold">{text("مراجعة مرتبطة بالتسليم السابق", "Review linked to previous delivery")}</h2>
    <p role="status">{stageLabel}</p>
    <p className="text-sm text-muted-foreground">{text("المطالبة وأمر العمل السابقان مرجع للمتابعة. لا يلزم إنشاء مطالبة أو اعتماد جديد لهذه المراجعة.", "The previous claim and work order remain references. This review does not require a new claim or approval.")}</p>
    <VehicleVisitManagerControls visit={visit} onChanged={onChanged}/>
    {context.isLoading && <p>{text("جارٍ تحميل المراجع السابقة…", "Loading previous references…")}</p>}
    {(context.isError || (!context.isLoading && !context.data)) && <p role="alert">{text("تعذر تأكيد ربط المراجعة. حدّث الصفحة قبل أي إجراء.", "Could not confirm review references. Refresh before taking action.")}</p>}
    {context.data && <div className="flex flex-wrap gap-4 text-sm">
      <Link className="text-primary underline" to={`/vehicle-entry/${context.data.source_entry_id}`}>{text("الزيارة السابقة", "Previous visit")}: {context.data.source_entry_number}</Link>
      {context.data.source_claim_id && <Link className="text-primary underline" to={`/insurance/${context.data.source_claim_id}`}>{text("المطالبة السابقة", "Previous claim")}: {context.data.source_claim_number}</Link>}
      {context.data.source_work_order_id && <Link className="text-primary underline" to={`/work-orders/${encodeURIComponent(context.data.source_work_order_number || "")}`}>{text("أمر العمل السابق", "Previous work order")}: {context.data.source_work_order_number}</Link>}
      <span>{text("التسليم السابق", "Previous handover")}: {context.data.source_handover_number}</span>
    </div>}
    <dl className="space-y-2 text-sm"><dt className="font-semibold">{text("سبب الرجوع", "Return reason")}</dt><dd>{meta.reason}</dd><dt className="font-semibold">{text("الحالة عند الرجوع", "Condition on return")}</dt><dd>{meta.arrival_condition}</dd><dt className="font-semibold">{text("قراءة العداد عند الرجوع (كم)", "Odometer on return (km)")}</dt><dd>{meta.mileage ?? entry.vehicle_snapshot?.mileage ?? "—"}</dd><dt className="font-semibold">{text("حالة التشغيل", "Running condition")}</dt><dd>{vehicleRunningStatusLabel(meta.running_status ?? entry.vehicle_condition.running_status, i18n.language)}</dd><dt className="font-semibold">{text("أضرار جديدة واضحة", "Clear new visible damage")}</dt><dd>{meta.new_damage === true ? text("نعم", "Yes") : meta.new_damage === false ? text("لا", "No") : text("غير مسجل", "Not recorded")}{meta.new_damage_notes && <p className="whitespace-pre-wrap">{meta.new_damage_notes}</p>}</dd><dt className="font-semibold">{text("ملاحظات الرجوع", "Return notes")}</dt><dd>{meta.notes || "—"}</dd></dl>
    {stage === "delivered" && <><p>{text("محضر إعادة التسليم", "Review handover")}: {visit.handovers?.find((row: any) => row.status === "finalized")?.receipt_number || "—"}</p><p className="whitespace-pre-wrap">{visit.handovers?.find((row: any) => row.status === "finalized")?.work_summary || context.data?.review_findings}</p><VehicleReviewReturnAction entryId={entry.id}/></>}
    {!['delivered', 'cancelled'].includes(stage) && <label className="block">{text("نتيجة المراجعة والأعمال المنفذة", "Review findings and work performed")}<Textarea value={notes} maxLength={2000} disabled={busy} onChange={e => setNotes(e.target.value)} /></label>}
    {requirementsEnabled && next && !hasCurrentSignature && <p role="status">{text("يلزم توقيع العميل على الإصدار الحالي من نموذج المراجعة قبل بدء الأعمال أو اعتماد نتيجتها.", "The customer must sign the current review intake revision before work starts or findings are approved.")}</p>}
    {next && canWork && <label className="block space-y-2 text-sm">{text("تاريخ ووقت مرحلة المراجعة", "Review stage date and time")}<Input aria-label={text("تاريخ ووقت مرحلة المراجعة", "Review stage date and time")} type="datetime-local" step="1" value={occurredAt} disabled={busy} max={formatWorkshopDateTimeInput(new Date(Date.now() + 300000).toISOString())} onChange={event => setOccurredAt(event.target.value)}/><span className="block text-xs text-muted-foreground">{text("بتوقيت سلطنة عُمان (مسقط). عند تركه دون تغيير يُسجَّل وقت الحفظ الفعلي.", "Oman time (Asia/Muscat). Leave unchanged to use the actual save time.")}</span></label>}
    {next && canWork && <Button disabled={busy || !context.data || !occurredAt || (requirementsEnabled && (signatureState.isFetching || !hasCurrentSignature)) || (next === "ready" && (!canDeliver || (requirementsEnabled && notes.trim().length < 5)))} onClick={() => void save()}>{nextLabel}</Button>}
    {(stage === "ready" || (!requirementsEnabled && !["delivered","cancelled"].includes(stage))) && canDeliver && <Button disabled={busy || !context.data || (requirementsEnabled && notes.trim().length < 5)} onClick={() => { const value = formatWorkshopDateTimeInput(new Date().toISOString()); initialDeliveryAt.current = value; setDeliveryAt(value); setSignature(""); setConfirmed(false); setDelivery(true); }}>{deliverLabel}</Button>}
    {visit.transitions?.length > 0 && <details><summary>{text("سجل المراجعة", "Review history")}</summary>{visit.transitions.map((event: any) => <p className="whitespace-pre-wrap text-sm" key={event.id}>{event.notes || "—"}</p>)}</details>}
    <Dialog open={delivery} onOpenChange={v => { if (!busy) setDelivery(v); }}><DialogContent dir={i18n.dir()} className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{deliverLabel}</DialogTitle><DialogDescription>{requirementsEnabled ? text("تحقق من وصل زيارة المراجعة وسجّل المستلم الفعلي وتوقيعه الجديد.", "Verify this review visit's receipt and record the actual recipient and a new signature.") : text("سيُحفظ التسليم باستثناء موثق؛ لا يُنشأ توقيع أو وصل بدل البيانات غير المسجلة.", "Delivery will use a documented exception; no signature or receipt is fabricated for unrecorded details.")}</DialogDescription></DialogHeader>
      <VehicleIntakeReceiptCheck entryId={entry.id} receiptId={receipt} onChange={id => setReceipt(id)} readOnly={busy}/>
      <label className="block space-y-2 text-sm">{text("تاريخ ووقت تسليم المراجعة", "Review delivery date and time")}<Input aria-label={text("تاريخ ووقت تسليم المراجعة", "Review delivery date and time")} type="datetime-local" step="1" value={deliveryAt} disabled={busy} max={formatWorkshopDateTimeInput(new Date(Date.now() + 300000).toISOString())} onChange={event => { setDeliveryAt(event.target.value); setSignature(""); setConfirmed(false); }}/><span className="block text-xs text-muted-foreground">{text("بتوقيت سلطنة عُمان (مسقط). عند تركه دون تغيير يُسجَّل وقت الحفظ الفعلي.", "Oman time (Asia/Muscat). Leave unchanged to use the actual save time.")}</span></label>
      <label>{text("اسم المستلم الفعلي", "Actual recipient name")}<Input value={recipient} maxLength={200} disabled={busy} onChange={e => setRecipient(e.target.value)}/></label>
      <p>{notes}</p>
      <label className="flex gap-2"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e => setConfirmed(e.target.checked)}/>{text("أؤكد استلام المركبة بعد المراجعة وفق النتيجة الموضحة أعلاه", "I confirm receipt of the vehicle after review with the findings shown above")}</label>
      <ElectronicSignaturePad value={signature} onChange={setSignature} disabled={busy} title={text("توقيع مستلم المركبة الجديد", "New vehicle recipient signature")} description={text("وقّع داخل المربع", "Sign inside the box")} clearLabel={text("مسح التوقيع", "Clear signature")} savedLabel={text("التوقيع جاهز للحفظ", "Signature ready to save")} emptyLabel={requirementsEnabled ? text("يلزم توقيع جديد", "A new signature is required") : text("التوقيع اختياري ضمن الاستثناء الموثق", "Signature is optional under the documented exception")}/>
      <Button disabled={busy || !deliveryAt || (requirementsEnabled && (!receipt || !signature || !confirmed || recipient.trim().length < 2 || notes.trim().length < 5))} onClick={() => void save(true)}>{deliverLabel}</Button>
    </DialogContent></Dialog>
  </Card>;
}
