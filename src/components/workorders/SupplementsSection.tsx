// قسم الأعمال الإضافية (Supplement) + إرسال رابط موافقة العميل
import { useEffect, useState } from "react";
import { Plus, Send, Trash2, Loader2, FileEdit, CheckCircle2, XCircle, Clock, PackageCheck, Camera, MessageCircle, Copy, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizePhone } from "@/lib/phoneUtils";
import { sendWhatsAppMessage } from "@/lib/partsWhatsApp";

interface Supplement {
  id: string;
  description: string;
  quantity: number;
  unit_price: number;
  notes: string | null;
  photos: string[];
  status: "pending_customer" | "approved" | "rejected" | "executed";
  customer_decision_at: string | null;
  created_at: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const STATUS_LABEL: Record<string, { ar: string; cls: string; icon: any }> = {
  pending_customer: { ar: "بانتظار موافقة العميل", cls: "bg-warning/15 text-warning", icon: Clock },
  approved: { ar: "موافق عليه", cls: "bg-success/15 text-success", icon: CheckCircle2 },
  rejected: { ar: "مرفوض", cls: "bg-destructive/15 text-destructive", icon: XCircle },
  executed: { ar: "تم التنفيذ", cls: "bg-primary/15 text-primary", icon: PackageCheck },
};

interface Props { jobOrderId: string; customerName?: string; customerPhone?: string }

export default function SupplementsSection({ jobOrderId, customerName, customerPhone }: Props) {
  const isUuid = UUID_RE.test(jobOrderId);
  const [items, setItems] = useState<Supplement[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Partial<Supplement> | null>(null);
  const [sending, setSending] = useState(false);
  const [linkDialog, setLinkDialog] = useState<{ link: string } | null>(null);

  async function load() {
    if (!isUuid) { setLoading(false); return; }
    setLoading(true);
    const { data } = await supabase.from("work_order_supplements")
      .select("*").eq("job_order_id", jobOrderId).order("created_at", { ascending: true });
    setItems((data as any) || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, [jobOrderId]);

  async function save() {
    if (!editing) return;
    if (!editing.description?.trim()) { toast.error("الوصف مطلوب"); return; }
    const tenantRes = await supabase.from("profiles").select("tenant_id").maybeSingle();
    const tenant_id = tenantRes.data?.tenant_id;
    if (!tenant_id) { toast.error("تعذّر تحديد المستأجر"); return; }

    if (editing.id) {
      const { error } = await supabase.from("work_order_supplements").update({
        description: editing.description, quantity: Number(editing.quantity) || 1,
        unit_price: Number(editing.unit_price) || 0, notes: editing.notes || null,
        photos: editing.photos || [],
      }).eq("id", editing.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("work_order_supplements").insert({
        tenant_id, job_order_id: jobOrderId,
        description: editing.description, quantity: Number(editing.quantity) || 1,
        unit_price: Number(editing.unit_price) || 0, notes: editing.notes || null,
        photos: editing.photos || [],
      });
      if (error) return toast.error(error.message);
    }
    setEditing(null); toast.success("تم الحفظ"); load();
  }

  async function remove(id: string) {
    if (!confirm("حذف البند؟")) return;
    const { error } = await supabase.from("work_order_supplements").delete().eq("id", id);
    if (error) return toast.error(error.message);
    load();
  }

  async function uploadPhoto(file: File) {
    const path = `supplements/${jobOrderId}/${Date.now()}-${file.name.replace(/[^a-z0-9.]/gi, "_")}`;
    const { error } = await supabase.storage.from("damage-photos").upload(path, file);
    if (error) { toast.error(error.message); return; }
    const { data } = await supabase.storage.from("damage-photos").createSignedUrl(path, 60 * 60 * 24 * 30);
    if (data?.signedUrl) setEditing((e) => ({ ...e!, photos: [...(e?.photos || []), data.signedUrl] }));
  }

  async function markExecuted(id: string) {
    const { error } = await supabase.from("work_order_supplements").update({ status: "executed" }).eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("تم وضعه كمنفّذ");
    load();
  }

  async function sendApprovalRequest() {
    const pending = items.filter((i) => i.status === "pending_customer");
    if (pending.length === 0) { toast.error("لا توجد بنود بانتظار الموافقة"); return; }
    if (!customerPhone || !normalizePhone(customerPhone)) {
      if (!confirm("لا يوجد رقم هاتف صحيح للعميل — سيتم توليد الرابط فقط دون إرسال. متابعة؟")) return;
    }
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-supplement-link", {
        body: {
          job_order_id: jobOrderId,
          supplement_ids: pending.map((i) => i.id),
          customer_name: customerName,
          customer_phone: customerPhone,
          app_origin: window.location.origin,
        },
      });
      if (error) throw error;
      const link = (data as any).link as string;
      setLinkDialog({ link });

      // إرسال صامت عبر WhatsApp Meta API الموجودة (إن مُعد)
      const message = `مرحباً ${customerName || ""}،\nيوجد بنود أعمال إضافية على مركبتك بانتظار موافقتك. الرجاء فتح الرابط لمراجعتها والموافقة:\n${link}\n(صالح 24 ساعة)`;
      try {
        await supabase.functions.invoke("whatsapp-meta-send", {
          body: { to: normalizePhone(customerPhone || ""), message },
        });
        toast.success("تم إرسال الرابط عبر واتساب");
      } catch {
        // fallback: ادعُ المستخدم لإرسال يدوي
      }
      try {
        await supabase.functions.invoke("send-sms", {
          body: { to: normalizePhone(customerPhone || ""), message },
        });
      } catch { /* ignore if not configured */ }
    } catch (e: any) {
      toast.error(e.message || "فشل إرسال الرابط");
    } finally { setSending(false); }
  }

  if (!isUuid) return null;

  const total = items.reduce((s, i) => s + (i.quantity * i.unit_price), 0);
  const approvedTotal = items.filter((i) => i.status === "approved" || i.status === "executed")
    .reduce((s, i) => s + (i.quantity * i.unit_price), 0);

  return (
    <div className="bg-card border border-border rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-sm font-semibold flex items-center gap-2">
          <FileEdit size={16} className="text-primary" /> الأعمال الإضافية التي تتطلب موافقة العميل
          {items.length > 0 && <span className="text-xs text-muted-foreground font-normal">({items.length})</span>}
        </h2>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setEditing({ quantity: 1, unit_price: 0, photos: [] })} className="gap-1">
            <Plus size={14} /> بند جديد
          </Button>
          <Button size="sm" onClick={sendApprovalRequest} disabled={sending} className="gap-1">
            {sending ? <Loader2 size={14} className="animate-spin"/> : <Send size={14} />} إرسال للعميل
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="text-center text-sm text-muted-foreground py-4"><Loader2 className="inline animate-spin" size={14}/></div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">لا توجد أعمال إضافية بعد. اضغط "بند جديد" لإضافة أول بند.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs">
                <tr>
                  <th className="text-right p-2">الوصف</th>
                  <th className="text-right p-2">الكمية</th>
                  <th className="text-right p-2">السعر</th>
                  <th className="text-right p-2">الإجمالي</th>
                  <th className="text-right p-2">الحالة</th>
                  <th className="text-right p-2">إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {items.map((i) => {
                  const S = STATUS_LABEL[i.status];
                  return (
                    <tr key={i.id} className="border-t border-border hover:bg-muted/20">
                      <td className="p-2">
                        <div className="font-medium">{i.description}</div>
                        {i.notes && <div className="text-xs text-muted-foreground">{i.notes}</div>}
                        {i.photos?.length > 0 && (
                          <div className="flex gap-1 mt-1">
                            {i.photos.slice(0, 4).map((p, x) => (
                              <img key={x} src={p} className="w-8 h-8 rounded object-cover border" alt="" />
                            ))}
                          </div>
                        )}
                      </td>
                      <td className="p-2">{i.quantity}</td>
                      <td className="p-2">{Number(i.unit_price).toFixed(3)}</td>
                      <td className="p-2 font-semibold">{(i.quantity * i.unit_price).toFixed(3)}</td>
                      <td className="p-2">
                        <Badge className={S.cls + " gap-1"}><S.icon size={11}/> {S.ar}</Badge>
                        {i.customer_decision_at && (
                          <div className="text-[10px] text-muted-foreground mt-1">{new Date(i.customer_decision_at).toLocaleString("en-GB")}</div>
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex gap-1">
                          {i.status === "approved" && (
                            <Button size="sm" variant="outline" className="h-7 gap-1" onClick={() => markExecuted(i.id)}>
                              <PackageCheck size={11}/> تنفيذ
                            </Button>
                          )}
                          {i.status === "pending_customer" && (
                            <Button size="sm" variant="ghost" className="h-7" onClick={() => setEditing(i)}>
                              <FileEdit size={12}/>
                            </Button>
                          )}
                          {i.status !== "executed" && (
                            <Button size="sm" variant="ghost" className="h-7 text-destructive" onClick={() => remove(i.id)}>
                              <Trash2 size={12}/>
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-border bg-muted/30 font-semibold">
                  <td colSpan={3} className="p-2 text-right">الإجمالي الكلي / المعتمد</td>
                  <td className="p-2">{total.toFixed(3)}</td>
                  <td colSpan={2} className="p-2 text-success">المعتمد: {approvedTotal.toFixed(3)} ر.ع</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {/* Edit dialog */}
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-lg" dir="rtl">
          <DialogHeader><DialogTitle>{editing?.id ? "تعديل بند" : "بند أعمال إضافية"}</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div><Label className="text-xs">الوصف *</Label>
              <Textarea value={editing?.description || ""} onChange={(e) => setEditing({ ...editing!, description: e.target.value })} rows={2}/>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div><Label className="text-xs">الكمية</Label>
                <Input type="number" value={editing?.quantity ?? 1} onChange={(e) => setEditing({ ...editing!, quantity: Number(e.target.value) })}/>
              </div>
              <div><Label className="text-xs">سعر الوحدة (ر.ع)</Label>
                <Input type="number" step="0.001" value={editing?.unit_price ?? 0} onChange={(e) => setEditing({ ...editing!, unit_price: Number(e.target.value) })}/>
              </div>
            </div>
            <div><Label className="text-xs">ملاحظات</Label>
              <Textarea value={editing?.notes || ""} onChange={(e) => setEditing({ ...editing!, notes: e.target.value })} rows={2}/>
            </div>
            <div>
              <div className="flex items-center justify-between">
                <Label className="text-xs">صور ({editing?.photos?.length || 0})</Label>
                <label className="cursor-pointer">
                  <input hidden type="file" accept="image/*" onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}/>
                  <Button size="sm" variant="outline" className="gap-1" asChild><span><Camera size={13}/> رفع</span></Button>
                </label>
              </div>
              {(editing?.photos || []).length > 0 && (
                <div className="grid grid-cols-4 gap-1 mt-2">
                  {editing!.photos!.map((p, i) => (
                    <img key={i} src={p} className="w-full aspect-square object-cover rounded" alt=""/>
                  ))}
                </div>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setEditing(null)}>إلغاء</Button>
            <Button onClick={save}>حفظ</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Link generated dialog */}
      <Dialog open={!!linkDialog} onOpenChange={(o) => !o && setLinkDialog(null)}>
        <DialogContent dir="rtl">
          <DialogHeader><DialogTitle>تم إنشاء رابط الموافقة</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">صالح لمدة 24 ساعة. تم محاولة إرساله للعميل تلقائياً.</p>
            <div className="flex gap-2">
              <Input readOnly value={linkDialog?.link || ""} className="font-mono text-xs"/>
              <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(linkDialog!.link); toast.success("نُسخ"); }}>
                <Copy size={14}/>
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.open(linkDialog!.link, "_blank")}>
                <ExternalLink size={14}/>
              </Button>
              <Button size="sm" variant="outline" onClick={async () => {
                try {
                  await sendWhatsAppMessage({
                    message: `رابط موافقتك على الأعمال الإضافية:\n${linkDialog!.link}\n(صالح 24 ساعة)`,
                    phone: customerPhone,
                    workOrderId: jobOrderId,
                    recipientType: "customer",
                  });
                  toast.success("تم إرسال رابط الموافقة");
                } catch (error) {
                  toast.error(error instanceof Error ? error.message : "تعذر إرسال الرابط");
                }
              }}>
                <MessageCircle size={14}/>
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
