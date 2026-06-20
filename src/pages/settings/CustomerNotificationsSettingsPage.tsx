import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Loader2, Save, Bell } from "lucide-react";
import { toast } from "sonner";

interface Setting {
  id: string;
  tenant_id: string;
  event_type: string;
  enabled: boolean;
  auto_send: boolean;
  default_channel: string;
  template_ar: string | null;
  template_en: string | null;
}

const EVENT_LABELS: Record<string, string> = {
  received: "تم الاستلام",
  inspection_started: "بدأ الفحص",
  waiting_insurance: "بانتظار التأمين",
  insurance_approved: "اعتماد التأمين",
  waiting_parts: "بانتظار القطع",
  parts_arrived: "وصلت القطع",
  repair_started: "بدأ الإصلاح",
  supplement_pending: "موافقة إضافية",
  ready_for_pickup: "جاهز للاستلام",
  delivered: "تم التسليم",
};

export default function CustomerNotificationsSettingsPage() {
  const [rows, setRows] = useState<Setting[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    // get tenant
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return setLoading(false);
    const { data: prof } = await supabase.from("profiles").select("tenant_id").eq("user_id", u.user.id).maybeSingle();
    const tenantId = prof?.tenant_id;
    if (!tenantId) return setLoading(false);

    // seed defaults
    await supabase.rpc("seed_default_notification_settings", { p_tenant_id: tenantId });

    const { data } = await supabase
      .from("customer_notification_settings")
      .select("*")
      .order("event_type");
    setRows((data || []) as Setting[]);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function save(r: Setting) {
    setSaving(r.id);
    const { error } = await supabase
      .from("customer_notification_settings")
      .update({
        enabled: r.enabled,
        auto_send: r.auto_send,
        default_channel: r.default_channel,
        template_ar: r.template_ar,
        template_en: r.template_en,
      })
      .eq("id", r.id);
    setSaving(null);
    if (error) toast.error(error.message);
    else toast.success("تم الحفظ ✓");
  }

  function update(i: number, patch: Partial<Setting>) {
    setRows((p) => p.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  if (loading) return <div className="p-10 text-center"><Loader2 className="animate-spin inline" /></div>;

  return (
    <div className="p-4 max-w-4xl mx-auto" dir="rtl">
      <div className="flex items-center gap-2 mb-4">
        <Bell className="text-primary" size={20} />
        <h1 className="text-lg font-bold">إعدادات إشعارات العملاء</h1>
      </div>
      <p className="text-xs text-muted-foreground mb-4">
        تحكم في الإشعارات التلقائية لكل حدث. المتغيرات المتاحة:
        <code className="mx-1 bg-secondary/40 px-1 rounded">{"{name}"}</code>
        <code className="mx-1 bg-secondary/40 px-1 rounded">{"{order}"}</code>
        <code className="mx-1 bg-secondary/40 px-1 rounded">{"{link}"}</code>
      </p>

      <div className="space-y-3">
        {rows.map((r, i) => (
          <div key={r.id} className="border border-border bg-card rounded-xl p-4">
            <div className="flex items-center gap-3 flex-wrap mb-3">
              <h3 className="font-bold text-sm">{EVENT_LABELS[r.event_type] || r.event_type}</h3>
              <div className="flex items-center gap-2 mr-auto">
                <Label className="text-[11px]">مفعّل</Label>
                <Switch checked={r.enabled} onCheckedChange={(v) => update(i, { enabled: v })} />
                <Label className="text-[11px] ml-2">إرسال تلقائي</Label>
                <Switch checked={r.auto_send} onCheckedChange={(v) => update(i, { auto_send: v })} />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-2">
              <div>
                <Label className="text-[11px]">القناة</Label>
                <Select value={r.default_channel} onValueChange={(v) => update(i, { default_channel: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="whatsapp">واتساب</SelectItem>
                    <SelectItem value="sms">SMS</SelectItem>
                    <SelectItem value="email">بريد</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Textarea
                rows={2}
                placeholder="القالب العربي"
                value={r.template_ar || ""}
                onChange={(e) => update(i, { template_ar: e.target.value })}
                className="sm:col-span-3"
                dir="rtl"
              />
            </div>
            <Textarea
              rows={2}
              placeholder="English template"
              value={r.template_en || ""}
              onChange={(e) => update(i, { template_en: e.target.value })}
              dir="ltr"
            />
            <div className="flex justify-end mt-2">
              <Button size="sm" onClick={() => save(r)} disabled={saving === r.id}>
                {saving === r.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save size={12} />}
                {" "}حفظ
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
