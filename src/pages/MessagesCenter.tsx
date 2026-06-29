import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { MessageCircle, Mail, Phone, RefreshCw, Send, Loader2, Inbox, MessageSquare, Check, X, Link as LinkIcon } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Textarea } from "@/components/ui/textarea";

interface Row {
  id: string;
  job_order_id: string | null;
  event_type: string;
  channel: string;
  status: string;
  recipient: string | null;
  body: string;
  error: string | null;
  sent_at: string | null;
  created_at: string;
  payload: any;
}

interface UnifiedLogRow {
  id: string;
  channel: string;
  status: string;
  template_type: string | null;
  recipient_phone: string | null;
  recipient_email: string | null;
  body: string | null;
  message: string | null;
  error: string | null;
  created_at: string;
  sent_at: string | null;
  work_order_id: string | null;
  claim_id: string | null;
  invoice_id: string | null;
}

interface PortalNote {
  id: string;
  job_order_id: string;
  note: string;
  customer_name: string | null;
  status: string;
  submitted_at: string;
}

const EVENT_LABELS: Record<string, string> = {
  received: "تم الاستلام",
  inspection_started: "بدأ الفحص",
  waiting_parts: "بانتظار القطع",
  parts_arrived: "وصلت القطع",
  insurance_approved: "اعتماد التأمين",
  waiting_insurance: "بانتظار التأمين",
  supplement_pending: "موافقة إضافية",
  repair_started: "بدأ الإصلاح",
  ready_for_pickup: "جاهز للاستلام",
  delivered: "تم التسليم",
};

const STATUS_COLORS: Record<string, string> = {
  queued: "bg-amber-500/20 text-amber-300 border-amber-500/30",
  sent: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  delivered: "bg-emerald-500/20 text-emerald-300 border-emerald-500/30",
  failed: "bg-rose-500/20 text-rose-300 border-rose-500/30",
};

export default function MessagesCenter() {
  const [rows, setRows] = useState<Row[]>([]);
  const [logs, setLogs] = useState<UnifiedLogRow[]>([]);
  const [notes, setNotes] = useState<PortalNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [statusF, setStatusF] = useState("all");
  const [channelF, setChannelF] = useState("all");
  const [busyId, setBusyId] = useState<string | null>(null);
  const nav = useNavigate();
  const [params] = useSearchParams();
  const composeType = params.get("compose");
  const invoiceId = params.get("invoiceId");
  const draftMessage = params.get("message") || "";
  const workOrderId = params.get("workOrderId");
  const claimId = params.get("claimId");
  const composerInvoiceId = params.get("invoiceId");
  const [composer, setComposer] = useState({
    channel: "whatsapp",
    template: composeType || "general",
    phone: "",
    email: "",
    linkType: "none",
    shortLink: "",
    subject: "AAED2 Notification",
    body: draftMessage,
    callResult: "answered",
    callNotes: "",
    followUpAt: "",
  });

  async function load() {
    setLoading(true);
    const [{ data: msgs }, { data: ns }, { data: messageLogs }] = await Promise.all([
      supabase.from("customer_notifications").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("customer_portal_notes").select("id, job_order_id, note, customer_name, status, submitted_at").order("submitted_at", { ascending: false }).limit(500),
      supabase.from("message_logs" as any).select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    setRows((msgs || []) as Row[]);
    setNotes((ns || []) as PortalNote[]);
    setLogs((messageLogs || []) as unknown as UnifiedLogRow[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("messages_center_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_notifications" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "message_logs" }, () => load())
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_portal_notes" }, () => load())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (statusF !== "all" && r.status !== statusF) return false;
      if (channelF !== "all" && r.channel !== channelF) return false;
      if (q.trim()) {
        const s = q.toLowerCase();
        if (!(r.recipient || "").toLowerCase().includes(s) && !(r.body || "").toLowerCase().includes(s)) return false;
      }
      return true;
    });
  }, [rows, statusF, channelF, q]);

  const filteredNotes = useMemo(() => {
    if (!q.trim()) return notes;
    const s = q.toLowerCase();
    return notes.filter((n) => (n.note || "").toLowerCase().includes(s) || (n.customer_name || "").toLowerCase().includes(s));
  }, [notes, q]);

  const pendingNotesCount = notes.filter((n) => n.status === "pending").length;

  function buildTemplateText(template: string) {
    const link = composer.shortLink ? `\n${composer.shortLink}` : "";
    const templates: Record<string, string> = {
      vehicle_status: `تحديث حالة المركبة من ورشة الوفاء.${link}`,
      tracking_link: `يمكنك متابعة حالة المركبة من الرابط التالي:${link}`,
      invoice: `تم إصدار فاتورة جديدة. رابط الفاتورة:${link}`,
      payment_reminder: draftMessage || `تذكير بدفع المبلغ المتبقي. التفاصيل:${link}`,
      ready_for_pickup: `مركبتكم جاهزة للاستلام. يرجى التواصل معنا لتأكيد الموعد.${link}`,
      request_documents: `يرجى تزويدنا بالمستندات المطلوبة لإكمال الإجراء.${link}`,
      claim_update: `تحديث مطالبة التأمين: يوجد تحديث جديد على المطالبة.${link}`,
      general: composer.body || "مرحباً، نتواصل معكم من ورشة الوفاء.",
    };
    return templates[template] || templates.general;
  }

  function updateTemplate(template: string) {
    const next = buildTemplateText(template);
    setComposer((c) => ({ ...c, template, body: next }));
  }

  async function sendUnifiedMessage() {
    setBusyId("composer");
    try {
      const payload = {
        channel: composer.channel,
        template_type: composer.template,
        recipient_phone: composer.phone,
        recipient_email: composer.email,
        subject: composer.subject,
        body: composer.channel === "phone" ? composer.callNotes : composer.body,
        short_link: composer.shortLink || null,
        work_order_id: workOrderId,
        claim_id: claimId,
        invoice_id: composerInvoiceId,
        call_result: composer.callResult,
        call_notes: composer.callNotes,
        follow_up_at: composer.followUpAt || null,
      };
      const { data, error } = await supabase.functions.invoke("unified-message-send", { body: payload });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || data?.message || data?.status || "send_failed");
      toast.success(composer.channel === "phone" ? "تم تسجيل الاتصال" : "تم الإرسال");
      await load();
    } catch (e: any) {
      toast.error(e?.message || "فشل الإرسال/التسجيل");
    } finally {
      setBusyId(null);
    }
  }

  async function send(r: Row) {
    setBusyId(r.id);
    try {
      const { data, error } = await supabase.functions.invoke("send-customer-notification", {
        body: { notification_id: r.id },
      });
      if (error) throw error;
      if ((data as any)?.wa_url) {
        window.open((data as any).wa_url, "_blank");
        toast.success("تم فتح واتساب");
      } else if ((data as any)?.ok) {
        toast.success("تم الإرسال ✅");
      } else {
        toast.error((data as any)?.error || "فشل الإرسال");
      }
    } catch (e: any) {
      toast.error(e.message || "خطأ");
    } finally {
      setBusyId(null);
      load();
    }
  }

  async function reviewNote(id: string, decision: "approved" | "rejected") {
    setBusyId(id);
    const { error } = await supabase.rpc("review_portal_note" as any, { p_id: id, p_decision: decision });
    setBusyId(null);
    if (error) { toast.error(error.message); return; }
    toast.success(decision === "approved" ? "تم قبول الملاحظة" : "تم رفض الملاحظة");
    load();
  }

  return (
    <div className="p-4 max-w-6xl mx-auto" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Inbox className="text-primary" size={20} />
        <h1 className="text-lg font-bold">مركز الرسائل الموحد</h1>
        <Button size="sm" variant="ghost" onClick={load} className="mr-auto"><RefreshCw size={14} /></Button>
      </div>

      <Card className="p-4 mb-4 border-primary/30">
        <div className="flex items-center gap-2 mb-3">
          <Send size={16} className="text-primary" />
          <h2 className="font-bold">Message Composer</h2>
          {(workOrderId || claimId || composerInvoiceId) && (
            <Badge variant="outline" className="gap-1"><LinkIcon size={11} /> مربوط بسجل</Badge>
          )}
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <Select value={composer.channel} onValueChange={(channel) => setComposer((c) => ({ ...c, channel }))}>
            <SelectTrigger><SelectValue placeholder="القناة" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="whatsapp">WhatsApp</SelectItem>
              <SelectItem value="email">Email</SelectItem>
              <SelectItem value="phone">Phone Call Log</SelectItem>
            </SelectContent>
          </Select>
          <Select value={composer.template} onValueChange={updateTemplate}>
            <SelectTrigger><SelectValue placeholder="القالب" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="vehicle_status">حالة السيارة</SelectItem>
              <SelectItem value="tracking_link">رابط التتبع</SelectItem>
              <SelectItem value="invoice">الفاتورة</SelectItem>
              <SelectItem value="payment_reminder">تذكير الدفع</SelectItem>
              <SelectItem value="ready_for_pickup">جاهزية السيارة</SelectItem>
              <SelectItem value="request_documents">طلب مستندات</SelectItem>
              <SelectItem value="claim_update">تحديث مطالبة</SelectItem>
              <SelectItem value="general">رسالة عامة</SelectItem>
            </SelectContent>
          </Select>
          <Select value={composer.linkType} onValueChange={(linkType) => setComposer((c) => ({ ...c, linkType }))}>
            <SelectTrigger><SelectValue placeholder="رابط مرفق" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">بدون رابط</SelectItem>
              <SelectItem value="tracking">Tracking Link</SelectItem>
              <SelectItem value="invoice">Invoice Link</SelectItem>
              <SelectItem value="signature">Signature Link</SelectItem>
              <SelectItem value="record">Claim / Work Order Link</SelectItem>
            </SelectContent>
          </Select>
          {composer.channel !== "email" && (
            <Input placeholder="Recipient phone" dir="ltr" value={composer.phone} onChange={(e) => setComposer((c) => ({ ...c, phone: e.target.value }))} />
          )}
          {composer.channel === "email" && (
            <>
              <Input placeholder="Recipient email" dir="ltr" value={composer.email} onChange={(e) => setComposer((c) => ({ ...c, email: e.target.value }))} />
              <Input placeholder="Subject" value={composer.subject} onChange={(e) => setComposer((c) => ({ ...c, subject: e.target.value }))} />
            </>
          )}
          <Input placeholder="Short / attached link" dir="ltr" value={composer.shortLink} onChange={(e) => setComposer((c) => ({ ...c, shortLink: e.target.value }))} />
        </div>
        {composer.channel === "phone" ? (
          <div className="grid gap-3 md:grid-cols-3 mt-3">
            <Select value={composer.callResult} onValueChange={(callResult) => setComposer((c) => ({ ...c, callResult }))}>
              <SelectTrigger><SelectValue placeholder="نتيجة الاتصال" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="answered">تم الرد</SelectItem>
                <SelectItem value="no_answer">لم يتم الرد</SelectItem>
                <SelectItem value="busy">مشغول</SelectItem>
                <SelectItem value="follow_up">يحتاج متابعة</SelectItem>
              </SelectContent>
            </Select>
            <Input type="datetime-local" value={composer.followUpAt} onChange={(e) => setComposer((c) => ({ ...c, followUpAt: e.target.value }))} />
            <Input placeholder="رقم الهاتف" dir="ltr" value={composer.phone} onChange={(e) => setComposer((c) => ({ ...c, phone: e.target.value }))} />
            <Textarea className="md:col-span-3" placeholder="ملاحظات الاتصال" value={composer.callNotes} onChange={(e) => setComposer((c) => ({ ...c, callNotes: e.target.value }))} />
          </div>
        ) : (
          <div className="mt-3">
            <Textarea rows={4} placeholder="Preview / Message body" value={composer.body} onChange={(e) => setComposer((c) => ({ ...c, body: e.target.value }))} />
          </div>
        )}
        <div className="flex gap-2 mt-3 flex-wrap">
          <Button onClick={sendUnifiedMessage} disabled={busyId === "composer"} className="gap-2">
            {busyId === "composer" ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send size={14} />}
            {composer.channel === "phone" ? "تسجيل الاتصال" : "إرسال"}
          </Button>
          <span className="text-xs text-muted-foreground self-center">
            يمنع التكرار خلال دقيقتين، وتذكير الدفع خلال 24 ساعة.
          </span>
        </div>
      </Card>

      {composeType === "payment_reminder" && (
        <Card className="p-4 mb-4 border-warning/40 bg-warning/5">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <Badge className="mb-2 bg-warning/20 text-warning border-warning/30">Payment Reminder</Badge>
              <h2 className="font-bold">مسودة تذكير دفع</h2>
              <p className="text-xs text-muted-foreground">
                الفاتورة: <span className="font-mono" dir="ltr">{invoiceId || "—"}</span> — راجع النص ثم أرسله عبر قناة واتساب المفعّلة.
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                navigator.clipboard.writeText(draftMessage);
                toast.success("تم نسخ نص التذكير");
              }}
            >
              نسخ النص
            </Button>
          </div>
          <div className="mt-3 rounded-lg bg-background border border-border p-3 text-sm whitespace-pre-wrap">
            {draftMessage || "لا توجد رسالة جاهزة."}
          </div>
        </Card>
      )}

      <Tabs defaultValue="messages" className="w-full">
        <TabsList className="mb-3">
          <TabsTrigger value="messages" className="gap-2">
            <MessageCircle size={14} /> سجل الرسائل الموحد
            <Badge variant="outline" className="ms-1">{logs.length + rows.length}</Badge>
          </TabsTrigger>
          <TabsTrigger value="notes" className="gap-2">
            <MessageSquare size={14} /> ملاحظات من بوابة QR
            {pendingNotesCount > 0 && (
              <Badge className="ms-1 bg-warning/20 text-warning border-warning/30">{pendingNotesCount}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="messages">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-4">
            <Input placeholder="بحث..." value={q} onChange={(e) => setQ(e.target.value)} />
            <Select value={statusF} onValueChange={setStatusF}>
              <SelectTrigger><SelectValue placeholder="الحالة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الحالات</SelectItem>
                <SelectItem value="queued">بانتظار الإرسال</SelectItem>
                <SelectItem value="sent">مرسلة</SelectItem>
                <SelectItem value="failed">فشلت</SelectItem>
              </SelectContent>
            </Select>
            <Select value={channelF} onValueChange={setChannelF}>
              <SelectTrigger><SelectValue placeholder="القناة" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل القنوات</SelectItem>
                <SelectItem value="whatsapp">واتساب</SelectItem>
                <SelectItem value="sms">SMS</SelectItem>
                <SelectItem value="email">بريد</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground self-center">{filtered.length} رسالة</div>
          </div>

          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : (
            <div className="space-y-2">
              {logs.map((r) => (
                <div key={r.id} className="border border-border bg-card rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="outline">{r.template_type || "general"}</Badge>
                    <Badge className={STATUS_COLORS[r.status] || ""}>{r.status}</Badge>
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      {r.channel === "whatsapp" && <MessageCircle size={11} />}
                      {r.channel === "phone" && <Phone size={11} />}
                      {r.channel === "email" && <Mail size={11} />}
                      {r.channel}
                    </span>
                    <span className="text-[11px] text-muted-foreground" dir="ltr">{r.recipient_phone || r.recipient_email || "—"}</span>
                    <span className="text-[10px] text-muted-foreground mr-auto">{new Date(r.created_at).toLocaleString("en-GB")}</span>
                  </div>
                  <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-3 mb-2">{r.body || r.message}</p>
                  {r.error && <p className="text-[11px] text-rose-400 mb-2">⚠ {r.error}</p>}
                  <div className="flex gap-2 flex-wrap">
                    {r.work_order_id && <Button size="sm" variant="outline" onClick={() => nav(`/work-orders/${r.work_order_id}`)}>أمر العمل</Button>}
                    {r.claim_id && <Button size="sm" variant="outline" onClick={() => nav(`/insurance/${r.claim_id}`)}>المطالبة</Button>}
                  </div>
                </div>
              ))}
              {filtered.map((r) => (
                <div key={r.id} className="border border-border bg-card rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <Badge variant="outline">{EVENT_LABELS[r.event_type] || r.event_type}</Badge>
                    <Badge className={STATUS_COLORS[r.status] || ""}>{r.status}</Badge>
                    <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
                      {r.channel === "whatsapp" && <MessageCircle size={11} />}
                      {r.channel === "sms" && <Phone size={11} />}
                      {r.channel === "email" && <Mail size={11} />}
                      {r.channel}
                    </span>
                    <span className="text-[11px] text-muted-foreground" dir="ltr">{r.recipient || "—"}</span>
                    <span className="text-[10px] text-muted-foreground mr-auto">{new Date(r.created_at).toLocaleString("en-GB")}</span>
                  </div>
                  <p className="text-xs text-foreground whitespace-pre-wrap line-clamp-3 mb-2">{r.body}</p>
                  {r.error && <p className="text-[11px] text-rose-400 mb-2">⚠ {r.error}</p>}
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" onClick={() => send(r)} disabled={busyId === r.id}>
                      {busyId === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send size={12} />}
                      {r.status === "sent" ? " إعادة إرسال" : " إرسال"}
                    </Button>
                    {r.job_order_id && (
                      <Button size="sm" variant="outline" onClick={() => nav(`/work-orders/${r.job_order_id}`)}>
                        أمر العمل
                      </Button>
                    )}
                  </div>
                </div>
              ))}
              {filtered.length === 0 && logs.length === 0 && (
                <div className="text-center py-10 text-muted-foreground text-sm">لا توجد رسائل</div>
              )}
            </div>
          )}
        </TabsContent>

        <TabsContent value="notes">
          <Input placeholder="بحث في الملاحظات..." value={q} onChange={(e) => setQ(e.target.value)} className="mb-3 sm:max-w-xs" />
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="animate-spin text-muted-foreground" /></div>
          ) : filteredNotes.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">لا توجد ملاحظات من العملاء</div>
          ) : (
            <div className="space-y-2">
              {filteredNotes.map((n) => {
                const statusColor = n.status === "pending"
                  ? "bg-warning/10 border-warning/30"
                  : n.status === "approved"
                    ? "bg-success/5 border-success/30"
                    : "bg-destructive/5 border-destructive/30 opacity-80";
                return (
                  <div key={n.id} className={`border rounded-lg p-3 ${statusColor}`}>
                    <div className="flex justify-between items-start gap-2 mb-1 flex-wrap">
                      <div className="text-[10px] text-muted-foreground">
                        {n.customer_name || "عميل"} · {new Date(n.submitted_at).toLocaleString("en-GB")}
                      </div>
                      <div className="flex gap-1 items-center">
                        {n.status === "pending" ? (
                          <>
                            <Button size="sm" variant="default" disabled={busyId === n.id} onClick={() => reviewNote(n.id, "approved")} className="h-7 gap-1">
                              {busyId === n.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check size={12} />} قبول
                            </Button>
                            <Button size="sm" variant="destructive" disabled={busyId === n.id} onClick={() => reviewNote(n.id, "rejected")} className="h-7 gap-1">
                              <X size={12} /> رفض
                            </Button>
                          </>
                        ) : (
                          <Badge className={n.status === "approved" ? "bg-success/20 text-success border-success/30" : "bg-destructive/20 text-destructive border-destructive/30"}>
                            {n.status === "approved" ? "مقبولة" : "مرفوضة"}
                          </Badge>
                        )}
                        <Button size="sm" variant="outline" className="h-7" onClick={() => nav(`/work-orders/${n.job_order_id}`)}>أمر العمل</Button>
                      </div>
                    </div>
                    <p className="text-sm text-foreground whitespace-pre-wrap">{n.note}</p>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
