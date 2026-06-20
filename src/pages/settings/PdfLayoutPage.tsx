import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RotateCcw, Save, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { toast } from "sonner";
import { smartBack } from "@/lib/smartBack";
import { pdfLayoutStore, DEFAULT_PDF_LAYOUT, buildPageMarginCss, type PdfLayoutSettings } from "@/lib/pdfLayoutSettings";

export default function PdfLayoutPage() {
  const navigate = useNavigate();
  const [s, setS] = useState<PdfLayoutSettings>(pdfLayoutStore.get());

  useEffect(() => pdfLayoutStore.subscribe(() => setS(pdfLayoutStore.get())), []);

  const save = () => {
    pdfLayoutStore.update(s);
    toast.success("تم حفظ إعدادات الهوامش — ستُطبَّق فوراً على جميع المستخرجات");
  };
  const reset = () => {
    pdfLayoutStore.reset();
    setS(pdfLayoutStore.get());
    toast.success("تمت استعادة القيم الافتراضية (15/18 مم)");
  };

  const previewCss = buildPageMarginCss({ ...s, enforce: true });

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings")}>
            <ArrowLeft className="rtl:rotate-180" />
          </Button>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
              <FileText className="text-primary" />
              هوامش وتنسيق صفحات PDF
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              قِيَم موحَّدة تُطبَّق على كل المستخرجات (فواتير، أوامر العمل، السندات، التقديرات، إيصالات التسليم، طلبات القطع) سواءً عند الطباعة أو تنزيل PDF.
            </p>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5 space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="font-semibold">فرض الهوامش الموحَّدة</div>
              <div className="text-xs text-muted-foreground">عند الإيقاف يستخدم كل قالب هوامشه الافتراضية</div>
            </div>
            <Switch checked={s.enforce} onCheckedChange={(v) => setS({ ...s, enforce: v })} />
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">الهامش الرأسي (أعلى وأسفل)</label>
              <Input
                type="number"
                min={0}
                max={40}
                value={s.verticalMm}
                onChange={(e) => setS({ ...s, verticalMm: Number(e.target.value) || 0 })}
                className="w-24 text-center"
              />
            </div>
            <Slider
              value={[s.verticalMm]}
              min={0}
              max={40}
              step={1}
              onValueChange={(v) => setS({ ...s, verticalMm: v[0] })}
            />
            <div className="text-xs text-muted-foreground">القيمة الحالية: {s.verticalMm} مم (الافتراضي 15 مم)</div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">الهامش الأفقي (يمين ويسار)</label>
              <Input
                type="number"
                min={0}
                max={40}
                value={s.horizontalMm}
                onChange={(e) => setS({ ...s, horizontalMm: Number(e.target.value) || 0 })}
                className="w-24 text-center"
              />
            </div>
            <Slider
              value={[s.horizontalMm]}
              min={0}
              max={40}
              step={1}
              onValueChange={(v) => setS({ ...s, horizontalMm: v[0] })}
            />
            <div className="text-xs text-muted-foreground">القيمة الحالية: {s.horizontalMm} مم (الافتراضي 18 مم)</div>
          </div>

          {/* Visual preview of the A4 page proportions */}
          <div className="border border-dashed border-border rounded-lg p-4 bg-muted/30">
            <div className="text-xs text-muted-foreground mb-2">معاينة نسبية لصفحة A4:</div>
            <div className="mx-auto bg-white border border-border shadow-sm" style={{ width: 210, height: 297 }}>
              <div
                className="bg-primary/10 border border-primary/30 h-full"
                style={{ margin: `${s.verticalMm}px ${s.horizontalMm}px` }}
              >
                <div className="p-2 text-[10px] text-primary font-mono">
                  محتوى الصفحة<br />
                  {s.verticalMm} × {s.horizontalMm} mm
                </div>
              </div>
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2 border-t border-border">
            <Button variant="outline" onClick={reset} className="gap-2">
              <RotateCcw size={16} /> القيم الافتراضية
            </Button>
            <Button onClick={save} className="gap-2">
              <Save size={16} /> حفظ
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl p-5">
          <div className="text-sm font-semibold mb-2">المستندات المتأثرة</div>
          <ul className="text-xs text-muted-foreground space-y-1 list-disc pr-5">
            <li>فواتير البيع والضريبية وأوامر العمل وتقدير المطالبة والتقديرات المستقلة</li>
            <li>سندات القبض والصرف وكشوف الحساب</li>
            <li>إيصالات تسليم/استلام السيارة وطلبات القطع</li>
            <li>تقارير المحاسبة والمخزون وكشوف التأمين</li>
          </ul>
          <details className="mt-3">
            <summary className="text-xs cursor-pointer text-muted-foreground">عرض قواعد CSS المُطبَّقة</summary>
            <pre className="mt-2 text-[10px] bg-muted/40 p-2 rounded overflow-auto">{previewCss || "/* فرض الهوامش معطل */"}</pre>
          </details>
        </div>
      </div>
    </div>
  );
}
