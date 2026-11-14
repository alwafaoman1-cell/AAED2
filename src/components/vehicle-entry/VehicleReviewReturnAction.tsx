import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

/** A separate arrival; never reopen or reuse the delivered visit's signature. */
export function VehicleReviewReturnAction({ entryId }: { entryId: string }) {
  const { hasRole } = useAuth();
  const { i18n } = useTranslation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const request = useRef(crypto.randomUUID());
  const [reason, setReason] = useState("");
  const [condition, setCondition] = useState("");
  const [notes, setNotes] = useState("");
  const [person, setPerson] = useState("");
  const [arrived, setArrived] = useState(false);
  const text = (ar: string, en: string) => i18n.language.startsWith("en") ? en : ar;
  if (!hasRole("admin", "manager", "supervisor", "insurance")) return null;
  const title = text("إعادة دخول للمراجعة", "Return for review");
  const saveLabel = text("تسجيل زيارة المراجعة", "Register review visit");
  const savingLabel = text("جارٍ الحفظ…", "Saving…");
  async function save() {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const { data, error } = await supabase.rpc("create_vehicle_review_return" as any, {
        p_source_entry_id: entryId, p_request_id: request.current, p_reason: reason.trim(),
        p_condition: condition.trim(), p_notes: notes.trim(), p_delivered_by: person.trim(), p_confirm_arrival: arrived,
      } as any);
      if (error) throw error;
      const result = data as unknown as { entry_id: string; existing: boolean };
      const read = await supabase.from("vehicle_entries").select("*").eq("id", result.entry_id).single();
      if (read.error) throw read.error;
      const row = read.data as unknown as { vehicle_condition: Record<string, any>; custody_receipt_required: boolean };
      const context = row.vehicle_condition?.review_return;
      if (context?.source_entry_id !== entryId || !row.custody_receipt_required) throw new Error("REVIEW_RETURN_SAVE_NOT_CONFIRMED");
      toast.success(result.existing ? text("تم فتح زيارة المراجعة الموجودة؛ لم تُغيّر بياناتها", "Opened the existing review visit; its details were not changed") : text("حُفظت زيارة المراجعة الجديدة. يلزم توقيع جديد لإصدار الوصل", "Review visit saved. A new signature is required to issue its receipt"));
      setOpen(false); navigate(`/vehicle-entry/${result.entry_id}`);
    } catch {
      toast.error(text("تعذر تأكيد حفظ زيارة المراجعة. تحقق من التسليم السابق والصلاحيات ثم أعد المحاولة", "Could not confirm the review visit. Check the previous finalized delivery and permissions, then retry"));
    } finally { lock.current = false; setBusy(false); }
  }
  return <><Button variant="outline" onClick={() => setOpen(true)}>{title}</Button>
    <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}><DialogContent dir={i18n.dir()} className="max-h-[90dvh] overflow-y-auto">
      <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{text("زيارة جديدة مرتبطة بالتسليم السابق، بوصل وتوقيع جديدين. سجّل الوصول الفعلي فقط.", "A new visit linked to the previous delivery, with a new receipt and signature. Register physical arrival only.")}</DialogDescription></DialogHeader>
      <label>{text("اسم مُسلّم المركبة الآن", "Vehicle delivered by now")}<Input value={person} maxLength={200} onChange={(e) => setPerson(e.target.value)} disabled={busy}/></label>
      <label>{text("سبب الرجوع للمراجعة", "Reason for return")}<Textarea value={reason} maxLength={2000} onChange={(e) => setReason(e.target.value)} disabled={busy}/></label>
      <label>{text("حالة المركبة عند الرجوع", "Vehicle condition on return")}<Textarea value={condition} maxLength={2000} onChange={(e) => setCondition(e.target.value)} disabled={busy}/></label>
      <label>{text("ملاحظات العميل والأعمال المطلوب مراجعتها", "Customer notes and work to review")}<Textarea value={notes} maxLength={4000} onChange={(e) => setNotes(e.target.value)} disabled={busy}/></label>
      <label className="flex gap-2"><input type="checkbox" checked={arrived} onChange={(e) => setArrived(e.target.checked)} disabled={busy}/>{text("أؤكد وصول المركبة فعليًا للورشة", "I confirm the vehicle has physically arrived")}</label>
      <Button disabled={busy || !arrived || person.trim().length < 2 || reason.trim().length < 5 || condition.trim().length < 3} onClick={save}>{busy ? savingLabel : saveLabel}</Button>
    </DialogContent></Dialog></>;
}
