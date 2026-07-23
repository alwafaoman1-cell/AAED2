// إعدادات الضريبة المركزية — تطبق على كل المستندات والقوالب.
import { useEffect, useState } from "react";
import { Percent, Save, RotateCcw } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { getTemplateSettings, saveTemplateSettings, type PdfTemplateSettings } from "@/lib/pdfGenerator";

export default function TaxSettingsPage() {
  const [s, setS] = useState<PdfTemplateSettings>(getTemplateSettings());

  useEffect(() => { setS(getTemplateSettings()); }, []);

  const update = <K extends keyof PdfTemplateSettings>(k: K, v: PdfTemplateSettings[K]) =>
    setS((p) => ({ ...p, [k]: v }));

  const save = async () => {
    try {
      await saveTemplateSettings(s);
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ إعدادات الضريبة");
      return;
    }
    toast.success("تم حفظ إعدادات الضريبة");
  };
  const reset = () => {
    update("taxEnabled", true);
    update("vatRate", 5);
    update("taxName", "ضريبة القيمة المضافة");
    update("taxNameEn", "VAT");
    update("taxInclusive", false);
    toast.info("تم استعادة القيم الافتراضية — اضغط حفظ");
  };

  return (
    <div className="space-y-6 max-w-3xl" dir="rtl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Percent className="text-primary" /> إعدادات الضريبة
        </h1>
        <p className="text-sm text-muted-foreground">
          تتحكم هذه الإعدادات بالضريبة في كل المستندات (الفواتير، عروض الأسعار، التقارير).
          يمكن إيقافها لكل فاتورة على حدة من شاشة تعديل الفاتورة.
        </p>
      </div>

      <div className="bg-card border border-border rounded-xl p-5 shadow-card space-y-5">
        {/* Master switch */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50">
          <div>
            <p className="text-sm font-semibold">تفعيل الضريبة</p>
            <p className="text-[11px] text-muted-foreground">عند الإيقاف لن تُحسب أي ضريبة على المستندات الجديدة افتراضياً.</p>
          </div>
          <Switch checked={s.taxEnabled !== false} onCheckedChange={(v) => update("taxEnabled", v)} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">نسبة الضريبة (%)</label>
            <Input
              type="number"
              step="0.01"
              value={s.vatRate}
              onChange={(e) => update("vatRate", Number(e.target.value) || 0)}
              disabled={s.taxEnabled === false}
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">طريقة الحساب</label>
            <Select
              value={s.taxInclusive ? "inclusive" : "exclusive"}
              onValueChange={(v) => update("taxInclusive", v === "inclusive")}
              disabled={s.taxEnabled === false}
            >
              <SelectTrigger className="bg-secondary border-border"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="exclusive">مضافة (يضاف للسعر — Exclusive)</SelectItem>
                <SelectItem value="inclusive">شاملة (متضمنة بالسعر — Inclusive)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">اسم الضريبة (عربي)</label>
            <Input
              value={s.taxName ?? "ضريبة القيمة المضافة"}
              onChange={(e) => update("taxName", e.target.value)}
              placeholder="ضريبة القيمة المضافة"
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-muted-foreground">اسم الضريبة (إنجليزي)</label>
            <Input
              value={s.taxNameEn ?? "VAT"}
              onChange={(e) => update("taxNameEn", e.target.value)}
              placeholder="VAT"
              className="bg-secondary border-border"
            />
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <label className="text-xs text-muted-foreground">الرقم الضريبي للمنشأة</label>
            <Input
              value={s.vatNumber ?? ""}
              onChange={(e) => update("vatNumber", e.target.value)}
              placeholder="OM1XXXXXXXXX"
              className="bg-secondary border-border font-mono"
            />
          </div>
        </div>

        <div className="flex gap-2 pt-2">
          <Button onClick={save} className="gradient-gold text-primary-foreground gap-2">
            <Save size={14} /> حفظ
          </Button>
          <Button variant="outline" onClick={reset} className="gap-2">
            <RotateCcw size={14} /> إعادة الافتراضي
          </Button>
        </div>
      </div>
    </div>
  );
}
