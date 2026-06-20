import { useEffect, useState } from "react";
import { KeyRound, ShieldCheck, Eye, EyeOff, Save, Trash2, Globe, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import {
  getPublicAccessSettings,
  savePublicAccessSettings,
} from "@/lib/publicAccessSettingsStore";

const PRESETS = [
  "https://temo.live",
  "https://www.temo.live",
  "https://autopro1.lovable.app",
];

export default function PublicAccessSettingsPage() {
  const [pwd, setPwd] = useState("");
  const [show, setShow] = useState(false);
  const [baseUrl, setBaseUrl] = useState("");

  useEffect(() => {
    const s = getPublicAccessSettings();
    setPwd(s.masterPassword || "");
    setBaseUrl(s.publicBaseUrl || "");
  }, []);

  function handleSave() {
    savePublicAccessSettings({ masterPassword: pwd.trim() });
    toast.success(pwd.trim() ? "تم حفظ كلمة المرور الرئيسية" : "تم تعطيل كلمة المرور الرئيسية");
  }

  function handleClear() {
    setPwd("");
    savePublicAccessSettings({ masterPassword: "" });
    toast.success("تم مسح كلمة المرور الرئيسية");
  }

  function saveBaseUrl() {
    const v = baseUrl.trim().replace(/\/+$/, "");
    if (v && !/^https?:\/\//i.test(v)) {
      toast.error("الرابط يجب أن يبدأ بـ https:// أو http://");
      return;
    }
    savePublicAccessSettings({ publicBaseUrl: v });
    setBaseUrl(v);
    toast.success(v ? `تم اعتماد ${v} لروابط QR` : "تم استخدام دومين المتصفح الحالي");
  }

  function clearBaseUrl() {
    setBaseUrl("");
    savePublicAccessSettings({ publicBaseUrl: "" });
    toast.success("تم مسح الدومين المخصّص");
  }

  return (
    <div className="space-y-6 max-w-2xl" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
          <ShieldCheck size={22} className="text-primary" /> إعدادات الوصول العام
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          كلمة السر الرئيسية للوصول العام + الدومين المعتمد لأكواد QR والروابط المُشاركة.
        </p>
      </div>

      {/* ===== Public Base URL (QR domain) ===== */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Globe size={14} className="text-primary" /> الدومين المعتمد لأكواد QR
          </label>
          <div className="flex gap-2">
            <Input
              dir="ltr"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://temo.live"
              className="bg-secondary border-border font-mono text-sm"
              autoComplete="off"
            />
            <Button onClick={saveBaseUrl} className="gap-2 shrink-0">
              <Save size={14} /> حفظ
            </Button>
            {baseUrl && (
              <Button variant="outline" onClick={clearBaseUrl} className="border-border shrink-0" title="مسح">
                <Trash2 size={14} />
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {PRESETS.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setBaseUrl(p)}
                className="text-[11px] font-mono px-2 py-1 rounded border border-border bg-secondary/40 hover:bg-secondary text-foreground"
                dir="ltr"
              >
                {p}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            • يُستخدم في: مشاركة بطاقة المركبة <code className="font-mono">/v/...</code>،
            ملصق تتبع أمر العمل <code className="font-mono">/track/...</code>،
            وصفحة تثبيت التطبيق <code className="font-mono">/install</code>.<br/>
            • اتركه فارغاً لاستخدام دومين المتصفح الحالي تلقائياً.<br/>
            • يُحفظ محلياً على هذا الجهاز فقط.
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

      {/* ===== Master password ===== */}
      <div className="bg-card border border-border rounded-xl p-5 space-y-4">
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <KeyRound size={14} className="text-primary" /> كلمة المرور الرئيسية
          </label>
          <div className="relative">
            <Input
              type={show ? "text" : "password"}
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="اتركها فارغة لتعطيلها"
              className="bg-secondary border-border pr-3 pl-10 font-mono"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setShow((v) => !v)}
              className="absolute left-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-muted text-muted-foreground"
              title={show ? "إخفاء" : "إظهار"}
            >
              {show ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground leading-relaxed">
            • تعمل هذه الكلمة في جميع صفحات <code className="font-mono">/track/...</code> و <code className="font-mono">/v/...</code>.<br/>
            • لا تُلغي كلمة هاتف العميل أو الكلمة المخصصة — تُضاف إليها.<br/>
            • تُحفظ محلياً على هذا الجهاز فقط ولا تظهر للعميل.
          </p>
        </div>

        <div className="flex gap-2 pt-2 border-t border-border">
          <Button onClick={handleSave} className="gradient-gold text-primary-foreground gap-2">
            <Save size={14} /> حفظ
          </Button>
          <Button variant="outline" onClick={handleClear} className="border-border gap-2">
            <Trash2 size={14} /> مسح
          </Button>
        </div>
      </div>
    </div>
  );
}
