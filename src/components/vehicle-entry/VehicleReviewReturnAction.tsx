import { useId, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AlertTriangle, ShieldCheck } from "lucide-react";
import { VehicleRunningStatusField } from "./VehicleRunningStatusField";
import { parseVehicleOdometer, type VehicleRunningStatus } from "@/lib/vehicleRunningStatus";
import { useWorkflowRequirements } from "@/hooks/useWorkflowRequirements";

/** A separate arrival; never reopen or reuse the delivered visit's signature. */
export function VehicleReviewReturnAction({ entryId }: { entryId: string }) {
  const { hasRole } = useAuth();
  const { i18n } = useTranslation();
  const { requirementsEnabled } = useWorkflowRequirements();
  const navigate = useNavigate();
  const damageChoiceId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef(crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [person, setPerson] = useState("");
  const [arrived, setArrived] = useState(false);
  const [mileage, setMileage] = useState("");
  const [runningStatus, setRunningStatus] = useState<VehicleRunningStatus>("unknown");
  const [newDamage, setNewDamage] = useState<boolean | null>(null);
  const [newDamageNotes, setNewDamageNotes] = useState("");
  const odometer = parseVehicleOdometer(mileage);
  const invalidInput = (mileage.trim() !== "" && odometer === null);
  const missingRequirements = person.trim().length < 2 || reason.trim().length < 5 || condition.trim().length < 3 || odometer === null || runningStatus === "unknown" || newDamage === null || (newDamage && newDamageNotes.trim().length < 3);
  const text = (ar: string, en: string) => i18n.language.startsWith("en") ? en : ar;
  if (!hasRole("admin", "manager", "supervisor", "insurance")) return null;
  const title = text("إعادة دخول للمراجعة", "Return for review");
  const saveLabel = text("تسجيل زيارة المراجعة", "Register review visit");
  const savingLabel = text("جارٍ الحفظ…", "Saving…");
  async function save() {
    if (lock.current || !arrived || invalidInput || (requirementsEnabled && missingRequirements)) return;
    lock.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_vehicle_review_return" as any, {
        p_source_entry_id: entryId, p_request_id: request.current, p_reason: reason.trim(),
        p_condition: condition.trim(), p_notes: notes.trim(), p_delivered_by: person.trim(), p_confirm_arrival: arrived,
        p_mileage: odometer, p_running_status: runningStatus, p_new_damage: newDamage, p_new_damage_notes: newDamage ? newDamageNotes.trim() : "",
      } as any);
      if (error) throw error;
      const result = data as unknown as { entry_id: string; existing: boolean; requirements_exception_id?: string | null };
      const read = await supabase.from("vehicle_entries").select("*").eq("id", result.entry_id).single();
      if (read.error) throw read.error;
      const row = read.data as unknown as { vehicle_condition: Record<string, any>; vehicle_snapshot?: Record<string, unknown>; custody_receipt_required: boolean };
      const context = row.vehicle_condition?.review_return;
      if (context?.source_entry_id !== entryId || !row.custody_receipt_required) throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
      if (!result.existing && missingRequirements && (!result.requirements_exception_id || context.requirements_exception_id !== result.requirements_exception_id)) throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
      const readMileage = (value: unknown) => value == null ? null : Number(value);
      if (!result.existing && (readMileage(context.mileage) !== odometer || readMileage(row.vehicle_snapshot?.mileage) !== odometer || context.running_status !== runningStatus || row.vehicle_condition.running_status !== runningStatus
        || context.new_damage !== newDamage || (context.new_damage_notes || "") !== (newDamage ? newDamageNotes.trim() : ""))) throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
      toast.success(result.existing ? text("تم فتح زيارة المراجعة الموجودة؛ لم تُغيّر بياناتها", "Opened the existing review visit; its details were not changed") : result.requirements_exception_id ? text("حُفظ نموذج المراجعة باستثناء تشغيلي موثّق", "Review intake saved with an audited workflow exception") : text("حُفظ نموذج المراجعة بانتظار توقيع العميل واعتماده", "Review intake saved, awaiting the customer signature before approval"));
      setOpen(false); navigate(`/vehicle-entry/${result.entry_id}`);
    } catch {
      toast.error(text("تعذر تأكيد حفظ زيارة المراجعة. تحقق من التسليم السابق والصلاحيات ثم أعد المحاولة", "Could not confirm the review visit. Check the previous finalized delivery and permissions, then retry"));
    } finally { lock.current = false; setBusy(false); }
  }
  return <><Button variant="outline" onClick={() => setOpen(true)}>{title}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent dir={i18n.dir()} className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{requirementsEnabled ? text("نموذج مراجعة مرتبط بالتسليم السابق، ولا يُعتمد حتى يوقّع العميل. سجّل الوصول الفعلي فقط.", "A review intake linked to the previous delivery remains unapproved until the customer signs. Register physical arrival only.") : text("زيارة جديدة مرتبطة بالتسليم السابق مع حفظ أي استثناء تشغيلي في سجل التدقيق. سجّل الوصول الفعلي فقط.", "A new visit linked to the previous delivery records any operational exception in the audit history. Register physical arrival only.")}</DialogDescription></DialogHeader>
      <label>{text("اسم مُسلّم المركبة الآن", "Vehicle delivered by now")}<Input value={person} maxLength={200} onChange={(e) => setPerson(e.target.value)} disabled={busy}/></label>
      <label>{text("سبب الرجوع للمراجعة", "Reason for return")}<Textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} disabled={busy}/></label>
      <label>{text("حالة المركبة عند الرجوع", "Vehicle condition on return")}<Textarea value={condition} maxLength={2000} onChange={(e) => setCondition(e.target.value)} disabled={busy}/></label>
      <label>{text("قراءة العداد عند الرجوع (كم)", "Odometer on return (km)")}<Input dir="ltr" inputMode="numeric" value={mileage} maxLength={8} onChange={e => setMileage(e.target.value)} disabled={busy}/></label>
      <VehicleRunningStatusField value={runningStatus} onChange={setRunningStatus} disabled={busy} allowUnknown={!requirementsEnabled}/>
      <fieldset disabled={busy} className="space-y-2"><legend className="text-sm font-semibold">{text("هل توجد أضرار جديدة واضحة؟", "Is there clear new visible damage?")}</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          <label className="flex min-h-12 items-center gap-2 rounded-lg border p-3"><input type="radio" name={`new-damage-${damageChoiceId}`} checked={newDamage === false} onChange={() => { setNewDamage(false); setNewDamageNotes(""); }}/><ShieldCheck className="h-5 w-5 text-green-700 dark:text-green-400" aria-hidden="true"/>{text("لا توجد أضرار جديدة ظاهرة", "No new visible damage")}</label>
          <label className="flex min-h-12 items-center gap-2 rounded-lg border p-3"><input type="radio" name={`new-damage-${damageChoiceId}`} checked={newDamage === true} onChange={() => setNewDamage(true)}/><AlertTriangle className="h-5 w-5 text-destructive" aria-hidden="true"/>{text("توجد أضرار جديدة ظاهرة", "New visible damage observed")}</label>
        </div>
      </fieldset>
      {newDamage && <label>{text("وصف الأضرار الجديدة", "New visible damage details")}<Textarea value={newDamageNotes} maxLength={2000} onChange={e => setNewDamageNotes(e.target.value)} disabled={busy}/></label>}
      <label>{text("ملاحظات العميل والأعمال المطلوب مراجعتها", "Customer notes and work to review")}<Textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} disabled={busy}/></label>
      <label className="flex gap-2"><input type="checkbox" checked={arrived} onChange={(e) => setArrived(e.target.checked)} disabled={busy}/>{text("أؤكد وصول المركبة فعليًا للورشة", "I confirm the vehicle has physically arrived")}</label>
      {!requirementsEnabled && <p role="status" className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">{text("الشروط التشغيلية متوقفة بقرار المدير؛ ستبقى البيانات غير المدخلة غير مسجلة، ويُحفظ سبب الاستثناء في سجل التدقيق. يلزم تأكيد الوصول الفعلي.", "Operational requirements are disabled by the administrator. Missing observations remain unrecorded and the exception reason is audited. Physical arrival must still be confirmed.")}</p>}
      <Button disabled={busy || !arrived || invalidInput || (requirementsEnabled && missingRequirements)} onClick={save}>{busy ? savingLabel : saveLabel}</Button>
    </DialogContent></Dialog></>;
}
