import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Wrench, LayoutDashboard, FileSpreadsheet, ReceiptText, Download, Smartphone } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { isModuleEnabled } from "@/lib/modulesStore";

interface AppItem {
  path: string;
  titleAr: string;
  titleEn: string;
  descAr: string;
  descEn: string;
  icon: React.ElementType;
  color: string;
  moduleKey?: "tech" | "manager" | "accountant" | "supervisor" | "install";
}

const APPS: AppItem[] = [
  { path: "/technician",     moduleKey: "tech",        icon: Wrench,          color: "text-amber-500",  titleAr: "تطبيق الفنيين",  titleEn: "Technician App",  descAr: "تحديث أوامر العمل ورفع الصور من الجوال.",       descEn: "Update work orders & upload photos from mobile." },
  { path: "/manager-app",    moduleKey: "manager",     icon: LayoutDashboard, color: "text-blue-500",   titleAr: "تطبيق المدير",   titleEn: "Manager App",     descAr: "لوحة KPI تنفيذية على الجوال.",                   descEn: "Executive KPI dashboard on mobile." },
  { path: "/accountant",     moduleKey: "accountant",  icon: FileSpreadsheet, color: "text-emerald-500",titleAr: "تطبيق المحاسب",  titleEn: "Accountant App",  descAr: "لوحة محاسبية يومية ومراقبة الإيرادات.",            descEn: "Daily accounting board & revenue monitor." },
  { path: "/supervisor",     moduleKey: "supervisor",  icon: ReceiptText,     color: "text-fuchsia-500",titleAr: "تطبيق المشرف",   titleEn: "Supervisor App",  descAr: "إضافة سندات الصرف بسرعة من الجوال.",              descEn: "Quickly record expenses from the phone." },
  { path: "/install",        moduleKey: "install",     icon: Download,        color: "text-cyan-500",   titleAr: "تثبيت التطبيق",  titleEn: "Install App",     descAr: "صفحة تثبيت التطبيق على الهاتف بدون متجر.",         descEn: "Install the app on your phone — no app store." },
];

export default function AppsHub() {
  const { i18n } = useTranslation();
  const isAr = i18n.language?.startsWith("ar");
  const items = APPS.filter((a) => !a.moduleKey || isModuleEnabled(a.moduleKey));

  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <Smartphone className="h-7 w-7 text-primary" />
        <div>
          <h1 className="text-2xl font-bold">{isAr ? "التطبيقات" : "Apps"}</h1>
          <p className="text-sm text-muted-foreground">
            {isAr ? "كل تطبيقات الفريق في مكان واحد." : "All your team apps in one place."}
          </p>
        </div>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((a) => (
          <Link key={a.path} to={a.path} className="group">
            <Card className="h-full transition hover:border-primary hover:shadow-lg">
              <CardContent className="p-5 flex flex-col gap-3">
                <div className="flex items-center gap-3">
                  <div className="h-11 w-11 rounded-xl bg-muted flex items-center justify-center">
                    <a.icon className={`h-6 w-6 ${a.color}`} />
                  </div>
                  <h2 className="text-base font-semibold group-hover:text-primary">
                    {isAr ? a.titleAr : a.titleEn}
                  </h2>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {isAr ? a.descAr : a.descEn}
                </p>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
