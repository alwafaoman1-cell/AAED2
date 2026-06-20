import { useEffect, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Key, CheckCircle2, AlertTriangle, ExternalLink, Loader2, Copy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

type ProviderStatus = {
  active: "lovable" | "openai" | "gemini" | "none";
  providers: { lovable: boolean; openai: boolean; gemini: boolean };
};

const PROVIDER_META = {
  lovable: { name: "Lovable AI Gateway", env: "LOVABLE_API_KEY", url: "https://lovable.dev", note: "افتراضي داخل Lovable Cloud — لا يعمل خارجها." },
  openai:  { name: "OpenAI",              env: "OPENAI_API_KEY",  url: "https://platform.openai.com/api-keys", note: "موصى به للاستضافة المستقلة. مفتاح يبدأ بـ sk-..." },
  gemini:  { name: "Google Gemini",       env: "GEMINI_API_KEY",  url: "https://aistudio.google.com/apikey", note: "بديل اقتصادي. مفتاح من Google AI Studio." },
} as const;

export default function AiKeysSettingsPage() {
  const { profile } = useAuth();
  const [status, setStatus] = useState<ProviderStatus | null>(null);
  const [loading, setLoading] = useState(true);

  const isAdmin = profile?.role === "admin" || profile?.role === "manager";

  async function load() {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("ai-provider-status");
      if (error) throw error;
      setStatus(data as ProviderStatus);
    } catch (e: any) {
      toast.error("تعذر قراءة حالة المزود");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  if (!isAdmin) {
    return (
      <Card className="p-8 text-center">
        <AlertTriangle className="mx-auto mb-3 text-warning" size={32} />
        <p>هذه الصفحة متاحة للمدير العام فقط.</p>
      </Card>
    );
  }

  const active = status?.active ?? "none";

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Key className="text-primary" /> مفاتيح الذكاء الاصطناعي (AI Keys)
        </h1>
        <p className="text-sm text-muted-foreground mt-1">
          يُستخدم الذكاء الاصطناعي حالياً في: <strong>قراءة رقم الهيكل (VIN OCR)</strong> و <strong>الترجمة التلقائية</strong>.
          عند نقل النظام لاستضافة مستقلة، أضف مفتاح OpenAI أو Gemini ليستمر عملها.
        </p>
      </div>

      {/* الحالة الحالية */}
      <Card className="p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold">المزود النشط حالياً</h2>
          <Button variant="ghost" size="sm" onClick={load} disabled={loading} className="gap-1">
            {loading && <Loader2 className="animate-spin" size={14} />} تحديث
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Loader2 className="animate-spin" size={16} /> جاري الفحص…
          </div>
        ) : active === "none" ? (
          <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-start gap-3">
            <AlertTriangle className="text-destructive shrink-0 mt-0.5" size={20} />
            <div>
              <div className="font-medium text-destructive">لا يوجد مفتاح ذكاء اصطناعي مهيّأ</div>
              <div className="text-sm text-muted-foreground mt-1">
                دوال VIN والترجمة معطّلة. اتبع الخطوات أدناه لإضافة مفتاح.
              </div>
            </div>
          </div>
        ) : (
          <div className="bg-success/10 border border-success/30 rounded-lg p-4 flex items-start gap-3">
            <CheckCircle2 className="text-success shrink-0 mt-0.5" size={20} />
            <div className="flex-1">
              <div className="font-medium text-success">
                {PROVIDER_META[active].name} نشط
              </div>
              <div className="text-sm text-muted-foreground mt-1">
                المفتاح <code className="bg-secondary px-1.5 py-0.5 rounded text-xs" dir="ltr">{PROVIDER_META[active].env}</code> مهيّأ ويُستخدم لجميع طلبات AI.
              </div>
            </div>
          </div>
        )}
      </Card>

      {/* قائمة المزودين */}
      <Card className="p-5">
        <h2 className="font-semibold mb-4">المزودون المدعومون</h2>
        <div className="space-y-3">
          {(["lovable", "openai", "gemini"] as const).map((p) => {
            const meta = PROVIDER_META[p];
            const configured = status?.providers[p];
            const isActive = active === p;
            return (
              <div key={p} className={`border rounded-lg p-4 ${isActive ? "border-success bg-success/5" : "border-border"}`}>
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <div className="font-medium flex items-center gap-2">
                      {meta.name}
                      {isActive && <Badge className="bg-success text-success-foreground">نشط</Badge>}
                      {configured && !isActive && <Badge variant="outline">مهيّأ</Badge>}
                      {!configured && <Badge variant="outline" className="text-muted-foreground">غير مهيّأ</Badge>}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">{meta.note}</div>
                  </div>
                  <a href={meta.url} target="_blank" rel="noreferrer">
                    <Button variant="ghost" size="sm" className="gap-1">
                      <ExternalLink size={14} /> الحصول على مفتاح
                    </Button>
                  </a>
                </div>
                <div className="flex items-center gap-2 bg-secondary/50 rounded px-3 py-2 text-sm font-mono" dir="ltr">
                  <code className="flex-1">{meta.env}</code>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { navigator.clipboard.writeText(meta.env); toast.success("تم النسخ"); }}
                    className="h-7"
                  >
                    <Copy size={12} />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 text-xs text-muted-foreground bg-muted/30 rounded-lg p-3">
          <strong>الأولوية:</strong> Lovable → OpenAI → Gemini. النظام يستخدم أول مفتاح متوفر من القائمة.
        </div>
      </Card>

      {/* تعليمات الإضافة */}
      <Card className="p-5 space-y-4">
        <h2 className="font-semibold">كيفية إضافة المفتاح</h2>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-primary">على Lovable Cloud (داخل Lovable)</h3>
          <p className="text-sm text-muted-foreground">
            اكتب في المحادثة: <em>"أضف مفتاح OPENAI_API_KEY"</em> وسيظهر لك نموذج آمن لإدخاله. لا تشارك المفتاح في المحادثة مباشرة.
          </p>
        </div>

        <div className="space-y-2">
          <h3 className="text-sm font-medium text-primary">على Supabase الخاص بك (بعد النقل)</h3>
          <ol className="text-sm text-muted-foreground space-y-1 list-decimal pr-5">
            <li>افتح لوحة Supabase → <strong>Project Settings</strong> → <strong>Edge Functions</strong> → <strong>Manage secrets</strong>.</li>
            <li>اضغط <strong>Add new secret</strong>.</li>
            <li>الاسم: <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">OPENAI_API_KEY</code> (أو <code className="bg-secondary px-1.5 py-0.5 rounded text-xs">GEMINI_API_KEY</code>).</li>
            <li>الصق المفتاح واحفظ. يصبح نشطاً فوراً لجميع الـ Edge Functions.</li>
          </ol>
        </div>

        <div className="bg-warning/5 border border-warning/20 rounded-lg p-3 text-xs flex items-start gap-2">
          <AlertTriangle className="text-warning shrink-0 mt-0.5" size={14} />
          <div>
            <strong>تنبيه أمني:</strong> لا تضع المفتاح في كود الواجهة أو ملف <code>.env</code> العام. المفاتيح تُحفظ فقط في أسرار Edge Functions السرية.
          </div>
        </div>
      </Card>
    </div>
  );
}
