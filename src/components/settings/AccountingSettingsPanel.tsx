import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { readCloudSetting, subscribeCloudSetting, writeCloudSetting } from "@/lib/cloudSettings";

export interface AccountingReminderSettings {
  defaultInvoiceDueDays: number;
  enablePaymentReminders: boolean;
  reminderChannels: {
    whatsapp: boolean;
    email: boolean;
    phoneCallLog: boolean;
  };
  reminderFrequencyHours: number;
}

export const DEFAULT_ACCOUNTING_REMINDER_SETTINGS: AccountingReminderSettings = {
  defaultInvoiceDueDays: 7,
  enablePaymentReminders: true,
  reminderChannels: {
    whatsapp: true,
    email: false,
    phoneCallLog: true,
  },
  reminderFrequencyHours: 24,
};

const SETTING_KEY = "accounting_reminder_settings";

export default function AccountingSettingsPanel() {
  const [settings, setSettings] = useState<AccountingReminderSettings>(DEFAULT_ACCOUNTING_REMINDER_SETTINGS);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void readCloudSetting<AccountingReminderSettings>(SETTING_KEY, DEFAULT_ACCOUNTING_REMINDER_SETTINGS).then(setSettings);
    return subscribeCloudSetting<AccountingReminderSettings>(SETTING_KEY, setSettings);
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await writeCloudSetting(SETTING_KEY, {
        ...settings,
        defaultInvoiceDueDays: Math.max(1, Number(settings.defaultInvoiceDueDays) || 7),
        reminderFrequencyHours: Math.max(1, Number(settings.reminderFrequencyHours) || 24),
      });
      toast.success("تم حفظ إعدادات المحاسبة والتنبيهات");
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ إعدادات المحاسبة");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card className="space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Settings → Accounting</h3>
        <p className="text-xs text-muted-foreground">
          إعدادات الاستحقاق وتذكيرات الفواتير. تحفظ لكل ورشة/tenant في السحابة.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Default Invoice Due Days</label>
          <Input
            type="number"
            min={1}
            value={settings.defaultInvoiceDueDays}
            onChange={(event) => setSettings((prev) => ({ ...prev, defaultInvoiceDueDays: Number(event.target.value) }))}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs text-muted-foreground">Reminder Frequency / Hours</label>
          <Input
            type="number"
            min={1}
            value={settings.reminderFrequencyHours}
            onChange={(event) => setSettings((prev) => ({ ...prev, reminderFrequencyHours: Number(event.target.value) }))}
          />
        </div>
      </div>

      <div className="flex items-center justify-between rounded-lg border border-border p-3">
        <div>
          <p className="text-sm font-medium">Enable Payment Reminders</p>
          <p className="text-xs text-muted-foreground">إظهار تنبيهات الفواتير المستحقة وغير المدفوعة.</p>
        </div>
        <Switch
          checked={settings.enablePaymentReminders}
          onCheckedChange={(checked) => setSettings((prev) => ({ ...prev, enablePaymentReminders: checked }))}
        />
      </div>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        {[
          ["whatsapp", "WhatsApp"],
          ["email", "Email"],
          ["phoneCallLog", "Phone Call Log"],
        ].map(([key, label]) => (
          <label key={key} className="flex items-center justify-between rounded-lg border border-border p-3 text-sm">
            <span>{label}</span>
            <Switch
              checked={settings.reminderChannels[key as keyof AccountingReminderSettings["reminderChannels"]]}
              onCheckedChange={(checked) => setSettings((prev) => ({
                ...prev,
                reminderChannels: { ...prev.reminderChannels, [key]: checked },
              }))}
            />
          </label>
        ))}
      </div>

      <Button onClick={save} disabled={saving} className="gap-2">
        <Save size={14} /> حفظ إعدادات المحاسبة
      </Button>
    </Card>
  );
}
