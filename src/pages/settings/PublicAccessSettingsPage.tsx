import { useEffect, useState } from "react";
import { ExternalLink, Eye, EyeOff, Globe, KeyRound, Save, ShieldCheck, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  loadPublicAccessSettings,
  savePublicAccessSettings,
} from "@/lib/publicAccessSettingsStore";

const PRESETS = [
  "https://temo.live",
  "https://www.temo.live",
  "https://aaed-2.vercel.app",
];

export default function PublicAccessSettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadPublicAccessSettings()
      .then((settings) => {
        if (cancelled) return;
        setPassword(settings.masterPassword || "");
        setBaseUrl(settings.publicBaseUrl || "");
      })
      .catch((error) => {
        toast.error(error?.message || "تعذر تحميل إعدادات الوصول العام");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  async function saveSettings(next: { masterPassword?: string; publicBaseUrl?: string }, message: string) {
    setSaving(true);
    try {
      const saved = await savePublicAccessSettings(next);
      setPassword(saved.masterPassword || "");
      setBaseUrl(saved.publicBaseUrl || "");
      toast.success(message);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ إعدادات الوصول العام");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePassword() {
    await saveSettings(
      { masterPassword: password.trim() },
      password.trim() ? "تم حفظ كلمة المرور الرئيسية" : "تم تعطيل كلمة المرور الرئيسية",
    );
  }

  async function handleClearPassword() {
    setPassword("");
    await saveSettings({ masterPassword: "" }, "تم مسح كلمة المرور الرئيسية");
  }

  async function saveBaseUrl() {
    const value = baseUrl.trim().replace(/\/+$/, "");
    if (value && !/^https?:\/\//i.test(value)) {
      toast.error("الرابط يجب أن يبدأ بـ https:// أو http://");
      return;
    }
    await saveSettings(
      { publicBaseUrl: value },
      value ? `تم اعتماد ${value} لروابط QR` : "سيتم استخدام دومين المتصفح الحالي",
    );
  }

  async function clearBaseUrl() {
    setBaseUrl("");
    await saveSettings({ publicBaseUrl: "" }, "تم مسح الدومين المخصص");
  }

  if (loading) {
    return <div className="p-6 text-sm text-muted-foreground">جارِ تحميل إعدادات الوصول العام…</div>;
  }

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" />
          إعدادات الوصول العام
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          إعدادات روابط QR والبوابة العامة. تُحفظ لكل tenant في Supabase ولا تعتمد على هذا الجهاز فقط.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Globe size={14} className="text-primary" />
            الدومين المعتمد لروابط QR والبوابة
          </label>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://aaed-2.vercel.app"
              className="bg-secondary border-border font-mono text-sm"
              autoComplete="off"
            />
            <Button onClick={saveBaseUrl} disabled={saving} className="gap-2 shrink-0">
              <Save size={14} /> حفظ
            </Button>
            {baseUrl && (
              <Button variant="outline" onClick={clearBaseUrl} disabled={saving} className="border-border shrink-0" title="مسح">
                <Trash2 size={14} />
              </Button>
            )}
          </div>

          <div className="flex flex-wrap gap-1.5 pt-1">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setBaseUrl(preset)}
                className="text-[11px] font-mono px-2 py-1 rounded border border-border bg-secondary/40 hover:bg-secondary text-foreground"
                dir="ltr"
              >
                {preset}
              </button>
            ))}
          </div>

          <p className="text-[11px] text-muted-foreground leading-relaxed">
            • يُستخدم في روابط <code className="font-mono">/p/...</code> للبوابة العامة والتتبع.<br />
            • اتركه فارغًا لاستخدام دومين المتصفح الحالي تلقائيًا.<br />
            • لا تضع مفاتيح أو أسرار هنا؛ هذا الحقل للدومين العام فقط.
          </p>

          {baseUrl && (
            <a
              href={baseUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              dir="ltr"
            >
              <ExternalLink size={12} /> فتح {baseUrl}
            </a>
          )}
        </div>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <KeyRound size={14} className="text-primary" />
            كلمة المرور الرئيسية للبوابة العامة
          </label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="اتركها فارغة لتعطيلها"
              className="bg-secondary border-border pr-3 pl-10 font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-muted text-muted-foreground"
              title={showPassword ? "إخفاء" : "إظهار"}
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            • هذه كلمة حماية إضافية لصفحات البوابة العامة.<br />
            • لا تُلغي تحقق الهاتف أو رموز الروابط القصيرة، بل تضيف طبقة حماية إضافية.<br />
            • لا تُعرض للعميل ولا تُخزن داخل LocalStorage كمصدر تشغيلي.
          </p>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={handleSavePassword} disabled={saving} className="gradient-gold text-primary-foreground gap-2">
            <Save size={14} /> حفظ
          </Button>
          <Button variant="outline" onClick={handleClearPassword} disabled={saving} className="border-border gap-2">
            <Trash2 size={14} /> مسح
          </Button>
        </div>
      </div>
    </div>
  );
}
