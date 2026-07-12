import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, Save } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const DEFAULT_TEMPLATE_AR = `عزيزي العميل،
نود إفادتكم بأن مركبتكم موجودة لدى الورشة منذ {days} يومًا. يرجى التواصل معنا لمراجعة حالة المركبة والإجراءات المطلوبة، أو لتنسيق الاستلام عند جاهزيتها.
رقم أمر العمل: {work_order_number}

يمكنكم مراجعة شركة التأمين بشأن استحقاق سيارة بديلة أو بدل إيجار، وفقًا لشروط وثيقة التأمين وموافقة شركة التأمين.

شركة الوفاء للأعمال المتكاملة.`;

const DEFAULT_TEMPLATE_EN = `Dear customer,
Your vehicle has been at the workshop for {days} days. Please contact us to review the vehicle status and required actions, or to coordinate collection if it is ready.
Work order: {work_order_number}

You may contact your insurance company regarding replacement vehicle or rental benefit eligibility, subject to policy terms and insurance approval.

Al Wafa Integrated Business Company LLC.`;

export default function VehicleStayAlertsSettingsPage() {
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: ["vehicle-stay-alert-rule"],
    queryFn: async () => {
      const { data: tenantId, error: tenantError } = await supabase.rpc("get_user_tenant_id");
      if (tenantError) throw tenantError;
      const { data: rule, error } = await supabase
        .from("notification_rules" as any)
        .select("*")
        .eq("tenant_id", tenantId as string)
        .eq("rule_key", "vehicle_stay_alerts")
        .maybeSingle();
      if (error) throw error;
      return rule || {
        tenant_id: tenantId,
        rule_key: "vehicle_stay_alerts",
        enabled: true,
        trigger_days: 30,
        repeat_every_days: 7,
        send_mode: "draft_requires_review",
        channels: ["internal", "whatsapp", "email"],
        require_approval: true,
        template_ar: DEFAULT_TEMPLATE_AR,
        template_en: DEFAULT_TEMPLATE_EN,
      };
    },
  });

  const [form, setForm] = useState<any>(null);
  useEffect(() => setForm(data || null), [data]);

  const saveMut = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("notification_rules" as any)
        .upsert(form, { onConflict: "tenant_id,rule_key" } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["vehicle-stay-alert-rule"] });
      toast.success("تم حفظ إعدادات تنبيهات بقاء المركبة");
    },
    onError: (error: any) => toast.error(error?.message || "فشل الحفظ"),
  });

  if (!form) return <Card className="p-8 text-center text-muted-foreground">جاري التحميل...</Card>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Bell className="text-primary" /> Vehicle Stay Alerts
        </h1>
        <p className="text-sm text-muted-foreground">
          القاعدة الافتراضية: تنبيه داخلي أولًا، ثم مسودة رسالة ينتظرها الموظف للمراجعة. لا يوجد إرسال تلقائي كامل.
        </p>
      </div>

      <Card className="p-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label>تفعيل تنبيه 30 يومًا</Label>
            <p className="text-xs text-muted-foreground">يحسب من تاريخ دخول المركبة الورشة حتى التسليم.</p>
          </div>
          <Switch checked={Boolean(form.enabled)} onCheckedChange={(checked) => setForm({ ...form, enabled: checked })} />
        </div>
        <div>
          <Label>أول تنبيه للعميل بعد</Label>
          <Input type="number" value={form.trigger_days} onChange={(e) => setForm({ ...form, trigger_days: Number(e.target.value) })} />
        </div>
        <div>
          <Label>التكرار كل / أيام</Label>
          <Input type="number" value={form.repeat_every_days} onChange={(e) => setForm({ ...form, repeat_every_days: Number(e.target.value) })} />
        </div>
        <div>
          <Label>وضع الإرسال</Label>
          <Select value={form.send_mode} onValueChange={(v) => setForm({ ...form, send_mode: v, require_approval: v !== "automatic" })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="internal_only">تنبيه داخلي فقط</SelectItem>
              <SelectItem value="draft_requires_review">مسودة تحتاج مراجعة الموظف</SelectItem>
              <SelectItem value="send_after_approval">إرسال بعد موافقة الموظف</SelectItem>
              <SelectItem value="automatic">إرسال تلقائي بالكامل</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Card className="p-4 space-y-4">
        <div>
          <Label>القالب العربي</Label>
          <Textarea rows={7} value={form.template_ar || ""} onChange={(e) => setForm({ ...form, template_ar: e.target.value })} />
        </div>
        <div>
          <Label>English template</Label>
          <Textarea rows={7} dir="ltr" value={form.template_en || ""} onChange={(e) => setForm({ ...form, template_en: e.target.value })} />
        </div>
        <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="gap-2">
          <Save size={16} /> حفظ الإعدادات
        </Button>
      </Card>
    </div>
  );
}

