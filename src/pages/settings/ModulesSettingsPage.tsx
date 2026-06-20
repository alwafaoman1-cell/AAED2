import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ArrowLeft, Boxes, Power, RotateCcw, Shield } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  ALL_MODULES,
  getModulesSettings,
  setModuleEnabled,
  subscribeModulesSettings,
  resetModulesSettings,
  type ModuleKey,
  type ModulesSettings,
} from "@/lib/modulesStore";

export default function ModulesSettingsPage() {
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const [settings, setSettings] = useState<ModulesSettings>(getModulesSettings());

  useEffect(() => {
    const unsub = subscribeModulesSettings(setSettings);
    return () => { unsub(); };
  }, []);

  const handleToggle = (key: ModuleKey, value: boolean) => {
    setModuleEnabled(key, value);
    const mod = ALL_MODULES.find((m) => m.key === key)!;
    const name = isAr ? mod.labelAr : mod.labelEn;
    toast.success(value
      ? (isAr ? `تم تشغيل ${name}` : `${name} enabled`)
      : (isAr ? `تم إيقاف ${name}` : `${name} disabled`));
  };

  const apps = ALL_MODULES.filter((m) => m.group === "apps");
  const core = ALL_MODULES.filter((m) => m.group === "core");

  return (
    <div className="container mx-auto py-6 px-4 max-w-3xl space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/settings" className="text-sm text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
            <ArrowLeft className="h-4 w-4" /> {isAr ? "الإعدادات" : "Settings"}
          </Link>
        </div>
        <Button variant="ghost" size="sm" onClick={() => { resetModulesSettings(); toast.info(isAr ? "تم استعادة الافتراضي" : "Defaults restored"); }}>
          <RotateCcw className="h-4 w-4 me-1" /> {isAr ? "استعادة الافتراضي" : "Reset"}
        </Button>
      </div>

      <div className="space-y-1">
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Power className="h-6 w-6 text-primary" />
          {isAr ? "تشغيل وإيقاف التطبيقات والوحدات" : "Apps & Modules"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isAr
            ? "فعّل أو أوقف ظهور التطبيقات والوحدات في القائمة الجانبية. لا يحذف هذا أي بيانات — فقط يخفي الواجهات."
            : "Enable or disable apps and modules from the sidebar. No data is deleted — only the UI is hidden."}
        </p>
      </div>

      {/* Apps */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Boxes className="h-5 w-5 text-blue-400" />
            {isAr ? "تطبيقات الموبايل" : "Mobile Apps"}
          </CardTitle>
          <CardDescription>
            {isAr ? "واجهات مخصّصة لكل دور لاستخدامها على الهاتف." : "Role-specific mobile interfaces."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {apps.map((m, i) => {
            const checked = settings.enabled[m.key] !== false;
            return (
              <div key={m.key}>
                {i > 0 && <Separator className="my-1" />}
                <div className="flex items-start justify-between gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{isAr ? m.labelAr : m.labelEn}</span>
                      <Badge variant="outline" className="text-[10px]" dir="ltr">{m.path}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{isAr ? m.descAr : m.descEn}</p>
                  </div>
                  <Switch checked={checked} onCheckedChange={(v) => handleToggle(m.key, v)} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Core modules */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Shield className="h-5 w-5 text-sky-400" />
            {isAr ? "الوحدات الكبرى" : "Core Modules"}
          </CardTitle>
          <CardDescription>
            {isAr ? "تشغيل أو إيقاف مجموعات الميزات الرئيسية." : "Toggle major feature groups."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-1">
          {core.map((m, i) => {
            const checked = settings.enabled[m.key] !== false;
            return (
              <div key={m.key}>
                {i > 0 && <Separator className="my-1" />}
                <div className="flex items-start justify-between gap-3 py-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{isAr ? m.labelAr : m.labelEn}</span>
                      <Badge variant="outline" className="text-[10px]" dir="ltr">{m.path}</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1">{isAr ? m.descAr : m.descEn}</p>
                  </div>
                  <Switch checked={checked} onCheckedChange={(v) => handleToggle(m.key, v)} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      <p className="text-xs text-muted-foreground text-center">
        {isAr
          ? "الإعدادات تُحفظ على هذا الجهاز فقط. لإلغاء الإيقاف، أعد تشغيل الوحدة من نفس الصفحة."
          : "Settings are saved on this device only. Re-enable from here at any time."}
      </p>
    </div>
  );
}
