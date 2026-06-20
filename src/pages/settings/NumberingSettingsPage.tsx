import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Hash, RotateCcw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { smartBack } from "@/lib/smartBack";
import { numberingStore, DEFAULT_NUMBERING, type NumberSeries, type NumberSeriesConfig } from "@/lib/numberingSettings";

export default function NumberingSettingsPage() {
  const navigate = useNavigate();
  const [data, setData] = useState<Record<NumberSeries, NumberSeriesConfig>>(numberingStore.get());

  useEffect(() => numberingStore.subscribe(() => setData(numberingStore.get())), []);

  const updateField = (series: NumberSeries, patch: Partial<NumberSeriesConfig>) => {
    setData((d) => ({ ...d, [series]: { ...d[series], ...patch } }));
  };

  const save = () => {
    for (const k of Object.keys(data) as NumberSeries[]) {
      numberingStore.update(k, data[k]);
    }
    toast.success("تم حفظ إعدادات الترقيم — ستُطبَّق على كل المستندات الجديدة");
  };

  const reset = () => {
    numberingStore.reset();
    setData(numberingStore.get());
    toast.success("تمت استعادة الإعدادات الافتراضية");
  };

  const previewNumber = (cfg: NumberSeriesConfig) =>
    `${cfg.prefix}-${new Date().getFullYear()}-${String(cfg.startFrom).padStart(cfg.padding, "0")}`;

  const series = Object.keys(DEFAULT_NUMBERING) as NumberSeries[];

  return (
    <div className="min-h-screen bg-background p-6 md:p-8">
      <div className="max-w-5xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Button variant="ghost" size="icon" onClick={() => smartBack(navigate, "/settings")}>
              <ArrowLeft className="rtl:rotate-180" />
            </Button>
            <div>
              <h1 className="text-2xl md:text-3xl font-bold flex items-center gap-2">
                <Hash className="text-primary" />
                إعدادات الترقيم التسلسلي
              </h1>
              <p className="text-sm text-muted-foreground mt-1">
                حدِّد رقم البداية وعدد الأصفار لكل سلسلة مستندات. عند الإنشاء سيستخدم النظام الأكبر بين هذا الرقم وآخر رقم موجود.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={reset} className="gap-2">
              <RotateCcw size={16} /> افتراضي
            </Button>
            <Button onClick={save} className="gap-2">
              <Save size={16} /> حفظ الكل
            </Button>
          </div>
        </div>

        <div className="bg-card border border-border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-right p-3 font-semibold">السلسلة</th>
                <th className="text-right p-3 font-semibold">البادئة</th>
                <th className="text-right p-3 font-semibold w-32">رقم البداية</th>
                <th className="text-right p-3 font-semibold w-24">الأصفار</th>
                <th className="text-right p-3 font-semibold">معاينة</th>
              </tr>
            </thead>
            <tbody>
              {series.map((k) => {
                const cfg = data[k];
                return (
                  <tr key={k} className="border-t border-border">
                    <td className="p-3 font-medium">{cfg.label}</td>
                    <td className="p-3">
                      <Input
                        value={cfg.prefix}
                        onChange={(e) => updateField(k, { prefix: e.target.value.toUpperCase() })}
                        className="w-28 font-mono"
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        type="number"
                        min={1}
                        value={cfg.startFrom}
                        onChange={(e) => updateField(k, { startFrom: Math.max(1, Number(e.target.value) || 1) })}
                        className="w-24 text-center"
                      />
                    </td>
                    <td className="p-3">
                      <Input
                        type="number"
                        min={1}
                        max={8}
                        value={cfg.padding}
                        onChange={(e) => updateField(k, { padding: Math.max(1, Math.min(8, Number(e.target.value) || 4)) })}
                        className="w-20 text-center"
                      />
                    </td>
                    <td className="p-3 font-mono text-primary">{previewNumber(cfg)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="text-xs text-muted-foreground bg-muted/30 border border-border rounded-lg p-3">
          💡 ملاحظة: تنطبق هذه الإعدادات على المستندات الجديدة فقط. الأرقام الحالية لن تتغيّر.
        </div>
      </div>
    </div>
  );
}
