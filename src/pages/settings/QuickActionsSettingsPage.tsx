import { useEffect, useState } from "react";
import { smartBack } from "@/lib/smartBack";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, RotateCcw, Save, Zap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";
import {
  getQuickActionsSettings, saveQuickActionsSettings, resetQuickActionsSettings,
  ALL_ACTIONS, type QuickActionsSettings, type QuickActionKey, type FabPosition,
} from "@/lib/quickActionsSettingsStore";

const MAX_VISIBLE = 8;

export default function QuickActionsSettingsPage() {
  const { i18n } = useTranslation();
  const isRtl = i18n.dir() === "rtl";
  const navigate = useNavigate();
  const [s, setS] = useState<QuickActionsSettings>(() => getQuickActionsSettings());

  useEffect(() => { setS(getQuickActionsSettings()); }, []);

  const Back = isRtl ? ArrowRight : ArrowLeft;

  function toggleAction(key: QuickActionKey) {
    setS((prev) => {
      const exists = prev.visibleActions.includes(key);
      if (exists) {
        return { ...prev, visibleActions: prev.visibleActions.filter((k) => k !== key) };
      }
      if (prev.visibleActions.length >= MAX_VISIBLE) {
        toast.warning(isRtl ? `الحد الأقصى ${MAX_VISIBLE} إجراءات` : `Max ${MAX_VISIBLE} actions`);
        return prev;
      }
      return { ...prev, visibleActions: [...prev.visibleActions, key] };
    });
  }

  function save() {
    saveQuickActionsSettings(s);
    toast.success(isRtl ? "تم حفظ الإعدادات" : "Settings saved");
  }

  function reset() {
    resetQuickActionsSettings();
    setS(getQuickActionsSettings());
    toast.success(isRtl ? "تم استرجاع الافتراضي" : "Defaults restored");
  }

  return (
    <div className="max-w-3xl mx-auto space-y-4" dir={isRtl ? "rtl" : "ltr"}>
      <div className="flex items-center justify-between">
        <Button variant="ghost" onClick={() => smartBack(navigate, "/settings")} className="gap-2">
          <Back size={16} />
          {isRtl ? "رجوع للإعدادات" : "Back to settings"}
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={reset} className="gap-2">
            <RotateCcw size={14} /> {isRtl ? "افتراضي" : "Reset"}
          </Button>
          <Button onClick={save} className="gap-2">
            <Save size={14} /> {isRtl ? "حفظ" : "Save"}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Zap className="text-primary" size={20} />
            {isRtl ? "زر الإجراءات السريعة العائم" : "Quick Actions Floating Button"}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {isRtl
              ? "اضبط ظهور الزر والإجراءات الظاهرة فيه وموقعه على الشاشة."
              : "Customize the floating action button — visibility, actions and position."}
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Enabled */}
          <div className="flex items-center justify-between border rounded-lg p-3">
            <div>
              <div className="font-semibold">{isRtl ? "تفعيل الزر العائم" : "Enable FAB"}</div>
              <div className="text-xs text-muted-foreground">
                {isRtl ? "إظهار الزر في كل الصفحات الداخلية" : "Show on all in-app screens"}
              </div>
            </div>
            <Switch checked={s.enabled} onCheckedChange={(v) => setS({ ...s, enabled: v })} />
          </div>

          {/* Position */}
          <div className="space-y-2">
            <Label className="font-semibold">{isRtl ? "الموقع" : "Position"}</Label>
            <RadioGroup
              value={s.position}
              onValueChange={(v) => setS({ ...s, position: v as FabPosition })}
              className="grid grid-cols-3 gap-2"
            >
              {[
                { v: "bottom-right",  l: isRtl ? "أسفل يمين"  : "Bottom right" },
                { v: "bottom-center", l: isRtl ? "أسفل وسط"  : "Bottom center" },
                { v: "bottom-left",   l: isRtl ? "أسفل يسار" : "Bottom left" },
              ].map((opt) => (
                <Label
                  key={opt.v}
                  className={`border rounded-lg p-3 flex items-center gap-2 cursor-pointer ${s.position === opt.v ? "border-primary bg-primary/5" : ""}`}
                >
                  <RadioGroupItem value={opt.v} />
                  <span className="text-sm">{opt.l}</span>
                </Label>
              ))}
            </RadioGroup>
          </div>

          {/* Offset */}
          <div className="space-y-2">
            <div className="flex justify-between">
              <Label className="font-semibold">
                {isRtl ? "الارتفاع من الأسفل" : "Distance from bottom"}
              </Label>
              <span className="text-sm text-muted-foreground">{s.offsetY}px</span>
            </div>
            <Slider
              min={16}
              max={200}
              step={4}
              value={[s.offsetY]}
              onValueChange={([v]) => setS({ ...s, offsetY: v })}
            />
          </div>

          {/* Actions */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <Label className="font-semibold">
                {isRtl ? "الإجراءات الظاهرة" : "Visible actions"}
              </Label>
              <span className="text-xs text-muted-foreground">
                {s.visibleActions.length}/{MAX_VISIBLE}
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {ALL_ACTIONS.map((a) => {
                const checked = s.visibleActions.includes(a.key);
                return (
                  <label
                    key={a.key}
                    className={`flex items-center gap-3 border rounded-lg p-3 cursor-pointer transition-colors ${checked ? "border-primary bg-primary/5" : "hover:bg-accent/50"}`}
                  >
                    <Checkbox checked={checked} onCheckedChange={() => toggleAction(a.key)} />
                    <span className="text-sm font-medium">{isRtl ? a.labelAr : a.labelEn}</span>
                  </label>
                );
              })}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{isRtl ? "معاينة" : "Preview"}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            {isRtl
              ? "احفظ ثم انظر إلى الزائر العائم في زاوية الشاشة. التغييرات تسري فوراً بعد الحفظ."
              : "Save and look at the floating button in the corner — changes take effect immediately."}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
