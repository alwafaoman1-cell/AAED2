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
import { MessageCircle, Mail, Phone, RefreshCw, Send, Loader2, Inbox, MessageSquare, Check, X } from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";

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

  async function load() {
    setLoading(true);
    const [{ data: msgs }, { data: ns }] = await Promise.all([
      supabase.from("customer_notifications").select("*").order("created_at", { ascending: false }).limit(500),
      supabase.from("customer_portal_notes").select("id, job_order_id, note, customer_name, status, submitted_at").order("submitted_at", { ascending: false }).limit(500),
    ]);
    setRows((msgs || []) as Row[]);
    setNotes((ns || []) as PortalNote[]);
    setLoading(false);
  }

  useEffect(() => {
    load();
    const ch = supabase
      .channel("messages_center_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "customer_notifications" }, () => load())
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
        <h1 className="text-lg font-bold">المراسلات</h1>
        <Button size="sm" variant="ghost" onClick={load} className="mr-auto"><RefreshCw size={14} /></Button>
      </div>

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
            <MessageCircle size={14} /> رسائل العملاء
            <Badge variant="outline" className="ms-1">{rows.length}</Badge>
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
              {filtered.length === 0 && (
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
