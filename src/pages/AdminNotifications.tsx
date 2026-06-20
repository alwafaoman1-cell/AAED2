import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { toast } from "sonner";
import { adminNotificationsStore, type AdminNotification, type AdminNotifType } from "@/lib/adminNotificationsStore";
import { Bell, Send, Trash2, Info, AlertTriangle, AlertOctagon, CheckCircle2, XCircle } from "lucide-react";
import { Navigate } from "react-router-dom";

const TYPE_META: Record<AdminNotifType, { label: string; icon: any; color: string }> = {
  info:    { label: "معلومات", icon: Info,         color: "text-sky-500" },
  warning: { label: "تنبيه",   icon: AlertTriangle, color: "text-amber-500" },
  urgent:  { label: "عاجل",    icon: AlertOctagon,  color: "text-red-500" },
  success: { label: "نجاح",    icon: CheckCircle2,  color: "text-emerald-500" },
  error:   { label: "خطأ",     icon: XCircle,       color: "text-rose-500" },
};

export default function AdminNotifications() {
  const { profile } = useAuth();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [type, setType] = useState<AdminNotifType>("info");
  const [link, setLink] = useState("");
  const [sending, setSending] = useState(false);
  const [items, setItems] = useState<AdminNotification[]>([]);

  useEffect(() => {
    adminNotificationsStore.init().then(() => setItems(adminNotificationsStore.list()));
    const unsub = adminNotificationsStore.subscribe(() => setItems(adminNotificationsStore.list()));
    return () => { unsub(); };
  }, []);

  if (profile && profile.role !== "admin" && profile.role !== "manager") {
    return <Navigate to="/" replace />;
  }

  async function handleSend() {
    if (!title.trim() || !body.trim()) {
      toast.error("الرجاء إدخال العنوان والنص");
      return;
    }
    setSending(true);
    try {
      await adminNotificationsStore.send({ title, body, type, link: link || undefined });
      toast.success("تم إرسال الإشعار لجميع المستخدمين");
      setTitle(""); setBody(""); setLink(""); setType("info");
    } catch (e: any) {
      toast.error(e?.message || "تعذّر إرسال الإشعار");
    } finally { setSending(false); }
  }

  async function handleDelete(id: string) {
    if (!confirm("حذف هذا الإشعار للجميع؟")) return;
    const { supabase } = await import("@/integrations/supabase/client");
    const { error } = await supabase.from("admin_notifications").delete().eq("id", id);
    if (error) toast.error(error.message);
    else toast.success("تم الحذف");
  }

  return (
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <Bell className="text-primary" size={24} />
        <h1 className="text-2xl font-bold">مركز إشعارات المدير</h1>
      </div>

      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">إنشاء إشعار جديد</h2>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>العنوان *</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="مثال: اجتماع طارئ" />
          </div>
          <div className="space-y-1.5">
            <Label>نوع الإشعار</Label>
            <Select value={type} onValueChange={(v) => setType(v as AdminNotifType)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_META) as AdminNotifType[]).map((k) => (
                  <SelectItem key={k} value={k}>{TYPE_META[k].label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="space-y-1.5">
          <Label>نص الإشعار *</Label>
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={4} maxLength={2000} />
        </div>
        <div className="space-y-1.5">
          <Label>رابط مرفق (اختياري) — يمكن وضع رابط مطالبة أو سيارة</Label>
          <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="/insurance/...  أو  /work-orders/..." dir="ltr" />
        </div>
        <Button onClick={handleSend} disabled={sending} className="gap-2">
          <Send size={16} /> {sending ? "جاري الإرسال..." : "إرسال للجميع"}
        </Button>
      </Card>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">الإشعارات المُرسلة ({items.length})</h2>
        {items.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">لا توجد إشعارات بعد</div>
        ) : (
          <div className="space-y-3">
            {items.map((n) => {
              const meta = TYPE_META[n.type] || TYPE_META.info;
              const Icon = meta.icon;
              return (
                <div key={n.id} className="border border-border rounded-lg p-3 flex items-start gap-3">
                  <Icon className={meta.color + " mt-0.5 shrink-0"} size={20} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold">{n.title}</span>
                      <span className="text-xs px-2 py-0.5 rounded-full bg-secondary">{meta.label}</span>
                    </div>
                    <div className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap break-words">{n.body}</div>
                    {n.link && <div className="text-xs text-primary mt-1 truncate" dir="ltr">{n.link}</div>}
                    <div className="text-[11px] text-muted-foreground mt-1">
                      {n.sender_name || "المدير"} — {new Date(n.created_at).toLocaleString("ar")}
                    </div>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => handleDelete(n.id)} title="حذف للجميع">
                    <Trash2 size={16} className="text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
